-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — completa o fix de super_admin (014 só tinha
-- corrigido perfis_select) e trava tipo/tamanho de arquivo no bucket.
-- Rodar depois de 001 a 014. Aditiva.
--
-- Varredura completa: toda policy escrita ANTES do Estágio A
-- (002/003/004 — antes do role super_admin existir) checa literalmente
-- role = 'admin'. Toda policy escrita DEPOIS (007 em diante) já nasceu
-- checando IN ('admin','super_admin'). Isso aqui conserta as 13 que
-- ficaram pra trás. Hoje não morde ninguém (a conta real é 'admin'),
-- mas sem isso qualquer conta futura criada como 'super_admin' fica
-- praticamente cega/travada no sistema.
-- ════════════════════════════════════════════════════════════════

-- ── perfis (só faltava update/delete — select já foi corrigido em 014) ──
drop policy if exists perfis_update_admin on perfis;
create policy perfis_update_admin on perfis for update to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
drop policy if exists perfis_delete_admin on perfis;
create policy perfis_delete_admin on perfis for delete to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));

-- ── escolas / alunos / eventos / fotos / foto_aluno ──────────────────
drop policy if exists escolas_admin_all on escolas;
create policy escolas_admin_all on escolas for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists alunos_admin_all on alunos;
create policy alunos_admin_all on alunos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists eventos_admin_all on eventos;
create policy eventos_admin_all on eventos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists fotos_admin_all on fotos;
create policy fotos_admin_all on fotos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists foto_aluno_admin_all on foto_aluno;
create policy foto_aluno_admin_all on foto_aluno for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

-- ── responsavel_alunos ────────────────────────────────────────────
drop policy if exists resp_alunos_update_admin on responsavel_alunos;
create policy resp_alunos_update_admin on responsavel_alunos for update to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
drop policy if exists resp_alunos_delete_admin on responsavel_alunos;
create policy resp_alunos_delete_admin on responsavel_alunos for delete to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));

-- ── storage.objects (select usa storage_paths_visiveis(), que já existe
--    e não precisa mudar — só o bypass de admin dentro da policy) ─────
drop policy if exists fotos_storage_select on storage.objects;
create policy fotos_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or name in (select storage_paths_visiveis())
  )
);

drop policy if exists fotos_storage_admin_insert on storage.objects;
create policy fotos_storage_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists fotos_storage_admin_update on storage.objects;
create policy fotos_storage_admin_update on storage.objects for update to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) in ('admin','super_admin'));

drop policy if exists fotos_storage_admin_delete on storage.objects;
create policy fotos_storage_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) in ('admin','super_admin'));

-- ── bucket: só imagem, até 25MB (hoje não tinha nenhum limite) ───────
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
    file_size_limit = 26214400
where id = 'fotos-grandfocus';
