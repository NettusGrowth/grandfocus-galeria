-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Módulo Digipix, Passo 2: portal de aprovação
-- do cliente (responsável já logado, não link público novo). Rodar
-- depois de 001 a 074. Aditiva.
--
-- Cliente só ENXERGA o próprio álbum (SELECT novo em album_projects/
-- spreads/elements, combinado por OR com o `for all` de admin do
-- Passo 1 — Postgres junta policies permissivas da mesma ação com
-- OR). As duas ÚNICAS escritas que o cliente faz (trocar foto,
-- aprovar) passam só por RPC — nunca por policy de UPDATE direta,
-- porque as duas têm regra de negócio real (foto tem que ser do
-- mesmo evento e já visível pra ele; não dá pra trocar foto depois
-- de aprovado; não dá pra aprovar duas vezes).
-- ════════════════════════════════════════════════════════════════

alter table album_projects add column if not exists aprovado_em timestamptz;

create table if not exists album_comentarios (
  id uuid primary key default gen_random_uuid(),
  spread_id uuid not null references album_spreads(id) on delete cascade,
  autor_user_id uuid references perfis(user_id) on delete set null,
  texto text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_album_comentarios_spread on album_comentarios(spread_id);
alter table album_comentarios enable row level security;

create policy album_comentarios_select on album_comentarios for select to authenticated
  using (
    (select role from meu_perfil()) in ('admin', 'super_admin')
    or spread_id in (
      select s.id from album_spreads s
      join album_projects p on p.id = s.project_id
      where p.cliente_user_id = auth.uid()
    )
  );

create policy album_comentarios_insert on album_comentarios for insert to authenticated
  with check (
    autor_user_id = auth.uid()
    and (
      (select role from meu_perfil()) in ('admin', 'super_admin')
      or spread_id in (
        select s.id from album_spreads s
        join album_projects p on p.id = s.project_id
        where p.cliente_user_id = auth.uid()
      )
    )
  );

grant select, insert on album_comentarios to authenticated;

-- leitura do próprio álbum pelo cliente (soma-se à policy admin_all
-- do Passo 1, nunca a substitui)
create policy album_projects_cliente_select on album_projects for select to authenticated
  using (cliente_user_id = auth.uid());

create policy album_spreads_cliente_select on album_spreads for select to authenticated
  using (project_id in (select id from album_projects where cliente_user_id = auth.uid()));

create policy album_elements_cliente_select on album_elements for select to authenticated
  using (spread_id in (
    select s.id from album_spreads s join album_projects p on p.id = s.project_id
    where p.cliente_user_id = auth.uid()
  ));

-- troca de foto: valida dono, status ainda "em_aprovacao", e que a
-- foto nova é do MESMO evento do álbum e já visível pra esse cliente
-- (fotos_visiveis(), 018_gestao_vinculos.sql — mesma regra que a
-- Galeria dele já usa, não reinventa nada).
create or replace function album_trocar_foto(p_element_id uuid, p_novo_foto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento_id uuid;
  v_status text;
begin
  select p.evento_id, p.status into v_evento_id, v_status
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

-- aprovação: só o dono, só uma vez — segunda chamada (duplo clique,
-- 2 abas abertas) dá erro claro em vez de reaprovar/sobrescrever
-- aprovado_em silenciosamente.
create or replace function album_aprovar(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_nome text;
begin
  select status, nome into v_status, v_nome from album_projects
  where id = p_project_id and cliente_user_id = auth.uid();

  if v_status is null then
    raise exception 'Álbum não encontrado ou sem permissão';
  end if;
  if v_status <> 'em_aprovacao' then
    raise exception 'Este álbum já não está mais aguardando aprovação';
  end if;

  update album_projects set status = 'aprovado', aprovado_em = now() where id = p_project_id;

  insert into auditoria (user_id, user_nome, acao, tabela, registro_id, detalhe)
  values (auth.uid(), (select nome from perfis where user_id = auth.uid()), 'aprovou álbum (Digipix)', 'album_projects', p_project_id, v_nome);
end;
$$;
grant execute on function album_aprovar(uuid) to authenticated;
