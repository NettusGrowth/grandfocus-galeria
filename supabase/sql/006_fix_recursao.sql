-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige recursão infinita entre as policies de
-- "eventos" e "fotos". Rodar depois de 001/002/003/004/005.
--
-- Por quê: a policy de "eventos" consultava "fotos" pra saber se algum
-- filho do responsável tinha foto naquele evento; a policy de "fotos"
-- consultava "eventos" pra saber se o evento era da escola do usuário.
-- Cada consulta reaciona a RLS da outra tabela, que consulta a
-- primeira de novo — loop infinito ("infinite recursion detected in
-- policy for relation eventos").
--
-- Correção: mover essas consultas pra dentro de funções SECURITY
-- DEFINER (mesmo padrão de meu_perfil()/meus_alunos()) — elas rodam
-- como dono da função, ignorando a RLS das tabelas que consultam por
-- dentro, o que quebra o ciclo.
-- ════════════════════════════════════════════════════════════════

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
$$;
grant execute on function eventos_visiveis() to authenticated;

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
$$;
grant execute on function fotos_visiveis() to authenticated;

create or replace function storage_paths_visiveis()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select storage_path from fotos where id in (select fotos_visiveis())
$$;
grant execute on function storage_paths_visiveis() to authenticated;

drop policy if exists eventos_select on eventos;
create policy eventos_select on eventos for select to authenticated
  using (id in (select eventos_visiveis()));

drop policy if exists fotos_select on fotos;
create policy fotos_select on fotos for select to authenticated
  using (id in (select fotos_visiveis()));

drop policy if exists fotos_storage_select on storage.objects;
create policy fotos_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and (
    (select role from meu_perfil()) = 'admin'
    or name in (select storage_paths_visiveis())
  )
);
