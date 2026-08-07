-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige "new row violates row-level security
-- policy for table posts" ao publicar como proprietário/diretor/
-- professor. Rodar depois de 001 a 028. Aditiva.
--
-- Causa raiz (confirmada testando no SQL Editor): o client faz
-- .insert({...}).select().single(), que vira um INSERT ... RETURNING.
-- Com RLS, o Postgres não confere só a policy de INSERT (posts_insert)
-- pra liberar a escrita — ele TAMBÉM confere se a linha recém-criada
-- passa pela policy de SELECT (posts_select) antes de devolver ela no
-- RETURNING. Pra quem não é admin, posts_select depende de
-- posts_visiveis() (função STABLE) — e o resultado dessa função pode
-- ficar "congelado" de antes do INSERT acontecer dentro da mesma
-- consulta, então a linha nova (que acabou de nascer) ainda não
-- aparece nesse conjunto na hora da conferência do RETURNING, mesmo
-- ela batendo com a condição "escola_id = minha escola" se a função
-- fosse reavaliada do zero. Um INSERT puro (sem RETURNING) nunca
-- esbarra nisso — só quem já é admin postava até agora, e a policy do
-- admin libera por cargo direto, sem passar por posts_visiveis() -
-- por isso o bug nunca tinha aparecido.
--
-- Correção: quem criou o post sempre pode ver o PRÓPRIO post, direto
-- por comparação de coluna (autor_user_id = auth.uid()) — sem
-- depender de nenhuma função com cache, resolve o problema do
-- RETURNING pra sempre, e de quebra é uma regra que sempre devia
-- existir (autor sempre vê o que postou).
-- ════════════════════════════════════════════════════════════════

drop policy if exists posts_select on posts;
create policy posts_select on posts for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or autor_user_id = auth.uid()
  or id in (select posts_visiveis())
);
