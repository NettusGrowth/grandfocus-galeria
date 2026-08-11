-- Fix real: o admin/super_admin conseguia ver a foto de perfil de
-- todo mundo, mas ninguém conseguia ver a foto DELE de volta — a
-- policy perfis_select (022_bloco6.sql) libera admin/super_admin
-- verem qualquer linha, e libera proprietário/diretor/professor verem
-- gente da própria escola, mas nenhuma cláusula deixa um não-admin ver
-- uma linha cujo role é 'admin'/'super_admin' (essas linhas não têm
-- escola_id, então nunca batem com as cláusulas de "mesma escola").
-- Resultado: nome/foto do admin nunca aparecia em posts da Comunidade,
-- avatares de auditoria, etc. pra ninguém além dele mesmo.
--
-- Fix: equipe admin é "da casa" (não pertence a uma escola específica,
-- é do estúdio) — visível pra qualquer autenticado, mesmo padrão de
-- como proprietário/diretor/professor já são visíveis dentro da
-- própria escola. Rodar isso no SQL Editor do Supabase.

drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select to authenticated
using (
  user_id = auth.uid()
  or role in ('admin','super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario','diretor')
    and (
      (role in ('proprietario','diretor','professor') and escola_id = (select escola_id from meu_perfil()))
      or (role = 'responsavel' and user_id in (
        select ra.user_id from responsavel_alunos ra
        join alunos al on al.id = ra.aluno_id
        where al.escola_id = (select escola_id from meu_perfil())
      ))
    )
  )
  or (
    (select role from meu_perfil()) = 'professor'
    and role in ('proprietario','diretor','professor')
    and escola_id = (select escola_id from meu_perfil())
  )
);
