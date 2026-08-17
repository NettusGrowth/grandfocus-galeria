-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — auditoria completa de papéis: 2 fixes de RLS.
-- Rodar depois de 001 a 061. Aditiva (substitui só as 2 funções/
-- policy abaixo).
--
-- 1) SEGURANÇA — alunos_visiveis() (008/018) devolvia TODOS os alunos
-- da escola do meu filho, não só o próprio filho: a função filtra
-- "alunos where escola_id in (select escolas_visiveis())", e
-- escolas_visiveis() já inclui a escola do filho pra responsável. É
-- usada em UM lugar só: a policy de storage perfil_fotos_select
-- (008_escolas_alunos.sql), que libera leitura de "alunos/{aluno_id}/
-- foto.ext". Ou seja: um responsável que soubesse/adivinhasse o UUID
-- de outro aluno da MESMA escola do próprio filho conseguia pedir a
-- signed URL da foto de perfil dele via storage, mesmo sem nenhum
-- vínculo. Esse mesmo risco já tinha sido identificado e corrigido
-- pra escolas_select/alunos_select em 022_bloco6.sql (comentário:
-- "Importante NÃO usar alunos_visiveis()/escolas_visiveis() direto
-- aqui... qualquer responsável passaria a enxergar a lista COMPLETA
-- de alunos da escola do filho") — só que a correção nunca foi
-- replicada pra essa função, que ficou esquecida desde 008/018.
-- Fix: mesmo padrão já usado (e testado em produção) em alunos_select
-- (024_fix_recursao_perfis.sql) — escola_id in
-- minhas_escolas_vinculo() (só cobre staff: professor/diretor/
-- proprietario/admin, que já podiam ver a escola inteira mesmo) OR
-- meus_alunos() (só os próprios filhos). Pra responsável (escola_id
-- sempre null, sem vínculo em professor_escolas), isso equivale a "só
-- meus_alunos()" — exatamente o que devia ser desde o início.
create or replace function alunos_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from alunos where escola_id in (select minhas_escolas_vinculo())
  union
  select aluno_id from meus_alunos()
$$;

-- 2) FUNCIONAL — foto_aluno_select (004_responsaveis.sql) nunca foi
-- atualizada pra considerar professor_escolas (professor com vínculo
-- em mais de uma escola) — ainda compara "escola_id = (select
-- escola_id from meu_perfil())" direto, a escola PRINCIPAL só.
-- eventos_select/fotos_select/alunos_select já usam
-- minhas_escolas_vinculo() desde 022/024; essa ficou pra trás. Efeito:
-- um professor só-vinculado (ou secundário) via professor_escolas via
-- a FOTO normalmente (fotos_select já corrigida), mas os chips "por
-- aluno" no álbum (que leem foto_aluno) ficavam vazios/incompletos
-- pras fotos daquela escola — sub-permissionamento, não vazamento de
-- dado (fotos_admin_all/fotos_select nunca dependeram dessa policy).
drop policy if exists foto_aluno_select on foto_aluno;
create policy foto_aluno_select on foto_aluno for select to authenticated
using (
  aluno_id in (select aluno_id from meus_alunos())
  or aluno_id in (select id from alunos where escola_id in (select minhas_escolas_vinculo()))
);
