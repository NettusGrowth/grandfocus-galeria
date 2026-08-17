-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — módulo "CRM GrandFocus": cadastro de leads,
-- pipelines/etapas customizáveis, atividades, anotações, histórico,
-- ganho/perdido com motivo, import em massa. Rodar depois de 001 a
-- 067. Aditiva.
--
-- Baseado no CRM da Nettus (painel-nettus), adaptado pro cenário de
-- uma fotógrafa de escolas de dança e ensaios avulsos:
-- - `crm_leads.tipo_contato` distingue prospecção de ESCOLA (parceria
--   recorrente, múltiplos alunos) de cliente AVULSO (ensaio único) —
--   a Nettus só vende B2B pra empresa, aqui o negócio é misto.
-- - `origem_evento_nome` é um campo específico desse negócio: "onde
--   ela conheceu o trabalho" (ex: viu nas fotos de outro festival),
--   que não existe na Nettus e ajuda a entender que evento gera mais
--   indicação.
-- - `crm_motivos_perda` é uma TABELA de verdade, não localStorage —
--   na Nettus isso ficou preso ao navegador de quem configurou (não
--   sincroniza entre contas, se perde limpando o navegador) e ainda
--   tinha DUAS telas de configuração mantidas em paralelo por
--   engano. Aqui é uma única fonte, compartilhada, editável por
--   qualquer admin.
-- - RLS: mesmo nível de Agenda/Gold Reserve (admin/super_admin) — dado
--   comercial não é visível pra escola/professor/responsável.
-- ════════════════════════════════════════════════════════════════

create table if not exists crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists crm_etapas (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references crm_pipelines(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  -- etapas "terminais" pintam o card e saem do funil de conversão —
  -- sem essa flag não dá pra saber, só pelo nome, se "Fechado" ou
  -- "Perdido" é uma etapa comum ou o fim de linha.
  tipo_final text check (tipo_final in ('ganho','perdido')),
  criado_em timestamptz not null default now()
);
create index if not exists idx_crm_etapas_pipeline on crm_etapas(pipeline_id, ordem);

create table if not exists crm_motivos_perda (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists crm_leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo_contato text not null default 'avulso' check (tipo_contato in ('escola', 'avulso', 'outro')),
  escola_nome text,
  telefone text,
  email text,
  cidade text,
  tipo_lead text not null default 'outbound' check (tipo_lead in ('outbound', 'inbound', 'indicacao')),
  canal text,
  origem_evento_nome text,
  pipeline_id uuid references crm_pipelines(id) on delete set null,
  etapa_id uuid references crm_etapas(id) on delete set null,
  etapa_desde timestamptz not null default now(),
  ordem int not null default 0,
  prioridade boolean not null default false,
  responsavel_id uuid references perfis(user_id) on delete set null,
  valor_potencial numeric(10,2) not null default 0,
  valor_fechado numeric(10,2),
  data_reuniao_marcada timestamptz,
  data_fechamento date,
  motivo_perda text,
  proximo_follow_up date,
  observacoes text,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_crm_leads_etapa on crm_leads(etapa_id);
create index if not exists idx_crm_leads_pipeline on crm_leads(pipeline_id);
create index if not exists idx_crm_leads_responsavel on crm_leads(responsavel_id);

create table if not exists crm_atividades (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  tipo text not null default 'ligacao' check (tipo in ('ligacao', 'whatsapp', 'email', 'visita', 'reuniao', 'outro')),
  data_prevista date not null,
  hora_prevista time,
  obs text,
  status text not null default 'pendente' check (status in ('pendente', 'concluida')),
  responsavel_id uuid references perfis(user_id) on delete set null,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_crm_atividades_lead on crm_atividades(lead_id, data_prevista);

create table if not exists crm_anotacoes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  texto text not null,
  autor_id uuid references perfis(user_id) on delete set null,
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_crm_anotacoes_lead on crm_anotacoes(lead_id, criado_em desc);

create table if not exists crm_historico (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  tipo text not null default 'estagio' check (tipo in ('estagio', 'evento')),
  etapa_anterior_nome text,
  etapa_nova_nome text,
  obs text,
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_crm_historico_lead on crm_historico(lead_id, criado_em desc);

alter table crm_pipelines enable row level security;
alter table crm_etapas enable row level security;
alter table crm_motivos_perda enable row level security;
alter table crm_leads enable row level security;
alter table crm_atividades enable row level security;
alter table crm_anotacoes enable row level security;
alter table crm_historico enable row level security;

create policy crm_pipelines_admin on crm_pipelines for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_etapas_admin on crm_etapas for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_motivos_perda_admin on crm_motivos_perda for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_leads_admin on crm_leads for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_atividades_admin on crm_atividades for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_anotacoes_admin on crm_anotacoes for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
create policy crm_historico_admin on crm_historico for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

grant select, insert, update, delete on crm_pipelines, crm_etapas, crm_motivos_perda, crm_leads, crm_atividades, crm_anotacoes, crm_historico to authenticated;

-- pipeline padrão + funil comercial padrão pra fotógrafa de escolas de
-- dança/ensaios avulsos — já nasce funcional, sem precisar criar do
-- zero antes do primeiro uso. on conflict não existe aqui de propósito
-- (não há coluna única pra pipeline "padrão") — protegido por um
-- guard de "só insere se a tabela estiver vazia".
do $$
declare
  v_pipeline_id uuid;
begin
  if not exists (select 1 from crm_pipelines) then
    insert into crm_pipelines (nome, ordem) values ('Comercial', 0) returning id into v_pipeline_id;
    insert into crm_etapas (pipeline_id, nome, ordem, tipo_final) values
      (v_pipeline_id, 'Novo Lead', 0, null),
      (v_pipeline_id, 'Primeiro Contato', 1, null),
      (v_pipeline_id, 'Visita/Reunião Agendada', 2, null),
      (v_pipeline_id, 'Proposta Enviada', 3, null),
      (v_pipeline_id, 'Negociação', 4, null),
      (v_pipeline_id, 'Fechado', 5, 'ganho'),
      (v_pipeline_id, 'Perdido', 6, 'perdido');
  end if;
  if not exists (select 1 from crm_motivos_perda) then
    insert into crm_motivos_perda (texto, ordem) values
      ('Preço', 0), ('Escolheu outro fotógrafo', 1), ('Sem retorno/sumiu', 2),
      ('Data incompatível', 3), ('Não era o momento', 4), ('Fora da região', 5), ('Outro', 6);
  end if;
end $$;
