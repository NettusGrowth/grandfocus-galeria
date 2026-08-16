-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — fix RLS de responsavel_alunos: proprietário/
-- diretor (e super_admin) não conseguiam vincular pai↔filho.
--
-- BUG relatado: "Vincular pai/responsável" (e o vínculo de filhos já
-- na criação do responsável, em salvarPai) estourava "new row violates
-- row-level security policy for table responsavel_alunos".
--
-- Causa raiz: a policy original (004_responsaveis.sql) só libera
-- insert/select pra quem tem role = 'admin' (string exata — nem
-- super_admin passava) OU pra própria linha (user_id = auth.uid(),
-- usado só no caso do signUp trocar a sessão momentaneamente). Nunca
-- incluiu proprietario/diretor vinculando o responsável de OUTRA
-- pessoa — exatamente o caso do dia a dia (dono/diretor da escola
-- cadastrando os pais dos alunos). resp_alunos_update_admin/delete_admin
-- já tinham sido corrigidas pra incluir super_admin (015), mas insert e
-- select nunca foram tocadas. Mesmo padrão de gap já corrigido em
-- resetar_senha/apagar_conta_completa (007/053): aqui o vínculo entre
-- pessoas de escolas diferentes que o proprietario/diretor não é dono
-- continua bloqueado, só passa a liberar pra alunos da PRÓPRIA escola.
--
-- Rodar depois de 001 a 053. Aditiva (substitui as 4 policies antigas).
-- ════════════════════════════════════════════════════════════════

drop policy if exists resp_alunos_select on responsavel_alunos;
create policy resp_alunos_select on responsavel_alunos for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or user_id = auth.uid()
  or (
    (select role from meu_perfil()) in ('proprietario','diretor','professor')
    and aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  )
);

drop policy if exists resp_alunos_insert on responsavel_alunos;
create policy resp_alunos_insert on responsavel_alunos for insert to authenticated
with check (
  (select role from meu_perfil()) in ('admin','super_admin')
  or user_id = auth.uid()
  or (
    (select role from meu_perfil()) in ('proprietario','diretor')
    and aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  )
);

drop policy if exists resp_alunos_update_admin on responsavel_alunos;
create policy resp_alunos_update_admin on responsavel_alunos for update to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario','diretor')
    and aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  )
);

drop policy if exists resp_alunos_delete_admin on responsavel_alunos;
create policy resp_alunos_delete_admin on responsavel_alunos for delete to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario','diretor')
    and aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  )
);
