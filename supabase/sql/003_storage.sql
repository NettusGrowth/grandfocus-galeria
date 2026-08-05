-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — storage (rodar depois de 001 e 002).
--
-- Bucket PRIVADO — nunca use getPublicUrl() nele. O app sempre pede uma
-- signed URL (createSignedUrl) na hora do download; essa policy de select
-- é o que faz a signed URL só funcionar se o usuário tiver direito à
-- foto (mesma regra de acesso da tabela `fotos`, replicada aqui porque
-- storage.objects é uma tabela separada, com RLS própria).
-- ════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('fotos-grandfocus', 'fotos-grandfocus', false)
on conflict (id) do nothing;

create policy fotos_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and (
    (select role from meu_perfil()) = 'admin'
    or name in (
      select storage_path from fotos
      where evento_id in (select id from eventos where escola_id = (select escola_id from meu_perfil()))
    )
    or name in (
      select f.storage_path from fotos f
      join foto_aluno fa on fa.foto_id = f.id
      where fa.aluno_id = (select aluno_id from meu_perfil())
    )
  )
);

create policy fotos_storage_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');

create policy fotos_storage_admin_update on storage.objects for update to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');

create policy fotos_storage_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');
