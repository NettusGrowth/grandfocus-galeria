-- Grand Focus | Contratacao de experiencias fotograficas
-- Migration aditiva. Revisar e aplicar somente com autorizacao expressa.
-- Nao altera tabelas, policies, funcoes ou buckets existentes.

create extension if not exists pgcrypto;

create table if not exists public.gf_contratacao_eventos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete restrict,
  escola_id uuid not null references public.escolas(id) on delete restrict,
  slug text not null unique,
  nome_publico text not null,
  status text not null default 'rascunho' check (status in ('rascunho','publicado','pausado','encerrado')),
  local text,
  data_evento date,
  miniensaio_inicio timestamptz,
  miniensaio_fim timestamptz,
  duracao_minutos integer not null default 5 check (duracao_minutos between 1 and 60),
  capacidade_miniensaios integer check (capacidade_miniensaios is null or capacidade_miniensaios >= 0),
  vendas_encerram_em timestamptz,
  reserva_minutos integer not null default 15 check (reserva_minutos between 1 and 60),
  prazo_entrega_dias integer check (prazo_entrega_dias is null or prazo_entrega_dias between 1 and 365),
  whatsapp_atendimento text not null default '5534992632922',
  termos_versao text,
  termos_conteudo text,
  privacidade_url text,
  fornecedor_nome text,
  fornecedor_documento text,
  fornecedor_endereco text,
  fornecedor_email text,
  publicado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint gf_contratacao_evento_horario_check check (
    (miniensaio_inicio is null and miniensaio_fim is null) or
    (miniensaio_inicio is not null and miniensaio_fim is not null and miniensaio_fim > miniensaio_inicio)
  )
);
create index if not exists gf_contratacao_eventos_status_idx on public.gf_contratacao_eventos(status, vendas_encerram_em);

create table if not exists public.gf_contratacao_pacotes (
  id uuid primary key default gen_random_uuid(),
  evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id) on delete cascade,
  codigo text not null check (codigo in ('miniensaio','palco','completo')),
  nome text not null,
  descricao jsonb not null default '[]'::jsonb,
  preco_centavos integer not null check (preco_centavos > 0),
  inclui_miniensaio boolean not null default false,
  inclui_palco boolean not null default false,
  minimo_fotos_por_coreografia integer not null default 0 check (minimo_fotos_por_coreografia >= 0),
  ativo boolean not null default true,
  ordem smallint not null default 0,
  unique(evento_contratacao_id,codigo)
);

create table if not exists public.gf_contratacao_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id) on delete restrict,
  responsavel_nome text not null,
  responsavel_whatsapp text not null,
  responsavel_email text not null,
  valor_total_centavos integer not null check (valor_total_centavos > 0),
  status text not null default 'aguardando_pagamento' check (status in ('aguardando_pagamento','pagamento_pendente','pago','expirado','cancelado','reembolsado','conciliacao_pendente')),
  reserva_status text not null default 'nao_aplicavel' check (reserva_status in ('ativa','expirada','confirmada','nao_aplicavel','conciliacao_pendente')),
  reserva_expira_em timestamptz,
  order_nsu text not null unique,
  checkout_url text,
  checkout_criado_em timestamptz,
  pagamento_confirmado_em timestamptz,
  metodo_pagamento text check (metodo_pagamento is null or metodo_pagamento in ('pix','cartao')),
  parcelas integer,
  valor_pago_centavos integer,
  comprovante_path text,
  acesso_publico_hash text not null unique,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists gf_contratacao_pedidos_evento_status_idx on public.gf_contratacao_pedidos(evento_contratacao_id,status);
create index if not exists gf_contratacao_pedidos_reserva_idx on public.gf_contratacao_pedidos(evento_contratacao_id,reserva_status,reserva_expira_em);

create table if not exists public.gf_contratacao_participantes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.gf_contratacao_pedidos(id) on delete cascade,
  pacote_id uuid not null references public.gf_contratacao_pacotes(id) on delete restrict,
  bailarina_nome text not null,
  turma text not null,
  idade smallint check (idade is null or idade between 1 and 99),
  preco_centavos integer not null check (preco_centavos > 0),
  consome_miniensaio boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists gf_contratacao_participantes_pedido_idx on public.gf_contratacao_participantes(pedido_id);

create table if not exists public.gf_contratacao_coreografias (
  id uuid primary key default gen_random_uuid(),
  participante_id uuid not null references public.gf_contratacao_participantes(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  confirmar_depois boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists public.gf_contratacao_aceites (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.gf_contratacao_pedidos(id) on delete restrict,
  responsavel_nome text not null,
  declarou_responsavel_legal boolean not null check (declarou_responsavel_legal),
  termos_versao text not null,
  termos_conteudo text not null,
  termos_sha256 text not null,
  aceito_em timestamptz not null default now(),
  autorizacao_uso_imagem boolean not null default false,
  autorizacao_uso_imagem_versao text,
  metadados_tecnicos jsonb not null default '{}'::jsonb,
  unique(pedido_id)
);

create table if not exists public.gf_contratacao_pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.gf_contratacao_pedidos(id) on delete restrict,
  provedor text not null default 'infinitepay',
  order_nsu text not null unique,
  transaction_nsu text unique,
  slug text,
  status text not null default 'link_criado' check (status in ('link_criado','pendente','paid','settled','canceled','refunded','payment_failed','expirado','erro','conciliacao_pendente')),
  metodo text,
  parcelas integer,
  valor_centavos integer,
  checkout_url text,
  resposta_criacao jsonb,
  ultimo_payment_check jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists gf_contratacao_pagamentos_pedido_idx on public.gf_contratacao_pagamentos(pedido_id);

create table if not exists public.gf_contratacao_webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.gf_contratacao_pedidos(id) on delete set null,
  order_nsu text,
  transaction_nsu text,
  evento_provedor text,
  payload jsonb,
  payment_check jsonb,
  resultado text not null,
  criado_em timestamptz not null default now()
);
create unique index if not exists gf_contratacao_webhook_transaction_uidx
  on public.gf_contratacao_webhook_eventos(transaction_nsu)
  where transaction_nsu is not null and resultado in ('confirmado','ja_processado');

create table if not exists public.gf_contratacao_auditoria (
  id uuid primary key default gen_random_uuid(),
  evento_contratacao_id uuid references public.gf_contratacao_eventos(id) on delete set null,
  pedido_id uuid references public.gf_contratacao_pedidos(id) on delete set null,
  usuario_id uuid references auth.users(id) on delete set null,
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Defesa em profundidade: tabelas privadas, sem acesso direto via Data API.
do $$
declare t text;
begin
  foreach t in array array[
    'gf_contratacao_eventos','gf_contratacao_pacotes','gf_contratacao_pedidos',
    'gf_contratacao_participantes','gf_contratacao_coreografias','gf_contratacao_aceites',
    'gf_contratacao_pagamentos','gf_contratacao_webhook_eventos','gf_contratacao_auditoria'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;

-- Campanha inicial criada em rascunho. Nenhum horário, local ou capacidade presumidos.
insert into public.gf_contratacao_eventos
  (evento_id, escola_id, slug, nome_publico, status, data_evento, capacidade_miniensaios)
select e.id, e.escola_id, 'entre-estacoes', 'Entre Estações', 'rascunho', e.data, null
from public.eventos e
where e.id = 'c8ea425b-a082-40ae-9a27-79db8705f075'::uuid
  and e.escola_id = '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid
on conflict (slug) do nothing;

insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select id,'miniensaio','Miniensaio','["3 fotografias individuais com figurino","2 fotografias com familiares","5 fotografias digitais tratadas"]'::jsonb,11900,true,false,0,1
from public.gf_contratacao_eventos where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;
insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select id,'palco','Fotos de palco','["Mínimo de 10 fotografias digitais por coreografia dançada"]'::jsonb,7900,false,true,10,2
from public.gf_contratacao_eventos where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;
insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select id,'completo','Pacote completo','["3 fotografias individuais com figurino","2 fotografias com familiares","Mínimo de 10 fotografias digitais por coreografia dançada"]'::jsonb,15900,true,true,10,3
from public.gf_contratacao_eventos where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;

-- Esta migration apenas cria a estrutura. A RPC transacional de reserva,
-- funções Edge e políticas de administração serão entregues e revisadas
-- antes de qualquer aplicação em banco.
