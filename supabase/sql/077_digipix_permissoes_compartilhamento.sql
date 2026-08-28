-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Módulo Digipix: modos de compartilhamento do
-- portal do cliente (3º PROMPT.md do Luiz, ETAPA 3 item 1). Rodar
-- depois de 001 a 076. Aditiva.
--
-- Hoje o portal do cliente é "tudo ou nada": todo álbum em
-- em_aprovacao/aprovado libera trocar foto + comentar + aprovar, sem
-- controle nenhum do fotógrafo. Pedido explícito: ao enviar pro
-- cliente, o admin escolhe o MODO (Somente Apreciação — cliente só
-- olha, sem nenhum botão de mexer; ou Colaborativo — com travas
-- modulares independentes: trocar foto, comentar, botão de aprovar).
--
-- Defaults pensados pra não mudar o comportamento de álbuns JÁ
-- enviados antes desta migration: modo_compartilhamento='colaborativo'
-- + permite_comentarios=true + exibir_botao_aprovar=true reproduzem
-- exatamente o que já existia. permite_trocar_foto=false como default
-- é INTENCIONALMENTE diferente do comportamento antigo (trocar foto
-- sempre foi liberado) — o próprio 3º PROMPT.md pede explicitamente
-- "Permitir cliente trocar fotos (Desativado por padrão)". Álbuns já
-- enviados antes desta migration passam a ter troca de foto desligada
-- até o admin reabrir o envio e ligar de novo, se quiser — efeito
-- colateral aceito de propósito, não um bug.
-- ════════════════════════════════════════════════════════════════

alter table album_projects add column if not exists modo_compartilhamento text not null default 'colaborativo'
  check (modo_compartilhamento in ('apreciacao', 'colaborativo'));
alter table album_projects add column if not exists permite_trocar_foto boolean not null default false;
alter table album_projects add column if not exists permite_comentarios boolean not null default true;
alter table album_projects add column if not exists exibir_botao_aprovar boolean not null default true;

-- achado revisando o próprio RPC (075): album_trocar_foto só validava
-- dono+status+foto visível — nunca checou se o ADMIN LIBEROU troca de
-- foto pra esse álbum. Sem isso, mesmo com permite_trocar_foto=false
-- (ou modo_compartilhamento='apreciacao'), um cliente que soubesse o
-- nome da função RPC ainda conseguiria chamar db.rpc('album_trocar_foto',...)
-- direto (o botão fica escondido no client, mas RLS/RPC é a barreira
-- de verdade — esconder no client sozinho nunca é segurança real).
create or replace function album_trocar_foto(p_element_id uuid, p_novo_foto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento_id uuid;
  v_status text;
  v_modo text;
  v_permite boolean;
begin
  select p.evento_id, p.status, p.modo_compartilhamento, p.permite_trocar_foto
    into v_evento_id, v_status, v_modo, v_permite
  from album_elements e
  join album_spreads s on s.id = e.spread_id
  join album_projects p on p.id = s.project_id
  where e.id = p_element_id and p.cliente_user_id = auth.uid();

  if v_evento_id is null then
    raise exception 'Elemento não encontrado ou sem permissão';
  end if;
  if v_status <> 'em_aprovacao' then
    raise exception 'Este álbum não está mais aceitando trocas de foto';
  end if;
  if v_modo = 'apreciacao' or not v_permite then
    raise exception 'O fotógrafo não liberou troca de fotos pra este álbum';
  end if;
  if not exists (
    select 1 from fotos where id = p_novo_foto_id and evento_id = v_evento_id
      and id in (select fotos_visiveis())
  ) then
    raise exception 'Essa foto não pertence a este álbum ou não está disponível pra você';
  end if;

  update album_elements set foto_id = p_novo_foto_id where id = p_element_id;
end;
$$;
grant execute on function album_trocar_foto(uuid, uuid) to authenticated;

-- mesmo raciocínio pro RPC de aprovar: se o admin desligou
-- exibir_botao_aprovar (ex: álbum em modo só-apreciação, ainda não é
-- pra aprovar de verdade), o RPC precisa recusar mesmo que alguém
-- chame direto — não só esconder o botão.
create or replace function album_aprovar(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_nome text;
  v_exibir boolean;
begin
  select status, nome, exibir_botao_aprovar into v_status, v_nome, v_exibir from album_projects
  where id = p_project_id and cliente_user_id = auth.uid();

  if v_status is null then
    raise exception 'Álbum não encontrado ou sem permissão';
  end if;
  if v_status <> 'em_aprovacao' then
    raise exception 'Este álbum já não está mais aguardando aprovação';
  end if;
  if not v_exibir then
    raise exception 'O fotógrafo ainda não liberou a aprovação deste álbum';
  end if;

  update album_projects set status = 'aprovado', aprovado_em = now() where id = p_project_id;

  insert into auditoria (user_id, user_nome, acao, tabela, registro_id, detalhe)
  values (auth.uid(), (select nome from perfis where user_id = auth.uid()), 'aprovou álbum (Digipix)', 'album_projects', p_project_id, v_nome);
end;
$$;
grant execute on function album_aprovar(uuid) to authenticated;
