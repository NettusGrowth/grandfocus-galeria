-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 3: campos novos de cadastro, professor
-- em mais de uma escola, e vínculo persistente entre cônjuges (filho
-- futuro de um também aparece pro outro automaticamente).
-- Rodar depois de 001 a 017. Aditiva.
-- ════════════════════════════════════════════════════════════════

-- ── campos novos de cadastro ──────────────────────────────────────
alter table alunos add column if not exists turma text;
alter table alunos add column if not exists observacoes text;
alter table perfis add column if not exists email text;
alter table perfis add column if not exists telefone text;

-- ── professor/diretor em mais de uma escola ───────────────────────
-- perfis.escola_id continua sendo a escola "principal" (onde o cargo
-- é proprietario/diretor faz mais sentido nela); essa tabela é só
-- pras escolas ADICIONAIS em que um professor também dá aula.
create table if not exists professor_escolas (
  user_id uuid not null references perfis(user_id) on delete cascade,
  escola_id uuid not null references escolas(id) on delete cascade,
  primary key (user_id, escola_id)
);
create index if not exists idx_prof_escolas_escola on professor_escolas(escola_id);
alter table professor_escolas enable row level security;

create policy professor_escolas_admin_all on professor_escolas for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy professor_escolas_select_own on professor_escolas for select to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on professor_escolas to authenticated;

-- ── amplia as funções de visibilidade já existentes pra considerar
-- as escolas adicionais do professor (não só a principal) ──────────
create or replace function escolas_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select escola_id from perfis where user_id = auth.uid() and escola_id is not null
  union
  select escola_id from professor_escolas where user_id = auth.uid()
  union
  select escola_id from alunos where id in (select aluno_id from meus_alunos()) and escola_id is not null
$$;

create or replace function alunos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from alunos where escola_id in (select escolas_visiveis())
  union
  select aluno_id from meus_alunos()
$$;

create or replace function eventos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from eventos where escola_id in (select escolas_visiveis())
  union
  select distinct f.evento_id from fotos f
  join foto_aluno fa on fa.foto_id = f.id
  where fa.aluno_id in (select aluno_id from meus_alunos())
  union
  select f.evento_id from fotos f
  join foto_pessoa fp on fp.foto_id = f.id
  where fp.user_id = auth.uid()
$$;

create or replace function fotos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from fotos where evento_id in (
    select id from eventos where escola_id in (select escolas_visiveis())
  )
  union
  select foto_id from foto_aluno where aluno_id in (select aluno_id from meus_alunos())
  union
  select foto_id from foto_pessoa where user_id = auth.uid()
$$;
-- storage_paths_visiveis() não precisa mudar — o corpo dela já é
-- "select storage_path from fotos where id in (select fotos_visiveis())".

-- ── vínculo persistente entre cônjuges/pais de um mesmo aluno ─────
-- diferente do "vincular cônjuge" antigo (copiava os filhos uma vez só
-- e esquecia) — isso guarda a relação, então um filho matriculado
-- DEPOIS pra um dos dois aparece pro outro sozinho, via trigger.
create table if not exists conjuges (
  user_id_a uuid not null references perfis(user_id) on delete cascade,
  user_id_b uuid not null references perfis(user_id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id_a, user_id_b),
  constraint conjuges_ordem check (user_id_a < user_id_b)
);
alter table conjuges enable row level security;
create policy conjuges_admin_all on conjuges for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy conjuges_select_own on conjuges for select to authenticated
  using (auth.uid() in (user_id_a, user_id_b));
grant select, insert, update, delete on conjuges to authenticated;

create or replace function _sync_filho_conjuge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into responsavel_alunos(user_id, aluno_id)
    select case when c.user_id_a = new.user_id then c.user_id_b else c.user_id_a end, new.aluno_id
    from conjuges c
    where new.user_id in (c.user_id_a, c.user_id_b)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_sync_filho_conjuge on responsavel_alunos;
create trigger trg_sync_filho_conjuge
  after insert on responsavel_alunos
  for each row execute function _sync_filho_conjuge();

-- RPC pra vincular dois responsáveis como cônjuges (admin cria a
-- partir da aba Pais) — registra o vínculo E já sincroniza os filhos
-- que cada um já tinha até agora nos dois sentidos.
create or replace function vincular_conjuge(user_a uuid, user_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  meu_role text; a uuid; b uuid;
begin
  select role into meu_role from perfis where user_id = auth.uid();
  if meu_role not in ('admin','super_admin') then
    raise exception 'Sem permissão pra vincular cônjuges.';
  end if;
  if user_a is null or user_b is null or user_a = user_b then
    raise exception 'Selecione duas pessoas diferentes.';
  end if;
  a := least(user_a, user_b); b := greatest(user_a, user_b);
  insert into conjuges(user_id_a, user_id_b) values (a, b) on conflict do nothing;
  insert into responsavel_alunos(user_id, aluno_id)
    select user_b, aluno_id from responsavel_alunos where user_id = user_a
  on conflict do nothing;
  insert into responsavel_alunos(user_id, aluno_id)
    select user_a, aluno_id from responsavel_alunos where user_id = user_b
  on conflict do nothing;
end;
$$;
grant execute on function vincular_conjuge(uuid, uuid) to authenticated;
