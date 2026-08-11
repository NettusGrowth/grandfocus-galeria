-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige regressão introduzida na 048.
--
-- ERRO (meu, na 048): a policy ficou com "role in ('admin',
-- 'super_admin')" sem qualificador — isso testa o cargo da LINHA
-- sendo lida, não o cargo de QUEM está pedindo. Resultado: um
-- admin/super_admin deixou de conseguir ver qualquer perfil que não
-- seja de outro admin (proprietário, diretor, professor, pai, aluno
-- todos ficaram invisíveis pra ele) — é por isso que a Nicole Ramirez
-- sumiu da lista "Professores & Diretores" da Ana Paula, mesmo com o
-- perfil dela intacta no banco (role=proprietario, escola vinculada).
--
-- CORREÇÃO: separa em duas condições — a de verdade que a 048 queria
-- (readervolta a enxergar tudo se ELE é admin/super_admin, igual
-- sempre foi desde o Bloco 6) E a nova que a 048 pediu (qualquer
-- autenticado vê a linha de um admin/super_admin, pro nome/foto dele
-- aparecer em posts/auditoria pros outros). Rodar depois de 048.
-- ════════════════════════════════════════════════════════════════

drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select to authenticated
using (
  user_id = auth.uid()
  or (select role from meu_perfil()) in ('admin','super_admin')
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
