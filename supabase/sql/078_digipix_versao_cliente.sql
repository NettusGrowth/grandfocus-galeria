-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Módulo Digipix: versão "publicada" separada
-- do rascunho do admin (4º PROMPT.md do Luiz). Rodar depois de 001 a
-- 077. Aditiva.
--
-- Hoje o portal do cliente lê album_spreads/album_elements AO VIVO —
-- qualquer ajuste do admin no editor aparece pro cliente na hora,
-- mesmo no meio de uma edição incompleta. Pedido explícito: "assim
-- que eu mando para cliente, eu posso continuar configurando o
-- álbum, a cliente vai ver apenas a versão que eu enviei, e se eu
-- quiser atualizar eu clico em 'Atualizar para o cliente'".
--
-- snapshot_cliente guarda uma cópia CONGELADA (jsonb: {spreads:[...],
-- elements:[...]}) tirada no momento do envio — o cliente passa a ler
-- só isso, nunca as tabelas ao vivo. "Atualizar pra Cliente" (ação
-- explícita do admin) sobrescreve com o estado atual do editor.
-- ════════════════════════════════════════════════════════════════

alter table album_projects add column if not exists snapshot_cliente jsonb;

-- achado revisando o próprio RPC (077): trocar foto agora precisa
-- escrever DENTRO do snapshot (não mais em album_elements direto —
-- o cliente não lê mais aquela tabela, escrever lá não apareceria pra
-- ele até o admin publicar de novo, o que ia contra o próprio pedido
-- de troca de foto ser algo que o cliente vê na hora). Localiza o
-- elemento pelo id GUARDADO dentro do array jsonb (copiado 1:1 de
-- album_elements.id no momento do snapshot) e troca só o foto_id
-- daquele item, via jsonb_set num índice de array encontrado com
-- jsonb_array_elements(...) with ordinality.
create or replace function album_trocar_foto(p_element_id uuid, p_novo_foto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_evento_id uuid;
  v_status text;
  v_modo text;
  v_permite boolean;
  v_idx int;
begin
  select p.id, p.evento_id, p.status, p.modo_compartilhamento, p.permite_trocar_foto
    into v_project_id, v_evento_id, v_status, v_modo, v_permite
  from album_projects p
  where p.cliente_user_id = auth.uid()
    and p.snapshot_cliente is not null
    and exists (
      select 1 from jsonb_array_elements(p.snapshot_cliente->'elements') el
      where (el->>'id')::uuid = p_element_id
    );

  if v_project_id is null then
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

  select (t.idx - 1) into v_idx
  from album_projects p, jsonb_array_elements(p.snapshot_cliente->'elements') with ordinality as t(el, idx)
  where p.id = v_project_id and (t.el->>'id')::uuid = p_element_id;

  update album_projects
  set snapshot_cliente = jsonb_set(snapshot_cliente, array['elements', v_idx::text, 'foto_id'], to_jsonb(p_novo_foto_id::text))
  where id = v_project_id;
end;
$$;
grant execute on function album_trocar_foto(uuid, uuid) to authenticated;

-- album_aprovar não muda — continua só mexendo em album_projects.status,
-- independente do conteúdo do snapshot.
