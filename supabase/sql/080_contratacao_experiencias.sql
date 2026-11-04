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


-- Reserva atomica, com precos sempre lidos do banco e bloqueio da linha da campanha.
create or replace function public.gf_contratacao_criar_reserva(
  p_evento_slug text,
  p_responsavel jsonb,
  p_participantes jsonb,
  p_aceite jsonb,
  p_acesso_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $
declare
  v_evento public.gf_contratacao_eventos%rowtype;
  v_pedido_id uuid := gen_random_uuid();
  v_total integer := 0;
  v_vagas integer := 0;
  v_usadas integer := 0;
  v_item jsonb;
  v_pacote public.gf_contratacao_pacotes%rowtype;
  v_participante_id uuid;
  v_order_nsu text := replace(v_pedido_id::text,'-','');
  v_expira timestamptz;
  v_tem_mini boolean := false;
begin
  if jsonb_typeof(p_participantes) <> 'array' or jsonb_array_length(p_participantes) < 1 or jsonb_array_length(p_participantes) > 10 then
    raise exception 'Informe de 1 a 10 bailarinas por contratação.';
  end if;
  if coalesce(length(trim(p_responsavel->>'nome')),0) < 5
    or coalesce(length(regexp_replace(p_responsavel->>'whatsapp','\D','','g')),0) not between 10 and 13
    or coalesce(p_responsavel->>'email','') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,} then
    raise exception 'Dados do responsável inválidos.';
  end if;
  if coalesce((p_aceite->>'responsavel_legal')::boolean,false) is not true
    or coalesce((p_aceite->>'aceitou_termos')::boolean,false) is not true then
    raise exception 'O aceite dos termos e a declaração de responsabilidade são obrigatórios.';
  end if;

  select * into v_evento from public.gf_contratacao_eventos
    where slug=p_evento_slug for update;
  if not found or v_evento.status <> 'publicado' then
    raise exception 'Esta campanha não está aberta para contratação.';
  end if;
  if v_evento.vendas_encerram_em is not null and now() >= v_evento.vendas_encerram_em then
    raise exception 'O prazo de contratação foi encerrado.';
  end if;
  if v_evento.miniensaio_inicio is null or v_evento.miniensaio_fim is null
    or v_evento.local is null or v_evento.capacidade_miniensaios is null
    or v_evento.termos_versao is null or v_evento.termos_conteudo is null
    or v_evento.fornecedor_nome is null or v_evento.fornecedor_documento is null
    or v_evento.fornecedor_endereco is null or v_evento.fornecedor_email is null then
    raise exception 'A campanha ainda não possui todas as configurações obrigatórias.';
  end if;

  for v_item in select value from jsonb_array_elements(p_participantes) loop
    select * into v_pacote from public.gf_contratacao_pacotes
      where id=(v_item->>'pacote_id')::uuid
        and evento_contratacao_id=v_evento.id and ativo=true;
    if not found then raise exception 'Pacote inválido para esta campanha.'; end if;
    if coalesce(length(trim(v_item->>'nome')),0) < 3
      or coalesce(length(trim(v_item->>'turma')),0) < 1 then
      raise exception 'Informe nome e turma de cada bailarina.';
    end if;
    v_total := v_total + v_pacote.preco_centavos;
    v_tem_mini := v_tem_mini or v_pacote.inclui_miniensaio;
  end loop;

  if v_tem_mini then
    select count(*) into v_usadas
    from public.gf_contratacao_participantes p
    join public.gf_contratacao_pedidos o on o.id=p.pedido_id
    where o.evento_contratacao_id=v_evento.id
      and p.consome_miniensaio=true
      and (
        o.status in ('pago','conciliacao_pendente')
        or (o.status in ('aguardando_pagamento','pagamento_pendente')
          and (o.reserva_expira_em > now() or o.reserva_status='conciliacao_pendente'))
      );
    select coalesce(sum(case when (value->>'pacote_id')::uuid in (
      select id from public.gf_contratacao_pacotes where evento_contratacao_id=v_evento.id and inclui_miniensaio
    ) then 1 else 0 end),0) into v_vagas from jsonb_array_elements(p_participantes);
    if v_usadas + v_vagas > v_evento.capacidade_miniensaios then
      raise exception 'Não há vagas suficientes para o miniensaio.';
    end if;
  end if;

  v_expira := now() + make_interval(mins => v_evento.reserva_minutos);
  insert into public.gf_contratacao_pedidos(
    id,evento_contratacao_id,responsavel_nome,responsavel_whatsapp,responsavel_email,
    valor_total_centavos,status,reserva_status,reserva_expira_em,order_nsu,acesso_publico_hash
  ) values (
    v_pedido_id,v_evento.id,trim(p_responsavel->>'nome'),
    regexp_replace(p_responsavel->>'whatsapp','\D','','g'),lower(trim(p_responsavel->>'email')),
    v_total,'aguardando_pagamento',case when v_tem_mini then 'ativa' else 'nao_aplicavel' end,
    case when v_tem_mini then v_expira else null end,v_order_nsu,p_acesso_hash
  );

  for v_item in select value from jsonb_array_elements(p_participantes) loop
    select * into v_pacote from public.gf_contratacao_pacotes where id=(v_item->>'pacote_id')::uuid;
    v_participante_id := gen_random_uuid();
    insert into public.gf_contratacao_participantes(id,pedido_id,pacote_id,bailarina_nome,turma,idade,preco_centavos,consome_miniensaio)
    values(v_participante_id,v_pedido_id,v_pacote.id,trim(v_item->>'nome'),trim(v_item->>'turma'),
      nullif(v_item->>'idade','')::smallint,v_pacote.preco_centavos,v_pacote.inclui_miniensaio);
    if jsonb_typeof(v_item->'coreografias')='array' then
      insert into public.gf_contratacao_coreografias(participante_id,nome,confirmar_depois)
      select v_participante_id,coalesce(nullif(trim(c->>'nome'),''),'A definir'),
        coalesce((c->>'confirmar_depois')::boolean,false)
      from jsonb_array_elements(v_item->'coreografias') c;
    end if;
  end loop;

  insert into public.gf_contratacao_aceites(
    pedido_id,responsavel_nome, declarou_responsavel_legal,termos_versao,
    termos_conteudo,termos_sha256,autorizacao_uso_imagem,autorizacao_uso_imagem_versao,metadados_tecnicos
  ) values (
    v_pedido_id,trim(p_responsavel->>'nome'),true,v_evento.termos_versao,
    v_evento.termos_conteudo,encode(digest(v_evento.termos_conteudo,'sha256'),'hex'),
    coalesce((p_aceite->>'uso_imagem')::boolean,false),
    case when coalesce((p_aceite->>'uso_imagem')::boolean,false) then 'uso-imagem-v1' else null end,
    coalesce(p_aceite->'metadados','{}'::jsonb)
  );

  insert into public.gf_contratacao_auditoria(evento_contratacao_id,pedido_id,acao,detalhes)
  values(v_evento.id,v_pedido_id,'pedido_criado',jsonb_build_object('reserva_miniensaio',v_tem_mini,'expira_em',v_expira));

  return jsonb_build_object('pedido_id',v_pedido_id,'order_nsu',v_order_nsu,
    'valor_total_centavos',v_total,'reserva_expira_em',case when v_tem_mini then v_expira else null end);
end;
$;
revoke all on function public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text) to service_role;
