-- 093 · Grand Focus 360º — base aditiva e reversível de vínculos.
-- Não cria contas Auth, não importa registros legados, não altera pagamentos.
-- Habilitação automática somente em migração futura, após revisar consentimentos,
-- UX de identificação, conciliação e testes de concorrência.
-- Compatível com todos os cadastros históricos.
--
-- PRINCÍPIO:
-- Um contato (pessoa) pode ser responsável por vários alunos, também ser
-- bailarina adulta e eventualmente ter uma conta de acesso independente.
-- Não se presume identidade por nome, telefone ou e-mail isolados.

create table if not exists public.gf_contatos (
 id uuid primary key default gen_random_uuid(),
 nome text not null check (length(btrim(nome)) between 3 and 160),
 telefone text,
 telefone_normalizado text,
 email text,
 perfil_user_id uuid unique references public.perfis(user_id) on delete set null,
 identidade_status text not null default 'nao_verificada'
  check (identidade_status in ('nao_verificada','em_revisao','verificada')),
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now()
);
create index if not exists gf_contatos_telefone_idx
 on public.gf_contatos(telefone_normalizado) where telefone_normalizado is not null;
create index if not exists gf_contatos_email_idx
 on public.gf_contatos(lower(btrim(email))) where email is not null;
create index if not exists gf_contatos_nome_idx
 on public.gf_contatos(lower(btrim(nome)));

create table if not exists public.gf_contato_alunos (
 contato_id uuid not null references public.gf_contatos(id) on delete restrict,
 aluno_id uuid not null references public.alunos(id) on delete restrict,
 vinculo text not null check (vinculo in (
  'mae','pai','responsavel_legal','familiar','proprio_aluno','outro'
 )),
 verificacao_status text not null default 'pendente'
  check (verificacao_status in ('pendente','verificado','recusado')),
 verificacao_em timestamptz,
 criado_em timestamptz not null default now(),
 primary key(contato_id,aluno_id,vinculo)
);
create index if not exists gf_contato_alunos_aluno_idx on public.gf_contato_alunos(aluno_id);

-- Integra inscrição e cadastro sem forçar uma correspondência ambígua.
-- Pessoa que preencheu pode ser uma aluna adulta, mãe, pai ou outro responsável.
create table if not exists public.gf_form_contatos (
 resposta_id uuid not null references public.gf_contratacao_form_respostas(id) on delete restrict,
 contato_id uuid not null references public.gf_contatos(id) on delete restrict,
 papel text not null check(papel in ('preenchedor','responsavel_legal','outro_contato')),
 criado_em timestamptz not null default now(),
 primary key(resposta_id,contato_id,papel)
);
create index if not exists gf_form_contatos_contato_idx on public.gf_form_contatos(contato_id);

create table if not exists public.gf_form_alunos (
 resposta_id uuid not null references public.gf_contratacao_form_respostas(id) on delete restrict,
 indice_aluno smallint not null check(indice_aluno between 0 and 20),
 aluno_id uuid references public.alunos(id) on delete restrict,
 vinculacao_status text not null default 'aguarda_conferencia'
  check(vinculacao_status in ('aguarda_conferencia','candidato','confirmado','sem_correspondencia')),
 vinculado_em timestamptz,
 criado_em timestamptz not null default now(),
 primary key(resposta_id,indice_aluno)
);
create index if not exists gf_form_alunos_aluno_idx
 on public.gf_form_alunos(aluno_id) where aluno_id is not null;

-- Uma semelhança NÃO autoriza unir identidades nem conceder acesso a fotos.
create table if not exists public.gf_identidade_pendencias (
 id uuid primary key default gen_random_uuid(),
 resposta_id uuid not null references public.gf_contratacao_form_respostas(id) on delete restrict,
 indice_aluno smallint,
 motivo text not null check(motivo in (
  'mesmo_nome','contato_compartilhado','escola_nao_localizada',
  'responsavel_nao_confirmado','dados_insuficientes','outro'
 )),
 status text not null default 'pendente'
  check(status in ('pendente','resolvida','descartada')),
 notas_internas text,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now()
);
create index if not exists gf_identidade_pendencias_status_idx
 on public.gf_identidade_pendencias(status,criado_em) where status='pendente';

-- O CRM continua a ter leads de ESCOLA e de FAMÍLIA em funis distintos,
-- mas sempre com referência ao contato/escola canônicos quando confirmados.
alter table public.crm_leads
 add column if not exists contato_id uuid references public.gf_contatos(id) on delete set null,
 add column if not exists escola_id uuid references public.escolas(id) on delete set null,
 add column if not exists resposta_form_id uuid references public.gf_contratacao_form_respostas(id) on delete set null;
create index if not exists gf_crm_leads_contato_idx
 on public.crm_leads(contato_id) where contato_id is not null;
create index if not exists gf_crm_leads_escola_idx
 on public.crm_leads(escola_id) where escola_id is not null;
create index if not exists gf_crm_leads_resposta_idx
 on public.crm_leads(resposta_form_id) where resposta_form_id is not null;

-- Não toca no funil existente "Comercial"; novos funis configuráveis e independentes.
insert into public.crm_pipelines(nome,ordem)
select 'Parcerias com Escolas',10
where not exists (select 1 from public.crm_pipelines where nome='Parcerias com Escolas');
insert into public.crm_pipelines(nome,ordem)
select 'Famílias e Ensaios',20
where not exists (select 1 from public.crm_pipelines where nome='Famílias e Ensaios');

insert into public.crm_etapas(pipeline_id,nome,ordem,tipo_final)
select p.id, etapa.nome, etapa.ordem, etapa.tipo_final
from public.crm_pipelines p
join (values
 ('Parcerias com Escolas','Mapeada',0,null::text),
 ('Parcerias com Escolas','Primeiro contato',10,null::text),
 ('Parcerias com Escolas','Conversa ativa',20,null::text),
 ('Parcerias com Escolas','Reunião agendada',30,null::text),
 ('Parcerias com Escolas','Proposta enviada',40,null::text),
 ('Parcerias com Escolas','Negociação',50,null::text),
 ('Parcerias com Escolas','Parceria fechada',60,'ganho'::text),
 ('Parcerias com Escolas','Não convertida',70,'perdido'::text),
 ('Famílias e Ensaios','Contato recebido',0,null::text),
 ('Famílias e Ensaios','Em atendimento',10,null::text),
 ('Famílias e Ensaios','Orçamento enviado',20,null::text),
 ('Famílias e Ensaios','Agendamento solicitado',30,null::text),
 ('Famílias e Ensaios','Aguardando pagamento',40,null::text),
 ('Famílias e Ensaios','Contratação confirmada',50,'ganho'::text),
 ('Famílias e Ensaios','Não convertida',60,'perdido'::text)
) etapa(pipeline_nome,nome,ordem,tipo_final)
 on etapa.pipeline_nome=p.nome
where not exists (
 select 1 from public.crm_etapas e
 where e.pipeline_id=p.id and e.nome=etapa.nome
);

-- Um agendamento concluído pode ganhar um compromisso de agenda,
-- mas nenhuma pré-reserva de 10 minutos gera compromisso definitivo.
create table if not exists public.gf_form_agenda_vinculos (
 resposta_id uuid primary key references public.gf_contratacao_form_respostas(id) on delete restrict,
 compromisso_id uuid not null unique references public.agenda_compromissos(id) on delete restrict,
 criado_em timestamptz not null default now()
);

-- Conciliador relaciona fontes de pagamento à receita do Gold Reserve
-- SEM transformar declaração "já paguei" em dinheiro recebido.
-- O registro de um mesmo pagamento externo é idempotente.
create table if not exists public.gf_financeiro_fontes (
 id uuid primary key default gen_random_uuid(),
 fonte_tipo text not null check(fonte_tipo in (
  'contratacao_pedido','contratacao_formulario','selecao_pedido'
 )),
 fonte_id uuid not null,
 provedor text,
 referencia_transacao text,
 lancamento_manual_id uuid unique references public.gr_lancamentos(id) on delete restrict,
 status_conferencia text not null default 'pendente'
  check(status_conferencia in ('pendente','verificado','conciliado','descartado')),
 criado_em timestamptz not null default now(),
 conferido_em timestamptz,
 unique(fonte_tipo,fonte_id)
);
create unique index if not exists gf_financeiro_transacao_unica_idx
 on public.gf_financeiro_fontes(lower(btrim(provedor)),btrim(referencia_transacao))
 where provedor is not null and referencia_transacao is not null;
create index if not exists gf_financeiro_fontes_status_idx
 on public.gf_financeiro_fontes(status_conferencia);

-- Outbox: a mudança de um módulo vira uma ação idempotente para os outros
-- sem transações distribuídas entre Auth, CRM, Agenda, Galeria e Financeiro.
-- Neste primeiro estágio não existe trigger de execução ou reprocessamento:
-- nenhuma alteração automática pode impactar pedidos antigos.
create table if not exists public.gf_integracao_outbox (
 id uuid primary key default gen_random_uuid(),
 chave_idempotencia text not null unique,
 evento text not null check(evento in (
  'formulario_recebido','identidade_validada','agendamento_confirmado',
  'agendamento_cancelado','pagamento_confirmado','pagamento_reembolsado',
  'galeria_entregue','crm_etapa_alterada'
 )),
 origem_tipo text not null,
 origem_id uuid not null,
 payload jsonb not null default '{}'::jsonb,
 estado text not null default 'pendente'
  check(estado in ('pendente','processando','concluido','erro')),
 tentativas integer not null default 0 check(tentativas>=0),
 ultimo_erro text,
 criado_em timestamptz not null default now(),
 processado_em timestamptz
);
create index if not exists gf_integracao_outbox_fila_idx
 on public.gf_integracao_outbox(estado,criado_em)
 where estado in ('pendente','erro');

-- Privacidade: todos os novos cadastros são privados e as permissões
-- dos pais/alunos existentes não são ampliadas.
alter table public.gf_contatos enable row level security;
alter table public.gf_contato_alunos enable row level security;
alter table public.gf_form_contatos enable row level security;
alter table public.gf_form_alunos enable row level security;
alter table public.gf_identidade_pendencias enable row level security;
alter table public.gf_form_agenda_vinculos enable row level security;
alter table public.gf_financeiro_fontes enable row level security;
alter table public.gf_integracao_outbox enable row level security;

revoke all on public.gf_contatos,public.gf_contato_alunos,
 public.gf_form_contatos,public.gf_form_alunos,
 public.gf_identidade_pendencias,public.gf_form_agenda_vinculos,
 public.gf_financeiro_fontes,public.gf_integracao_outbox
 from public,anon,authenticated;

grant select,insert,update,delete on public.gf_contatos,public.gf_contato_alunos,
 public.gf_form_contatos,public.gf_form_alunos,public.gf_identidade_pendencias,
 public.gf_form_agenda_vinculos to authenticated;
grant select,insert,update,delete on public.gf_financeiro_fontes to authenticated;

create policy gf_contatos_admin on public.gf_contatos for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_contato_alunos_admin on public.gf_contato_alunos for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_form_contatos_admin on public.gf_form_contatos for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_form_alunos_admin on public.gf_form_alunos for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_identidade_pendencias_admin on public.gf_identidade_pendencias for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_form_agenda_vinculos_admin on public.gf_form_agenda_vinculos for all to authenticated
 using ((select role from public.meu_perfil()) in ('admin','super_admin'))
 with check ((select role from public.meu_perfil()) in ('admin','super_admin'));
create policy gf_financeiro_fontes_superadmin on public.gf_financeiro_fontes for all to authenticated
 using ((select role from public.meu_perfil()) = 'super_admin')
 with check ((select role from public.meu_perfil()) = 'super_admin');

-- Edge Functions de integração usam service_role; Auth admin usa RLS.
grant select,insert,update,delete on public.gf_contatos,public.gf_contato_alunos,
 public.gf_form_contatos,public.gf_form_alunos,public.gf_identidade_pendencias,
 public.gf_form_agenda_vinculos,public.gf_financeiro_fontes to service_role;

-- O outbox nunca está diretamente disponível a navegadores.
grant select,insert,update,delete on public.gf_integracao_outbox to service_role;
