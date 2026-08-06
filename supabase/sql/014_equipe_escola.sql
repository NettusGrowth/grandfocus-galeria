-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — proprietário/diretor passam a enxergar (só
-- leitura) os professores/diretores da própria escola e os
-- responsáveis dos alunos dela.
--
-- Motivo: o RPC resetar_senha() já libera proprietário/diretor pra
-- redefinir senha de gente da própria escola desde o Estágio A
-- (007_contas.sql) — mas sem enxergar essas pessoas via select em
-- "perfis", o botão "Resetar senha" na nova aba Equipe não teria
-- ninguém pra listar. Rodar depois de 001 a 013. Aditiva.
--
-- De brinde: a policy antiga só liberava role = 'admin' (esquecia o
-- 'super_admin' que já existe no vocabulário desde o Estágio A) —
-- corrigido junto, já que a policy inteira está sendo recriada.
-- ════════════════════════════════════════════════════════════════

drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select to authenticated
using (
  user_id = auth.uid()
  or (select role from meu_perfil()) in ('admin','super_admin')
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
);
