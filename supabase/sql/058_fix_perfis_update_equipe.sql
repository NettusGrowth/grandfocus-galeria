-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — proprietario/diretor não conseguiam EDITAR um
-- professor/diretor/responsável existente da própria escola.
--
-- BUG (latente, achado na auditoria — nunca tinha sido exercitado
-- porque a aba Equipe nunca ofereceu um botão de editar, só resetar
-- senha): perfis_update_admin (desde 002_rls.sql, nunca revista) é
-- estritamente admin/super_admin. salvarProfessor()/salvarPai() no
-- modo edição fazem update direto na tabela perfis (não passam por
-- RPC) — então mesmo com o botão de criar já liberado (057), editar
-- alguém que já existe continuava batendo em "permission denied" pra
-- proprietario/diretor. Essa migration corrige isso e a aba Equipe
-- ganha os botões de editar que faltavam.
--
-- Mesmo escopo do fix de insert (057): professor/diretor só da PRÓPRIA
-- escola. responsavel não tem escola_id na própria linha (só é ligado
-- via responsavel_alunos) — usa o mesmo JOIN que perfis_select já usa
-- (048/050) pra confirmar que esse responsável tem pelo menos um filho
-- na escola de quem está editando.
--
-- Rodar depois de 001 a 057. Aditiva.
-- ════════════════════════════════════════════════════════════════

drop policy if exists perfis_update_admin on perfis;
create policy perfis_update_admin on perfis for update to authenticated
using (
  (select role from meu_perfil()) in ('admin', 'super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario', 'diretor')
    and (
      (role in ('professor', 'diretor') and escola_id is not distinct from (select escola_id from meu_perfil()))
      or (role = 'responsavel' and user_id in (
        select ra.user_id from responsavel_alunos ra
        join alunos al on al.id = ra.aluno_id
        where al.escola_id = (select escola_id from meu_perfil())
      ))
    )
  )
);

-- ── segundo achado da mesma auditoria: "Personalizar comunidade" (o
-- lapis que aparece no cabecalho do mural pra admin/proprietario/
-- diretor, _abrirEditarComunidadeHeader) tenta um UPDATE direto em
-- escolas — mas escolas_admin_all (015) so libera admin/super_admin.
-- proprietario/diretor sempre bateram em "permission denied" ao tentar
-- salvar o nome/capa da propria comunidade. Aditiva (nao mexe na
-- policy de admin, so soma mais um caso permitido) — so UPDATE, so na
-- PROPRIA escola (nao da pra criar/apagar escola nem editar outra).
create policy escolas_update_propria on escolas for update to authenticated
using (
  (select role from meu_perfil()) in ('proprietario', 'diretor')
  and id = (select escola_id from meu_perfil())
)
with check (
  (select role from meu_perfil()) in ('proprietario', 'diretor')
  and id = (select escola_id from meu_perfil())
);
