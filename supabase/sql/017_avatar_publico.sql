-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — foto de perfil/capa (path perfis/{user_id}/...)
-- vira visível pra qualquer autenticado, não só o dono.
--
-- Por quê: avatar_self_select (007_contas.sql) só deixava CADA UM ver a
-- PRÓPRIA foto — então quando um professor trocava a foto, ela sumia
-- pra todo mundo (admin, colegas de escola, etc.), só o dono via.
-- Continua sendo foto profissional de adulto (admin/professor/diretor/
-- responsável), não é a mesma sensibilidade de foto de criança — essa
-- continua trancada em storage_paths_visiveis()/fotos_storage_select,
-- não é afetada por essa migration.
--
-- Rodar depois de 001 a 016. Aditiva.
-- ════════════════════════════════════════════════════════════════

create policy avatar_qualquer_autenticado_select on storage.objects for select to authenticated
using (bucket_id = 'fotos-grandfocus' and name like 'perfis/%');
