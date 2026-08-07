-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — reverte o upload de fotos liberado pra equipe
-- da escola no Bloco 6 (022_bloco6.sql). Rodar depois de 001 a 026.
-- Aditiva (só troca as 3 policies de volta).
--
-- Por quê: decisão de negócio revista — só a Grand Focus (admin/
-- super_admin) sobe foto nas galerias dos eventos/ensaios. Escola,
-- proprietário, diretor e professor voltam a ser só leitura/download
-- (o que já enxergavam continua igual, via eventos_visiveis() etc. —
-- essa migration não mexe em nenhuma policy de SELECT, só reverte as
-- 3 de INSERT que o Bloco 6 tinha aberto).
-- ════════════════════════════════════════════════════════════════

drop policy if exists fotos_escola_insert on fotos;
create policy fotos_escola_insert on fotos for insert to authenticated
with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists foto_aluno_escola_insert on foto_aluno;
create policy foto_aluno_escola_insert on foto_aluno for insert to authenticated
with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists fotos_storage_escola_insert on storage.objects;
create policy fotos_storage_escola_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'fotos-grandfocus'
  and (select role from meu_perfil()) in ('admin','super_admin')
);
