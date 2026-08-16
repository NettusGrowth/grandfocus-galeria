-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — libera upload de foto de perfil de OUTRA
-- pessoa pra quem gerencia contas (admin/super_admin/proprietario/
-- diretor). Sem isso, salvarProfessor()/salvarPai() na criação (que
-- fazem upload em perfis/{id da pessoa NOVA}/... logado como quem tá
-- criando) sempre falhavam a RLS de storage — avatar_self_insert
-- (007_contas.sql) só libera upload em perfis/{auth.uid()}/..., ou
-- seja, só a própria pessoa consegue subir a própria foto.
--
-- Antes disso "funcionava" só por acidente, de vez em quando: o
-- signUp() trocava a sessão ativa do client pro usuário novo por uma
-- fração de segundo (mesma corrida corrigida em 054/_criarContaAuth),
-- e se o upload da foto caísse bem nessa janela, auth.uid() batia com
-- o path por coincidência. Depois do fix definitivo do signUp
-- (cliente isolado, sessão do admin nunca mais troca), esse upload
-- passaria a falhar SEMPRE em vez de só às vezes — por isso esse fix
-- é necessário junto.
--
-- Mesmo nível de permissividade que a select já tem hoje
-- (avatar_qualquer_autenticado_select, 017_avatar_publico.sql, libera
-- pra QUALQUER autenticado) — aqui restringe a insert/update só a
-- quem de fato gerencia contas de outras pessoas no app. Rodar depois
-- de 001 a 054. Aditiva.
-- ════════════════════════════════════════════════════════════════

drop policy if exists avatar_gestor_insert on storage.objects;
create policy avatar_gestor_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'fotos-grandfocus' and name like 'perfis/%'
  and (select role from meu_perfil()) in ('admin','super_admin','proprietario','diretor')
);

drop policy if exists avatar_gestor_update on storage.objects;
create policy avatar_gestor_update on storage.objects for update to authenticated
using (
  bucket_id = 'fotos-grandfocus' and name like 'perfis/%'
  and (select role from meu_perfil()) in ('admin','super_admin','proprietario','diretor')
);
