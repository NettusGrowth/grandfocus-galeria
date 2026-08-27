-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Módulo Digipix, Passo 1: banco do editor de
-- álbuns (admin). Rodar depois de 001 a 073. Aditiva.
--
-- 5 tabelas novas (album_templates, album_layout_presets,
-- album_projects, album_spreads, album_elements) + 2 colunas novas em
-- `fotos` (largura_original/altura_original).
--
-- Por que largura_original/altura_original: fotos.largura/altura
-- (071_fotos_dimensoes.sql) são da PRÉVIA/thumb (limitada a 1400px de
-- lado maior por _gerarThumbWatermark), não do arquivo original — um
-- checker de DPI de impressão usando esses números daria sempre
-- reprovado. storage_path é o original intacto, mas o banco nunca
-- guardou a resolução dele. Populadas no upload (uploadFotosEvento/
-- uploadFotosEnsaio já carregam a imagem original numa Image() antes
-- de gerar a prévia — só falta guardar width/height de lá também) e,
-- de brinde, por _otimizarThumbsFotos pra fotos antigas (ela já
-- reabre a imagem original mesmo). NULL = ainda não medida; o DPI
-- checker trata como "não verificado", nunca como aprovado às cegas.
--
-- Tudo restrito a admin/super_admin (pedido explícito: "isso é apenas
-- para ADMIN") — mesmo padrão de RLS de 060_fotos_populares.sql/
-- 063_fotos_populares_detalhe_e_reset.sql (meu_perfil(), security
-- definer), só que aqui libera `for all` (select/insert/update/
-- delete), não só select, porque o admin precisa escrever no editor.
-- GRANT explícito nas 5 tabelas — "Automatically expose new tables"
-- está desligado neste projeto (ver 005_grants.sql), sem o GRANT a
-- tabela fica inacessível pela API mesmo com RLS certa.
-- ════════════════════════════════════════════════════════════════

alter table fotos add column if not exists largura_original integer;
alter table fotos add column if not exists altura_original integer;

create table if not exists album_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  largura_aberta_mm numeric not null,
  altura_aberta_mm numeric not null,
  largura_fechada_mm numeric not null,
  altura_fechada_mm numeric not null,
  sangria_mm numeric not null default 5,
  margem_seguranca_mm numeric not null default 10,
  dpi_alvo integer not null default 300,
  tipo_dobra text not null default 'vinco' check (tipo_dobra in ('layflat', 'vinco')),
  capas_permitidas text[] not null default '{}',
  papeis_permitidos text[] not null default '{}',
  min_laminas integer not null default 1,
  max_laminas integer not null default 40,
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis(user_id) on delete set null
);

create table if not exists album_layout_presets (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- posições/tamanhos RELATIVOS (frações 0-1 da lâmina, não mm
  -- absolutos) — assim um preset criado numa lâmina de um template
  -- funciona em qualquer outro tamanho de lâmina/projeto.
  estrutura jsonb not null,
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis(user_id) on delete set null
);

create table if not exists album_projects (
  id uuid primary key default gen_random_uuid(),
  album_template_id uuid not null references album_templates(id) on delete restrict,
  evento_id uuid not null references eventos(id) on delete cascade,
  -- ainda não usado no Passo 1 (só admin) — existe desde já pro
  -- Módulo 2 (portal do cliente) não exigir migration nova depois.
  cliente_user_id uuid references perfis(user_id) on delete set null,
  nome text not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'em_diagramacao', 'em_aprovacao', 'aprovado', 'enviado_impressao')),
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis(user_id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_album_projects_evento on album_projects(evento_id);

create table if not exists album_spreads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references album_projects(id) on delete cascade,
  spread_index integer not null,
  layout_preset_id uuid references album_layout_presets(id) on delete set null,
  unique (project_id, spread_index)
);
create index if not exists idx_album_spreads_project on album_spreads(project_id);

create table if not exists album_elements (
  id uuid primary key default gen_random_uuid(),
  spread_id uuid not null references album_spreads(id) on delete cascade,
  foto_id uuid not null references fotos(id) on delete cascade,
  -- x/y/width/height em mm (não px) — resolução-independente, o
  -- canvas do editor só escala pra tela; o motor de exportação
  -- (Passo 3) converte pra px na hora de compor a impressão.
  x numeric not null default 0,
  y numeric not null default 0,
  width numeric not null,
  height numeric not null,
  rotation numeric not null default 0,
  crop_x numeric not null default 0,
  crop_y numeric not null default 0,
  crop_scale numeric not null default 1,
  z_index integer not null default 0
);
create index if not exists idx_album_elements_spread on album_elements(spread_id);

alter table album_templates enable row level security;
alter table album_layout_presets enable row level security;
alter table album_projects enable row level security;
alter table album_spreads enable row level security;
alter table album_elements enable row level security;

create policy album_templates_admin_all on album_templates for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

create policy album_layout_presets_admin_all on album_layout_presets for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

create policy album_projects_admin_all on album_projects for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

create policy album_spreads_admin_all on album_spreads for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

create policy album_elements_admin_all on album_elements for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

grant select, insert, update, delete on album_templates to authenticated;
grant select, insert, update, delete on album_layout_presets to authenticated;
grant select, insert, update, delete on album_projects to authenticated;
grant select, insert, update, delete on album_spreads to authenticated;
grant select, insert, update, delete on album_elements to authenticated;
