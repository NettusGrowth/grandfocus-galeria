-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — schema base.
-- Rodar UMA vez, num projeto Supabase NOVO e separado do painel-nettus
-- (fotos de pessoas — não misturar bancos).
-- Depois deste arquivo, rodar 002_rls.sql e 003_storage.sql, nessa ordem.
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- escola de dança — dono de um "espaço" na galeria
create table if not exists escolas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text,
  criado_em timestamptz not null default now()
);

-- bailarino — se escola_id for null, é aluno avulso (sem escola/instituição)
create table if not exists alunos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  escola_id uuid references escolas(id) on delete set null,
  criado_em timestamptz not null default now()
);

-- evento = sessão/turma/espetáculo — unidade de organização do upload
-- escola_id null = evento aberto/avulso (ex: ensaio de um bailarino avulso)
create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data date,
  escola_id uuid references escolas(id) on delete set null,
  criado_em timestamptz not null default now()
);

create table if not exists fotos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references eventos(id) on delete cascade,
  storage_path text not null unique,
  criado_em timestamptz not null default now()
);

-- marcação N:N — quais alunos aparecem em cada foto (pode ser mais de um)
create table if not exists foto_aluno (
  foto_id uuid not null references fotos(id) on delete cascade,
  aluno_id uuid not null references alunos(id) on delete cascade,
  primary key (foto_id, aluno_id)
);

-- perfil de acesso — toda conta de login (Supabase Auth) tem uma linha aqui
-- dizendo o papel: admin (equipe Grand Focus), escola (dono de uma escola)
-- ou aluno (bailarino individual — obrigatório pros avulsos).
create table if not exists perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','escola','aluno')),
  escola_id uuid references escolas(id) on delete set null,
  aluno_id uuid references alunos(id) on delete set null,
  nome text,
  criado_em timestamptz not null default now(),
  constraint perfil_escola_check check (role <> 'escola' or escola_id is not null),
  constraint perfil_aluno_check check (role <> 'aluno' or aluno_id is not null)
);

create index if not exists idx_alunos_escola on alunos(escola_id);
create index if not exists idx_eventos_escola on eventos(escola_id);
create index if not exists idx_fotos_evento on fotos(evento_id);
create index if not exists idx_foto_aluno_aluno on foto_aluno(aluno_id);
create index if not exists idx_perfis_escola on perfis(escola_id);
create index if not exists idx_perfis_aluno on perfis(aluno_id);
