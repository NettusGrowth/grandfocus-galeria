-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio D: comunidade isolada por escola.
-- Rodar depois de 001 a 011. Aditiva.
--
-- Regra: proprietário/diretor postam por padrão na própria escola;
-- professor só com permissoes_extra.postar_comunidade=true; admin
-- posta numa escola, em várias ou em todas (global). Ninguém vê post
-- de escola que não é a sua.
-- ════════════════════════════════════════════════════════════════

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  autor_user_id uuid references perfis(user_id) on delete set null,
  autor_nome text,
  escola_id uuid references escolas(id) on delete cascade,
  global boolean not null default false,
  destaque boolean not null default false,
  texto text,
  imagem_url text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_posts_escola on posts(escola_id);
create index if not exists idx_posts_criado on posts(criado_em desc);

create table if not exists post_escolas (
  post_id uuid not null references posts(id) on delete cascade,
  escola_id uuid not null references escolas(id) on delete cascade,
  primary key (post_id, escola_id)
);

create table if not exists post_comentarios (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  autor_user_id uuid references perfis(user_id) on delete set null,
  autor_nome text,
  texto text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_comentarios_post on post_comentarios(post_id);

create table if not exists post_reacoes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references perfis(user_id) on delete cascade,
  primary key (post_id, user_id)
);

alter table posts enable row level security;
alter table post_escolas enable row level security;
alter table post_comentarios enable row level security;
alter table post_reacoes enable row level security;

-- quais posts eu enxergo (fora do caso admin, tratado à parte nas
-- policies) — global, da minha própria escola, ou destinado a ela via
-- post_escolas; para responsável/aluno, a escola "minha" vem do filho.
create or replace function posts_visiveis()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from posts where global = true
  union
  select id from posts where escola_id = (select escola_id from meu_perfil())
  union
  select post_id from post_escolas where escola_id = (select escola_id from meu_perfil())
  union
  select id from posts where escola_id in (
    select escola_id from alunos where id in (select aluno_id from meus_alunos()) and escola_id is not null
  )
  union
  select post_id from post_escolas where escola_id in (
    select escola_id from alunos where id in (select aluno_id from meus_alunos()) and escola_id is not null
  )
$$;
grant execute on function posts_visiveis() to authenticated;

-- posso postar na comunidade de uma escola específica?
create or replace function posso_postar(alvo_escola_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (select role from meu_perfil()) in ('admin','super_admin')
    or (
      (select role from meu_perfil()) in ('proprietario','diretor')
      and (select escola_id from meu_perfil()) = alvo_escola_id
    )
    or (
      (select role from meu_perfil()) = 'professor'
      and (select escola_id from meu_perfil()) = alvo_escola_id
      and exists (select 1 from permissoes_extra where user_id = auth.uid() and chave = 'postar_comunidade' and valor = true)
    )
$$;
grant execute on function posso_postar(uuid) to authenticated;

-- ── posts ───────────────────────────────────────────────────────
create policy posts_select on posts for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or id in (select posts_visiveis())
);
create policy posts_insert on posts for insert to authenticated
with check (
  (select role from meu_perfil()) in ('admin','super_admin')
  or (escola_id is not null and global = false and posso_postar(escola_id))
);
create policy posts_delete on posts for delete to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or autor_user_id = auth.uid()
);

-- ── post_escolas (destinos extra de um post do admin) — só admin ──
create policy post_escolas_admin_all on post_escolas for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

-- ── comentários ─────────────────────────────────────────────────
create policy comentarios_select on post_comentarios for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or post_id in (select posts_visiveis())
);
create policy comentarios_insert on post_comentarios for insert to authenticated
with check (
  autor_user_id = auth.uid()
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or post_id in (select posts_visiveis())
  )
);
create policy comentarios_delete on post_comentarios for delete to authenticated
using (
  autor_user_id = auth.uid()
  or (select role from meu_perfil()) in ('admin','super_admin')
);

-- ── reações ─────────────────────────────────────────────────────
create policy reacoes_select on post_reacoes for select to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or post_id in (select posts_visiveis())
);
create policy reacoes_insert on post_reacoes for insert to authenticated
with check (
  user_id = auth.uid()
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or post_id in (select posts_visiveis())
  )
);
create policy reacoes_delete on post_reacoes for delete to authenticated
using (user_id = auth.uid());

grant select, insert, delete on posts, post_escolas, post_comentarios, post_reacoes to authenticated;

-- ── storage: imagem de post, mesmo bucket privado ──────────────────
create policy post_imagem_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and name like 'posts/%'
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or (
      split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
      and split_part(name,'/',2)::uuid in (select posts_visiveis())
    )
  )
);
create policy post_imagem_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'fotos-grandfocus'
  and name like 'posts/%'
  and (
    (select role from meu_perfil()) in ('admin','super_admin','proprietario','diretor')
    or (
      (select role from meu_perfil()) = 'professor'
      and exists (select 1 from permissoes_extra where user_id = auth.uid() and chave = 'postar_comunidade' and valor = true)
    )
  )
);
