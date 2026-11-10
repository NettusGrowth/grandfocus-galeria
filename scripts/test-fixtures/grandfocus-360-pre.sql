-- Apenas PostgreSQL temporário do CI: simula módulos base de 001–079.
-- Não faz parte da migração de produção. Executar após testar 092.
create table if not exists public.alunos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  escola_id uuid references public.escolas(id)
);
create table if not exists public.agenda_compromissos (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.gr_lancamentos (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create table if not exists public.crm_etapas (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  tipo_final text,
  criado_em timestamptz not null default now()
);
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  etapa_id uuid references public.crm_etapas(id) on delete set null
);
-- Em produção estes GRANTs já existem nas migrations CRM/Gold Reserve.
-- O runner usa stubs criados somente para este teste.
grant select,insert,update,delete on
 public.crm_pipelines,public.crm_etapas,public.crm_leads,
 public.alunos,public.agenda_compromissos,public.gr_lancamentos
 to service_role;

create or replace function public.meu_perfil()
returns table(role text) language sql stable security invoker set search_path=''
as $$select p.role from public.perfis p where p.user_id='11111111-1111-4111-8111-111111111111'::uuid$$;
