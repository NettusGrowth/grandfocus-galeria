-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio B: escolas (capa/descrição/proprietário)
-- e alunos (foto/nascimento). Rodar depois de 001 a 007. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table escolas add column if not exists capa_url text;
alter table escolas add column if not exists descricao text;
alter table escolas add column if not exists proprietario_user_id uuid references perfis(user_id) on delete set null;

alter table alunos add column if not exists foto_url text;
alter table alunos add column if not exists data_nascimento date;

-- ── funções reaproveitáveis: quais escolas/alunos eu posso ver ──────
-- (mesma lógica já usada nas policies de alunos/eventos, só que como
-- função — vão servir tanto pra fotos de perfil/capa aqui quanto pro
-- módulo de Galeria no Estágio C).
create or replace function alunos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from alunos where escola_id = (select escola_id from meu_perfil())
  union
  select aluno_id from meus_alunos()
$$;
grant execute on function alunos_visiveis() to authenticated;

create or replace function escolas_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select escola_id from perfis where user_id = auth.uid() and escola_id is not null
  union
  select escola_id from alunos where id in (select aluno_id from meus_alunos()) and escola_id is not null
$$;
grant execute on function escolas_visiveis() to authenticated;

-- ── storage: leitura de capa de escola / foto de aluno pra quem já
-- enxerga aquela escola/aluno (mesmo bucket privado de sempre;
-- caminho escolas/{escola_id}/capa.ext e alunos/{aluno_id}/foto.ext).
-- Upload continua admin-only (já coberto pelas policies de insert/
-- update de storage do 003_storage.sql — não precisa duplicar).
-- guarda com regex antes do cast pra uuid — nunca quebra em paths que
-- não sejam de escola/aluno (o resto da galeria usa outros formatos de
-- caminho, ex: evento_id/timestamp.jpg).
create policy perfil_fotos_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or (
      name like 'escolas/%'
      and split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
      and split_part(name,'/',2)::uuid in (select escolas_visiveis())
    )
    or (
      name like 'alunos/%'
      and split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
      and split_part(name,'/',2)::uuid in (select alunos_visiveis())
    )
  )
);
