-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio C: marcação direta de foto pra pessoa
-- (não só aluno) — necessário pros "ensaios avulsos" poderem marcar
-- professor/diretor/avulso diretamente, sem precisar de um aluno no
-- meio. Rodar depois de 001 a 009. Aditiva.
--
-- Decisão de desenho: em vez de reestruturar foto_aluno (que já está
-- testada e é a base das policies de eventos/fotos/storage — mexer
-- nela de novo arrisca reabrir a recursão que já corrigimos no
-- 006_fix_recursao.sql), criei uma tabela NOVA e paralela só pra
-- marcação direta, e só ACRESCENTEI uma cláusula a mais nas funções
-- de visibilidade que já existem (eventos_visiveis/fotos_visiveis/
-- storage_paths_visiveis) — nada do que já funcionava muda de
-- comportamento.
-- ════════════════════════════════════════════════════════════════

create table if not exists foto_pessoa (
  foto_id uuid not null references fotos(id) on delete cascade,
  user_id uuid not null references perfis(user_id) on delete cascade,
  primary key (foto_id, user_id)
);
create index if not exists idx_foto_pessoa_user on foto_pessoa(user_id);
alter table foto_pessoa enable row level security;

create policy foto_pessoa_admin_all on foto_pessoa for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy foto_pessoa_select_own on foto_pessoa for select to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on foto_pessoa to authenticated;

-- ── amplia as funções de visibilidade já existentes ────────────────
create or replace function fotos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from fotos where evento_id in (
    select id from eventos where escola_id = (select escola_id from meu_perfil())
  )
  union
  select foto_id from foto_aluno where aluno_id in (select aluno_id from meus_alunos())
  union
  select foto_id from foto_pessoa where user_id = auth.uid()
$$;

create or replace function eventos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from eventos where escola_id = (select escola_id from meu_perfil())
  union
  select distinct f.evento_id from fotos f
  join foto_aluno fa on fa.foto_id = f.id
  where fa.aluno_id in (select aluno_id from meus_alunos())
  union
  select f.evento_id from fotos f
  join foto_pessoa fp on fp.foto_id = f.id
  where fp.user_id = auth.uid()
$$;

-- storage_paths_visiveis() não precisa mudar — o corpo dela já é
-- "select storage_path from fotos where id in (select fotos_visiveis())",
-- então herda a marcação direta automaticamente assim que fotos_visiveis()
-- for atualizada acima.
