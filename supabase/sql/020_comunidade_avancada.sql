-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 5: reações com tipo, comentários em
-- thread, múltiplas fotos/vídeo por post, e trava de "destaque" real
-- no banco (antes só escondia o checkbox no client — quem tivesse
-- postar_comunidade conseguia forjar destaque=true na mão).
-- Rodar depois de 001 a 019. Aditiva.
-- ════════════════════════════════════════════════════════════════

-- ── reações: vira "1 reação por pessoa por post, com tipo" em vez de
-- só curtir/não-curtir. Trocar de tipo é um update, não insert+delete. ──
alter table post_reacoes add column if not exists tipo text not null default 'curtir';
alter table post_reacoes drop constraint if exists post_reacoes_tipo_check;
alter table post_reacoes add constraint post_reacoes_tipo_check check (tipo in ('curtir','amei','parabens','ciente'));

drop policy if exists reacoes_update on post_reacoes;
create policy reacoes_update on post_reacoes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── comentários em thread (resposta a um comentário existente) ──────
alter table post_comentarios add column if not exists parent_id uuid references post_comentarios(id) on delete cascade;
create index if not exists idx_comentarios_parent on post_comentarios(parent_id);

-- ── múltiplas fotos/vídeo por post (posts.imagem_url continua existindo
-- por compatibilidade com posts antigos; posts novos usam post_midias) ──
create table if not exists post_midias (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  tipo text not null check (tipo in ('foto','video')),
  storage_path text not null,
  ordem int not null default 0
);
create index if not exists idx_post_midias_post on post_midias(post_id);
alter table post_midias enable row level security;

create policy post_midias_select on post_midias for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or post_id in (select posts_visiveis())
);
create policy post_midias_insert on post_midias for insert to authenticated
with check (
  post_id in (select id from posts where autor_user_id = auth.uid())
  or (select role from meu_perfil()) in ('admin','super_admin')
);
create policy post_midias_delete on post_midias for delete to authenticated
using (
  post_id in (select id from posts where autor_user_id = auth.uid())
  or (select role from meu_perfil()) in ('admin','super_admin')
);
grant select, insert, delete on post_midias to authenticated;

-- ── trava de "destaque" no banco: só quem já tinha a opção visível na
-- UI (admin/super_admin/proprietario/diretor) consegue de fato gravar
-- destaque=true — mesmo chamando a API direto, sem passar pela tela. ──
drop policy if exists posts_insert on posts;
create policy posts_insert on posts for insert to authenticated
with check (
  (select role from meu_perfil()) in ('admin','super_admin')
  or (
    escola_id is not null and global = false and posso_postar(escola_id)
    and (destaque = false or (select role from meu_perfil()) in ('proprietario','diretor'))
  )
);
