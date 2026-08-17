-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — módulo "Agenda de Eventos": onde a Luiz
-- marca ensaio/evento/reunião/entrega, acompanha o que já foi
-- agendado, vincula fotógrafo(s)/local/horário, remarca ou cancela
-- sem perder o histórico. Rodar depois de 001 a 066. Aditiva.
--
-- Decisões de design:
-- - `agenda_compromissos` é INDEPENDENTE de `eventos` — nem todo
--   compromisso da agenda já virou um álbum/ensaio no sistema (ex:
--   reunião de orçamento, entrega de fotos, um ensaio ainda não
--   confirmado). `evento_id` é opcional: quando o compromisso É a
--   sessão de fotos de um evento/ensaio que já existe (ou vai
--   existir), liga os dois; quando não, o compromisso fica solto.
-- - `equipe` é um array de user_id (mesmo padrão de
--   `alunos_selecionados`/`pessoas_selecionadas` em 011) — permite
--   mais de um fotógrafo/assistente no mesmo compromisso sem precisar
--   de uma tabela de junção à parte.
-- - Sem "hora_fim" obrigatória: nem todo compromisso tem duração
--   conhecida de antemão (ex: reunião). Quando ausente, a detecção de
--   conflito de horário (feita em JS, não trigger) assume uma janela
--   padrão de 2h só pra alertar, nunca bloqueia o salvamento.
-- - `agenda_historico`: todo remarcamento/cancelamento grava o valor
--   ANTERIOR antes de sobrescrever — é o que permite "desfazer" e o
--   que alimenta o feed de notificação ("Fulano remarcou o ensaio X").
-- ════════════════════════════════════════════════════════════════

create table if not exists agenda_compromissos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null default 'ensaio' check (tipo in ('ensaio','evento','reuniao','entrega','outro')),
  evento_id uuid references eventos(id) on delete set null,
  escola_id uuid references escolas(id) on delete set null,
  cliente_avulso_id uuid references clientes_avulsos(id) on delete set null,
  cliente_nome_livre text,
  data date not null,
  hora_inicio time not null,
  hora_fim time,
  local text,
  equipe uuid[] not null default '{}',
  status text not null default 'agendado' check (status in ('agendado','confirmado','remarcado','cancelado','concluido')),
  notas text,
  lembrete_horas int not null default 24,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_agenda_compromissos_data on agenda_compromissos(data);
create index if not exists idx_agenda_compromissos_evento on agenda_compromissos(evento_id);
create index if not exists idx_agenda_compromissos_status on agenda_compromissos(status);

create table if not exists agenda_historico (
  id uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null references agenda_compromissos(id) on delete cascade,
  acao text not null check (acao in ('criado','editado','remarcado','confirmado','cancelado','reativado','concluido')),
  data_anterior date,
  hora_inicio_anterior time,
  motivo text,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_agenda_historico_compromisso on agenda_historico(compromisso_id, criado_em desc);

alter table agenda_compromissos enable row level security;
alter table agenda_historico enable row level security;

-- mesmo nível de acesso de eventos/ensaios em geral: admin e
-- super_admin gerenciam a agenda inteira. Não existe visão de
-- escola/professor/responsável pra agenda — é uma ferramenta interna
-- de operação do estúdio, não algo que o cliente final acessa.
create policy agenda_compromissos_admin on agenda_compromissos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy agenda_historico_admin on agenda_historico for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));

grant select, insert, update, delete on agenda_compromissos, agenda_historico to authenticated;
