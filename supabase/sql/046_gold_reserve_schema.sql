-- Bloco 16 (1/12) — schema base do módulo financeiro "Gold Reserve".
--
-- Cinco peças aditivas, todas RLS restrita a 'super_admin' (não
-- 'admin' comum) porque esse módulo expõe receita, gasto de marketing
-- e valor pago por cliente — dado mais sensível que o resto do admin.
--
-- Rodar isso inteiro no SQL Editor do Supabase.

-- 1) valor realmente confirmado pela InfinitePay via payment_check.
-- Hoje selecao_liberar_pedido_automatico() recebe esse valor só pra
-- validar (>= valor_total) e descarta — nunca fica gravado em lugar
-- nenhum. Vira coluna aqui; a função é atualizada no Estágio 2.
alter table selecao_pedidos add column if not exists valor_pago numeric(10,2);

-- 2) elo de volta pro ensaio/evento que originou a seleção de fotos
-- extras — hoje não existe NENHUM jeito de ligar um pedido pago a um
-- ensaio específico. Nullable: seleções antigas ficam sem elo de
-- propósito (não dá pra adivinhar de forma confiável).
alter table selecao_galerias add column if not exists evento_id uuid references eventos(id) on delete set null;
create index if not exists idx_selecao_galerias_evento on selecao_galerias(evento_id);

-- 3) preço da sessão/pacote em si — NUNCA como coluna em `eventos`,
-- porque `eventos` tem uma policy de SELECT ampla (eventos_visiveis())
-- usada pelas telas de aluno/pai/professor, e RLS não filtra coluna,
-- só linha. Colocar o preço lá vazaria pra quem não deveria ver.
create table if not exists eventos_financeiro (
  evento_id uuid primary key references eventos(id) on delete cascade,
  preco_sessao numeric(10,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references perfis(user_id) on delete set null
);

-- 4) gasto de marketing por mês — manual, alimenta o cálculo de CAC.
create table if not exists gr_marketing_gastos (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique,
  valor numeric(10,2) not null default 0,
  observacao text,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now()
);

-- 5) equipamento cadastrado — manual, alimenta o timer de reserva e o
-- custo operacional amortizado do ROI de portfólio.
create table if not exists gr_equipamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  custo numeric(10,2) not null default 0,
  data_compra date not null,
  vida_util_meses int not null default 12,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now()
);

-- 6) trilha de auditoria de webhook — hoje o webhook da InfinitePay só
-- escreve em log efêmero do Supabase (Edge Functions → Logs), nada
-- fica persistido. Inserido só via RPC security definer (Estágio 2) a
-- partir da própria Edge Function.
create table if not exists gr_webhook_events (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references selecao_pedidos(id) on delete set null,
  order_nsu text,
  transaction_nsu text,
  payload_recebido jsonb,
  payment_check_resultado jsonb,
  resultado text not null check (resultado in ('confirmado','nao_confirmado','erro','ja_processado')),
  mensagem text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_gr_webhook_events_pedido on gr_webhook_events(pedido_id);

alter table eventos_financeiro enable row level security;
alter table gr_marketing_gastos enable row level security;
alter table gr_equipamentos enable row level security;
alter table gr_webhook_events enable row level security;

-- exceção deliberada: essa tabela usa admin+super_admin (não só
-- super_admin como o resto do Gold Reserve) porque o preço da sessão é
-- digitado no MESMO modal de Evento/Ensaio que qualquer 'admin' já usa
-- (eventos_admin_all em 002_rls.sql/015_fix_admin_bypass_e_bucket.sql
-- libera esse nível pra 'admin' também) — restringir só a super_admin
-- aqui quebraria o salvamento do modal pra um admin comum sem aviso
-- nenhum. O que fica super_admin-only é o PAINEL Gold Reserve que lê
-- esse valor agregado, não o campo isolado no formulário do evento.
create policy eventos_financeiro_admin on eventos_financeiro for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy gr_marketing_gastos_super_admin on gr_marketing_gastos for all to authenticated
  using ((select role from meu_perfil()) = 'super_admin')
  with check ((select role from meu_perfil()) = 'super_admin');
create policy gr_equipamentos_super_admin on gr_equipamentos for all to authenticated
  using ((select role from meu_perfil()) = 'super_admin')
  with check ((select role from meu_perfil()) = 'super_admin');

-- gr_webhook_events só é escrito pela Edge Function via RPC security
-- definer (Estágio 2, roda como o dono da função — service_role não
-- precisa de policy pra isso). A UI (super_admin autenticado) só lê.
create policy gr_webhook_events_select_super_admin on gr_webhook_events for select to authenticated
  using ((select role from meu_perfil()) = 'super_admin');

grant select, insert, update, delete on eventos_financeiro, gr_marketing_gastos, gr_equipamentos to authenticated;
grant select on gr_webhook_events to authenticated;
