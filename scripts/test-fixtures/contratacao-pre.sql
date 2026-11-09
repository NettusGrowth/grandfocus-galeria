create role anon;
create role authenticated;
create role service_role bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key
);

insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');

-- Simula somente os perfis necessários para autorizações da Central.
-- service_role não recebe SELECT em auth.users: reproduz a permissão real do Supabase.
create table public.perfis (
  user_id uuid primary key references auth.users(id),
  role text not null
);
insert into public.perfis(user_id,role)
values ('11111111-1111-4111-8111-111111111111','admin');
grant select on public.perfis to service_role;


create schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.escolas (
  id uuid primary key,
  nome text not null
);

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null,
  nome text not null,
  data date not null
);

create table public.selecao_config (
  id boolean primary key,
  infinitepay_handle text
);

insert into public.escolas(id,nome)
values ('7896da46-5dd8-4d4e-ac50-36fda4966566','Studio Entrepliés');

insert into public.eventos(id,escola_id,nome,data)
values (
  'c8ea425b-a082-40ae-9a27-79db870f5075',
  '7896da46-5dd8-4d4e-ac50-36fda4966566',
  'Entre Estações',
  current_date + 3
);

insert into public.selecao_config(id,infinitepay_handle)
values (true,'handle-de-teste');
