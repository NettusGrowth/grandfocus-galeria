-- Portfólio privado do super_admin.
-- Isolado da tabela fotos: não altera permissões, uploads, downloads ou galerias existentes.

create table if not exists public.portfolio_favoritos (
  foto_id uuid primary key references public.fotos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  marcado_por uuid not null default auth.uid()
);

alter table public.portfolio_favoritos enable row level security;

grant select, insert, delete on public.portfolio_favoritos to authenticated;
revoke all on public.portfolio_favoritos from anon;

drop policy if exists portfolio_favoritos_super_admin_select on public.portfolio_favoritos;
create policy portfolio_favoritos_super_admin_select
on public.portfolio_favoritos
for select
to authenticated
using (
  (select mp.role from public.meu_perfil() mp limit 1) = 'super_admin'
);

drop policy if exists portfolio_favoritos_super_admin_insert on public.portfolio_favoritos;
create policy portfolio_favoritos_super_admin_insert
on public.portfolio_favoritos
for insert
to authenticated
with check (
  (select mp.role from public.meu_perfil() mp limit 1) = 'super_admin'
  and marcado_por = (select auth.uid())
);

drop policy if exists portfolio_favoritos_super_admin_delete on public.portfolio_favoritos;
create policy portfolio_favoritos_super_admin_delete
on public.portfolio_favoritos
for delete
to authenticated
using (
  (select mp.role from public.meu_perfil() mp limit 1) = 'super_admin'
);
