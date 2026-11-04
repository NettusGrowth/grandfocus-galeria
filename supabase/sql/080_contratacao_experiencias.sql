-- Grand Focus | Contratação de experiências fotográficas
-- Migration aditiva e isolada. Não altera a galeria, seleção de fotos ou Storage.
-- Esta migration deve ser revisada e aplicada somente com autorização expressa.

create table if not exists public.gf_contratacao_eventos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete restrict,
  escola_id uuid not null references public.escolas(id) on delete restrict,
  slug text not null unique,
  nome_publico text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho','publicado','pausado','encerrado')),
  local text,
  data_evento date,
  miniensaio_inicio timestamptz,
  miniensaio_fim timestamptz,
  duracao_minutos integer not null default 5 check (duracao_minutos between 1 and 60),
  capacidade_miniensaios integer check (capacidade_miniensaios is null or capacidade_miniensaios >= 0),
  vendas_encerram_em timestamptz,
  reserva_minutos integer not null default 15 check (reserva_minutos between 1 and 60),
  prazo_entrega_dias integer check (prazo_entrega_dias is null or prazo_entrega_dias between 1 and 365),
  whatsapp_atendimento text,
  termos_versao text,
  termos_conteudo text,
  privacidade_url text,
  privacidade_versao text,
  privacidade_conteudo text,
  autorizacao_imagem_versao text,
  autorizacao_imagem_conteudo text,
  fornecedor_nome text,
  fornecedor_documento text,
  fornecedor_endereco text,
  fornecedor_email text,
  publicado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint gf_contratacao_evento_horario_check check (
    (miniensaio_inicio is null and miniensaio_fim is null)
    or (miniensaio_inicio is not null and miniensaio_fim is not null and miniensaio_fim > miniensaio_inicio)
  )
);

create index if not exists gf_contratacao_eventos_status_idx
  on public.gf_contratacao_eventos(status, vendas_encerram_em);

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
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento','pagamento_pendente','pago','expirado','cancelado','reembolsado','conciliacao_pendente')),
  reserva_status text not null default 'nao_aplicavel'
    check (reserva_status in ('ativa','expirada','confirmada','nao_aplicavel','conciliacao_pendente')),
  reserva_expira_em timestamptz,
  order_nsu text not null unique,
  idempotency_key text not null unique,
  request_hash text not null,
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

create index if not exists gf_contratacao_pedidos_evento_status_idx
  on public.gf_contratacao_pedidos(evento_contratacao_id,status);
create index if not exists gf_contratacao_pedidos_reserva_idx
  on public.gf_contratacao_pedidos(evento_contratacao_id,reserva_status,reserva_expira_em);

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

create index if not exists gf_contratacao_participantes_pedido_idx
  on public.gf_contratacao_participantes(pedido_id);

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
  privacidade_url text not null,
  privacidade_versao text not null,
  privacidade_conteudo text not null,
  privacidade_sha256 text not null,
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
  status text not null default 'criado'
    check (status in ('criado','link_criado','pendente','paid','settled','canceled','refunded','payment_failed','expirado','erro','conciliacao_pendente')),
  metodo text,
  parcelas integer,
  valor_centavos integer,
  checkout_url text,
  resposta_criacao jsonb,
  ultimo_payment_check jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists gf_contratacao_pagamentos_pedido_idx
  on public.gf_contratacao_pagamentos(pedido_id);

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

create index if not exists gf_contratacao_webhook_order_idx
  on public.gf_contratacao_webhook_eventos(order_nsu,criado_em desc);

create table if not exists public.gf_contratacao_rate_limits (
  chave_hash text primary key check (chave_hash ~ '^[0-9a-f]{64}$'),
  janela_inicio timestamptz not null default now(),
  tentativas integer not null default 0 check (tentativas >= 0),
  atualizado_em timestamptz not null default now()
);

create index if not exists gf_contratacao_rate_limits_updated_idx
  on public.gf_contratacao_rate_limits(atualizado_em);

create table if not exists public.gf_contratacao_auditoria (
  id uuid primary key default gen_random_uuid(),
  evento_contratacao_id uuid references public.gf_contratacao_eventos(id) on delete set null,
  pedido_id uuid references public.gf_contratacao_pedidos(id) on delete set null,
  usuario_id uuid references auth.users(id) on delete set null,
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Tabelas privadas. O navegador nunca recebe acesso direto a pedidos, crianças,
-- termos aceitos, pagamentos, auditoria ou dados de webhook.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'gf_contratacao_eventos',
    'gf_contratacao_pacotes',
    'gf_contratacao_pedidos',
    'gf_contratacao_participantes',
    'gf_contratacao_coreografias',
    'gf_contratacao_aceites',
    'gf_contratacao_pagamentos',
    'gf_contratacao_webhook_eventos',
    'gf_contratacao_rate_limits',
    'gf_contratacao_auditoria'
  ] loop
    execute format('alter table public.%I enable row level security',v_tabela);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_tabela);
    execute format('grant all on table public.%I to service_role',v_tabela);
  end loop;
end
$$;

-- Campanha inicial em rascunho. O horário, local, capacidade, prazos e dados
-- contratuais permanecem vazios até serem preenchidos no painel administrativo.
insert into public.gf_contratacao_eventos
  (evento_id,escola_id,slug,nome_publico,status,data_evento,capacidade_miniensaios)
select
  e.id,
  e.escola_id,
  'entre-estacoes',
  'Entre Estações',
  'rascunho',
  e.data,
  null
from public.eventos e
where e.id = 'c8ea425b-a082-40ae-9a27-79db870f5075'::uuid
  and e.escola_id = '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid
on conflict (slug) do nothing;

insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select
  id,'miniensaio','Miniensaio no teatro',
  '["3 fotografias individuais com figurino","2 fotografias com familiares","5 fotografias digitais tratadas"]'::jsonb,
  11900,true,false,0,1
from public.gf_contratacao_eventos
where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;

insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select
  id,'palco','Fotos de palco',
  '["Mínimo de 10 fotografias digitais por coreografia dançada"]'::jsonb,
  7900,false,true,10,2
from public.gf_contratacao_eventos
where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;

insert into public.gf_contratacao_pacotes
  (evento_contratacao_id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ordem)
select
  id,'completo','Pacote completo',
  '["3 fotografias individuais com figurino","2 fotografias com familiares","5 fotografias digitais tratadas","Mínimo de 10 fotografias digitais por coreografia dançada"]'::jsonb,
  15900,true,true,10,3
from public.gf_contratacao_eventos
where slug='entre-estacoes'
on conflict (evento_contratacao_id,codigo) do nothing;

-- Dados públicos da campanha. A função só devolve campanhas publicadas.
-- Rate limit por identificador pseudonimizado. Nenhum IP, telefone ou e-mail bruto é armazenado.
create or replace function public.gf_contratacao_registrar_tentativa(p_chave_hash text,p_limite integer,p_janela_segundos integer)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_inicio timestamptz; v_tentativas integer; v_retry integer;
begin
  if coalesce(p_chave_hash,'') !~ '^[0-9a-f]{64}$' or p_limite not between 1 and 100 or p_janela_segundos not between 60 and 86400 then
    raise exception 'Parâmetros de proteção contra abuso inválidos.';
  end if;
  delete from public.gf_contratacao_rate_limits where atualizado_em < now() - interval '7 days';
  insert into public.gf_contratacao_rate_limits as atual(chave_hash,janela_inicio,tentativas,atualizado_em)
  values(p_chave_hash,now(),1,now())
  on conflict(chave_hash) do update set
    janela_inicio=case when atual.janela_inicio+make_interval(secs=>p_janela_segundos)<=now() then now() else atual.janela_inicio end,
    tentativas=case when atual.janela_inicio+make_interval(secs=>p_janela_segundos)<=now() then 1 else atual.tentativas+1 end,
    atualizado_em=now()
  returning janela_inicio,tentativas into v_inicio,v_tentativas;
  v_retry:=greatest(0,ceil(extract(epoch from (v_inicio+make_interval(secs=>p_janela_segundos)-now())))::integer);
  return jsonb_build_object('permitido',v_tentativas<=p_limite,'tentativas',v_tentativas,'limite',p_limite,'retry_after',v_retry);
end;
$$;
create or replace function public.gf_contratacao_publica_dados(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_evento public.gf_contratacao_eventos%rowtype;
  v_pacotes jsonb;
  v_escola_nome text;
begin
  select * into v_evento
  from public.gf_contratacao_eventos
  where slug = p_slug and status = 'publicado';

  if not found then
    return null;
  end if;

  select nome into v_escola_nome
  from public.escolas
  where id = v_evento.escola_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'codigo',p.codigo,
        'nome',p.nome,
        'descricao',p.descricao,
        'preco_centavos',p.preco_centavos,
        'inclui_miniensaio',p.inclui_miniensaio,
        'inclui_palco',p.inclui_palco,
        'minimo_fotos_por_coreografia',p.minimo_fotos_por_coreografia
      ) order by p.ordem,p.nome
    ),
    '[]'::jsonb
  )
  into v_pacotes
  from public.gf_contratacao_pacotes p
  where p.evento_contratacao_id = v_evento.id and p.ativo = true;

  return jsonb_build_object(
    'evento',jsonb_build_object(
      'slug',v_evento.slug,
      'nome_publico',v_evento.nome_publico,
      'escola_nome',v_escola_nome,
      'local',v_evento.local,
      'data_evento',v_evento.data_evento,
      'miniensaio_inicio',v_evento.miniensaio_inicio,
      'miniensaio_fim',v_evento.miniensaio_fim,
      'duracao_minutos',v_evento.duracao_minutos,
      'prazo_entrega_dias',v_evento.prazo_entrega_dias,
      'whatsapp_atendimento',v_evento.whatsapp_atendimento,
      'termos_versao',v_evento.termos_versao,
      'termos_conteudo',v_evento.termos_conteudo,
      'privacidade_url',v_evento.privacidade_url,
      'privacidade_versao',v_evento.privacidade_versao,
      'privacidade_conteudo',v_evento.privacidade_conteudo,
      'autorizacao_imagem_versao',v_evento.autorizacao_imagem_versao,
      'autorizacao_imagem_conteudo',v_evento.autorizacao_imagem_conteudo,
      'fornecedor_nome',v_evento.fornecedor_nome,
      'fornecedor_documento',v_evento.fornecedor_documento,
      'fornecedor_endereco',v_evento.fornecedor_endereco,
      'fornecedor_email',v_evento.fornecedor_email
    ),
    'pacotes',v_pacotes
  );
end;
$$;

-- Handle da InfinitePay já configurada no módulo de seleção. A API Key nunca
-- é armazenada no banco e será lida somente de secret da Edge Function.
create or replace function public.gf_contratacao_payment_config()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_handle text;
begin
  select nullif(btrim(infinitepay_handle),'')
    into v_handle
  from public.selecao_config
  where id = true;

  return jsonb_build_object('handle',v_handle);
end;
$$;

-- Reserva atômica. O lock da campanha serializa as compras que consomem vaga.
-- Os preços vêm exclusivamente do banco, nunca do valor enviado pelo navegador.
create or replace function public.gf_contratacao_criar_reserva(
  p_evento_slug text,
  p_responsavel jsonb,
  p_participantes jsonb,
  p_aceite jsonb,
  p_acesso_hash text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_evento public.gf_contratacao_eventos%rowtype;
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_pacote public.gf_contratacao_pacotes%rowtype;
  v_pedido_id uuid := gen_random_uuid();
  v_participante_id uuid;
  v_total integer := 0;
  v_vagas integer := 0;
  v_usadas integer := 0;
  v_tem_mini boolean := false;
  v_item jsonb;
  v_coreografia jsonb;
  v_expira timestamptz;
  v_order_nsu text;
  v_telefone text;
  v_imagem_aceita boolean;
begin
  if coalesce(p_acesso_hash,'') !~ '^[0-9a-f]{64}$'
    or coalesce(p_request_hash,'') !~ '^[0-9a-f]{64}$'
    or coalesce(p_idempotency_key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificadores de segurança inválidos.';
  end if;

  -- Retry de rede com a mesma chave não cria um segundo pedido.
  select * into v_pedido
  from public.gf_contratacao_pedidos
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_pedido.acesso_publico_hash <> p_acesso_hash
      or v_pedido.request_hash <> p_request_hash then
      raise exception 'Esta tentativa já foi utilizada com outros dados.';
    end if;

    select * into v_evento
    from public.gf_contratacao_eventos
    where id = v_pedido.evento_contratacao_id;

    if v_pedido.status in ('aguardando_pagamento','pagamento_pendente')
      and (
        (v_pedido.reserva_status = 'ativa' and v_pedido.reserva_expira_em <= now())
        or (v_pedido.reserva_status = 'nao_aplicavel' and v_evento.vendas_encerram_em <= now())
      ) then
      update public.gf_contratacao_pedidos
      set status = 'expirado',
          reserva_status = case when reserva_status = 'ativa' then 'expirada' else reserva_status end,
          atualizado_em = now()
      where id = v_pedido.id;
      update public.gf_contratacao_pagamentos
      set status = 'expirado', atualizado_em = now()
      where pedido_id = v_pedido.id;
      v_pedido.status := 'expirado';
      v_pedido.reserva_status := case when v_pedido.reserva_status = 'ativa' then 'expirada' else v_pedido.reserva_status end;
      v_pedido.checkout_url := null;
    end if;

    return jsonb_build_object(
      'pedido_id',v_pedido.id,
      'order_nsu',v_pedido.order_nsu,
      'valor_total_centavos',v_pedido.valor_total_centavos,
      'reserva_expira_em',v_pedido.reserva_expira_em,
      'vendas_encerram_em',v_evento.vendas_encerram_em,
      'checkout_url',v_pedido.checkout_url,
      'status',v_pedido.status,
      'reutilizado',true
    );
  end if;

  if jsonb_typeof(p_responsavel) is distinct from 'object'
    or jsonb_typeof(p_aceite) is distinct from 'object' then
    raise exception 'Dados do responsável ou aceite inválidos.';
  end if;

  if jsonb_typeof(p_participantes) is distinct from 'array' then
    raise exception 'Informe as bailarinas desta contratação.';
  end if;

  if jsonb_array_length(p_participantes) not between 1 and 10 then
    raise exception 'Informe de 1 a 10 bailarinas por contratação.';
  end if;

  if coalesce(length(btrim(p_responsavel->>'nome')),0) not between 5 and 120 then
    raise exception 'Informe o nome completo do responsável.';
  end if;

  v_telefone := regexp_replace(coalesce(p_responsavel->>'whatsapp',''),'\D','','g');
  if length(v_telefone) not between 10 and 13
    or coalesce(p_responsavel->>'email','') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'WhatsApp ou e-mail do responsável inválido.';
  end if;

  if coalesce((p_aceite->>'responsavel_legal')::boolean,false) is not true
    or coalesce((p_aceite->>'aceitou_termos')::boolean,false) is not true
    or coalesce((p_aceite->>'ciente_privacidade')::boolean,false) is not true then
    raise exception 'A declaração de responsabilidade, o aceite dos termos e a ciência da política de privacidade são obrigatórios.';
  end if;

  select * into v_evento
  from public.gf_contratacao_eventos
  where slug = p_evento_slug
  for update;

  if not found or v_evento.status <> 'publicado' then
    raise exception 'Esta campanha não está aberta para contratação.';
  end if;

  if v_evento.vendas_encerram_em is null or now() >= v_evento.vendas_encerram_em then
    raise exception 'O prazo de contratação foi encerrado.';
  end if;

  if v_evento.data_evento is null
    or v_evento.miniensaio_inicio is null
    or v_evento.miniensaio_fim is null
    or nullif(btrim(v_evento.local),'') is null
    or v_evento.capacidade_miniensaios is null
    or v_evento.termos_versao is null
    or v_evento.termos_conteudo is null
    or coalesce(v_evento.privacidade_url,'') !~ '^https://[^[:space:]]+$'
    or nullif(btrim(v_evento.privacidade_versao),'') is null
    or length(coalesce(v_evento.privacidade_conteudo,'')) < 100
    or v_evento.fornecedor_nome is null
    or v_evento.fornecedor_documento is null
    or v_evento.fornecedor_endereco is null
    or v_evento.fornecedor_email is null then
    raise exception 'A campanha ainda não possui todas as configurações obrigatórias.';
  end if;

  for v_item in select value from jsonb_array_elements(p_participantes) loop
    if coalesce(length(btrim(v_item->>'nome')),0) not between 3 and 120
      or coalesce(length(btrim(v_item->>'turma')),0) not between 1 and 80 then
      raise exception 'Informe o nome e a turma de cada bailarina.';
    end if;

    if nullif(v_item->>'idade','') is not null
      and (v_item->>'idade') !~ '^[0-9]{1,2}$' then
      raise exception 'A idade informada é inválida.';
    end if;

    select * into v_pacote
    from public.gf_contratacao_pacotes
    where id = (v_item->>'pacote_id')::uuid
      and evento_contratacao_id = v_evento.id
      and ativo = true;

    if not found then
      raise exception 'Pacote inválido para esta campanha.';
    end if;

    if v_item ? 'coreografias'
      and jsonb_typeof(v_item->'coreografias') is distinct from 'array' then
      raise exception 'A lista de coreografias é inválida.';
    end if;

    if v_pacote.inclui_palco then
      if jsonb_typeof(v_item->'coreografias') is distinct from 'array'
        or jsonb_array_length(v_item->'coreografias') < 1
        or jsonb_array_length(v_item->'coreografias') > 20 then
        raise exception 'Informe ao menos uma coreografia para as fotos de palco.';
      end if;

      for v_coreografia in select value from jsonb_array_elements(v_item->'coreografias') loop
        if coalesce((v_coreografia->>'confirmar_depois')::boolean,false) is not true
          and coalesce(length(btrim(v_coreografia->>'nome')),0) = 0 then
          raise exception 'Informe o nome da coreografia ou marque que será confirmado depois.';
        end if;
        if coalesce(length(btrim(v_coreografia->>'nome')),0) > 120 then
          raise exception 'O nome da coreografia deve ter até 120 caracteres.';
        end if;
      end loop;
    end if;

    v_total := v_total + v_pacote.preco_centavos;
    v_tem_mini := v_tem_mini or v_pacote.inclui_miniensaio;
  end loop;

  if v_tem_mini then
    select count(*) into v_usadas
    from public.gf_contratacao_participantes p
    join public.gf_contratacao_pedidos o on o.id = p.pedido_id
    where o.evento_contratacao_id = v_evento.id
      and p.consome_miniensaio = true
      and (
        o.status in ('pago','conciliacao_pendente')
        or (
          o.status in ('aguardando_pagamento','pagamento_pendente')
          and (o.reserva_expira_em > now() or o.reserva_status = 'conciliacao_pendente')
        )
      );

    select count(*) into v_vagas
    from jsonb_array_elements(p_participantes) x(value)
    join public.gf_contratacao_pacotes p
      on p.id = (x.value->>'pacote_id')::uuid
    where p.evento_contratacao_id = v_evento.id
      and p.inclui_miniensaio = true;

    if v_usadas + v_vagas > v_evento.capacidade_miniensaios then
      raise exception 'Não há vagas suficientes para o miniensaio.';
    end if;
  end if;

  v_expira := case
    when v_tem_mini then now() + make_interval(mins => v_evento.reserva_minutos)
    else null
  end;
  v_order_nsu := v_pedido_id::text;
  v_imagem_aceita := coalesce((p_aceite->>'uso_imagem')::boolean,false);

  insert into public.gf_contratacao_pedidos(
    id,evento_contratacao_id,responsavel_nome,responsavel_whatsapp,responsavel_email,
    valor_total_centavos,status,reserva_status,reserva_expira_em,order_nsu,
    idempotency_key,request_hash,acesso_publico_hash
  ) values (
    v_pedido_id,v_evento.id,btrim(p_responsavel->>'nome'),v_telefone,
    lower(btrim(p_responsavel->>'email')),v_total,'aguardando_pagamento',
    case when v_tem_mini then 'ativa' else 'nao_aplicavel' end,
    v_expira,v_order_nsu,p_idempotency_key,p_request_hash,p_acesso_hash
  );

  for v_item in select value from jsonb_array_elements(p_participantes) loop
    select * into v_pacote
    from public.gf_contratacao_pacotes
    where id = (v_item->>'pacote_id')::uuid;

    v_participante_id := gen_random_uuid();

    insert into public.gf_contratacao_participantes(
      id,pedido_id,pacote_id,bailarina_nome,turma,idade,preco_centavos,consome_miniensaio
    ) values (
      v_participante_id,v_pedido_id,v_pacote.id,btrim(v_item->>'nome'),
      btrim(v_item->>'turma'),nullif(v_item->>'idade','')::smallint,
      v_pacote.preco_centavos,v_pacote.inclui_miniensaio
    );

    if v_pacote.inclui_palco then
      insert into public.gf_contratacao_coreografias(participante_id,nome,confirmar_depois)
      select
        v_participante_id,
        case
          when coalesce((c.value->>'confirmar_depois')::boolean,false)
            then coalesce(nullif(btrim(c.value->>'nome'),''),'A confirmar')
          else btrim(c.value->>'nome')
        end,
        coalesce((c.value->>'confirmar_depois')::boolean,false)
      from jsonb_array_elements(v_item->'coreografias') c(value);
    end if;
  end loop;

  if v_imagem_aceita and (
    nullif(v_evento.autorizacao_imagem_versao,'') is null
    or nullif(v_evento.autorizacao_imagem_conteudo,'') is null
  ) then
    raise exception 'A autorização de uso de imagem não está configurada corretamente.';
  end if;

  insert into public.gf_contratacao_aceites(
    pedido_id,responsavel_nome,declarou_responsavel_legal,termos_versao,
    termos_conteudo,termos_sha256,privacidade_url,privacidade_versao,
    privacidade_conteudo,privacidade_sha256,autorizacao_uso_imagem,
    autorizacao_uso_imagem_versao,metadados_tecnicos
  ) values (
    v_pedido_id,btrim(p_responsavel->>'nome'),true,v_evento.termos_versao,
    v_evento.termos_conteudo,
    encode(extensions.digest(v_evento.termos_conteudo,'sha256'),'hex'),
    v_evento.privacidade_url,v_evento.privacidade_versao,v_evento.privacidade_conteudo,
    encode(extensions.digest(v_evento.privacidade_conteudo,'sha256'),'hex'),
    v_imagem_aceita,
    case when v_imagem_aceita then v_evento.autorizacao_imagem_versao else null end,
    case
      when jsonb_typeof(p_aceite->'metadados') = 'object' then p_aceite->'metadados'
      else '{}'::jsonb
    end
  );

  insert into public.gf_contratacao_pagamentos(pedido_id,order_nsu,valor_centavos)
  values(v_pedido_id,v_order_nsu,v_total);

  insert into public.gf_contratacao_auditoria(
    evento_contratacao_id,pedido_id,acao,detalhes
  ) values (
    v_evento.id,v_pedido_id,'pedido_criado',
    jsonb_build_object(
      'reserva_miniensaio',v_tem_mini,
      'reserva_expira_em',v_expira,
      'participantes',jsonb_array_length(p_participantes)
    )
  );

  return jsonb_build_object(
    'pedido_id',v_pedido_id,
    'order_nsu',v_order_nsu,
    'valor_total_centavos',v_total,
    'reserva_expira_em',v_expira,
    'vendas_encerram_em',v_evento.vendas_encerram_em,
    'checkout_url',null,
    'status','aguardando_pagamento',
    'reutilizado',false
  );
end;
$$;

create or replace function public.gf_contratacao_registrar_checkout(
  p_order_nsu text,
  p_checkout_url text,
  p_resposta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_evento public.gf_contratacao_eventos%rowtype;
begin
  select * into v_pedido
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  select * into v_evento
  from public.gf_contratacao_eventos
  where id = v_pedido.evento_contratacao_id;

  if v_pedido.status in ('pago','cancelado','reembolsado','conciliacao_pendente','expirado') then
    return jsonb_build_object('ok',false,'motivo','O pedido não pode receber um novo checkout.');
  end if;

  if v_evento.vendas_encerram_em is null or now() >= v_evento.vendas_encerram_em
    or (v_pedido.reserva_status = 'ativa' and v_pedido.reserva_expira_em <= now()) then
    update public.gf_contratacao_pedidos
    set status = 'expirado', reserva_status = case when reserva_status = 'ativa' then 'expirada' else reserva_status end,
        atualizado_em = now()
    where id = v_pedido.id;
    update public.gf_contratacao_pagamentos
    set status = 'expirado', atualizado_em = now()
    where pedido_id = v_pedido.id;
    return jsonb_build_object('ok',false,'motivo','A reserva ou o prazo de vendas expirou.');
  end if;

  if v_pedido.checkout_url is not null then
    return jsonb_build_object('ok',true,'checkout_url',v_pedido.checkout_url,'reutilizado',true);
  end if;

  if p_checkout_url !~ '^https://[^[:space:]]+$' then
    raise exception 'URL de checkout inválida.';
  end if;

  update public.gf_contratacao_pedidos
  set checkout_url = p_checkout_url,
      checkout_criado_em = now(),
      status = 'pagamento_pendente',
      atualizado_em = now()
  where id = v_pedido.id;

  update public.gf_contratacao_pagamentos
  set checkout_url = p_checkout_url,
      resposta_criacao = coalesce(p_resposta,'{}'::jsonb),
      status = 'link_criado',
      atualizado_em = now()
  where pedido_id = v_pedido.id;

  return jsonb_build_object('ok',true,'checkout_url',p_checkout_url,'reutilizado',false);
end;
$$;

create or replace function public.gf_contratacao_status_por_hash(p_acesso_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_evento public.gf_contratacao_eventos%rowtype;
begin
  select * into v_pedido
  from public.gf_contratacao_pedidos
  where acesso_publico_hash = p_acesso_hash
  for update;

  if not found then
    return null;
  end if;

  select * into v_evento
  from public.gf_contratacao_eventos
  where id = v_pedido.evento_contratacao_id;

  if v_pedido.status in ('aguardando_pagamento','pagamento_pendente')
    and (
      (v_pedido.reserva_status = 'ativa' and v_pedido.reserva_expira_em <= now())
      or (v_pedido.reserva_status = 'nao_aplicavel' and v_evento.vendas_encerram_em <= now())
    ) then
    update public.gf_contratacao_pedidos
    set status = 'expirado',
        reserva_status = case when reserva_status = 'ativa' then 'expirada' else reserva_status end,
        atualizado_em = now()
    where id = v_pedido.id;
    v_pedido.status := 'expirado';
    if v_pedido.reserva_status = 'ativa' then v_pedido.reserva_status := 'expirada'; end if;
    v_pedido.checkout_url := null;
  end if;

  return jsonb_build_object(
    'pedido_id',v_pedido.id,
    'numero',v_pedido.numero,
    'order_nsu',v_pedido.order_nsu,
    'status',v_pedido.status,
    'reserva_status',v_pedido.reserva_status,
    'reserva_expira_em',v_pedido.reserva_expira_em,
    'valor_total_centavos',v_pedido.valor_total_centavos,
    'checkout_url',case when v_pedido.status in ('aguardando_pagamento','pagamento_pendente') then v_pedido.checkout_url else null end,
    'pagamento_confirmado_em',v_pedido.pagamento_confirmado_em,
    'metodo_pagamento',v_pedido.metodo_pagamento,
    'parcelas',v_pedido.parcelas,
    'evento_nome',v_evento.nome_publico,
    'data_evento',v_evento.data_evento
  );
end;
$$;

create or replace function public.gf_contratacao_webhook_dados(p_order_nsu text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_pagamento public.gf_contratacao_pagamentos%rowtype;
begin
  select * into v_pedido
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu;

  if not found then
    return null;
  end if;

  select * into v_pagamento
  from public.gf_contratacao_pagamentos
  where pedido_id = v_pedido.id;

  return jsonb_build_object(
    'pedido_id',v_pedido.id,
    'evento_contratacao_id',v_pedido.evento_contratacao_id,
    'valor_total_centavos',v_pedido.valor_total_centavos,
    'status',v_pedido.status,
    'reserva_status',v_pedido.reserva_status,
    'reserva_expira_em',v_pedido.reserva_expira_em,
    'transaction_nsu',v_pagamento.transaction_nsu,
    'slug',v_pagamento.slug
  );
end;
$$;

create or replace function public.gf_contratacao_marcar_conciliacao(
  p_order_nsu text,
  p_transaction_nsu text,
  p_slug text,
  p_payment_check jsonb,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_evento_id uuid;
  v_tem_mini boolean;
begin
  select evento_contratacao_id into v_evento_id
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu;

  if not found then
    raise exception 'Pedido não encontrado para conciliação.';
  end if;

  -- Mesma ordem de locks da reserva e da confirmação de pagamento.
  perform 1
  from public.gf_contratacao_eventos
  where id = v_evento_id
  for update;

  select * into v_pedido
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu
  for update;

  if v_pedido.status = 'pago' then
    return jsonb_build_object('status','pago','ja_pago',true);
  end if;

  select coalesce(bool_or(consome_miniensaio),false) into v_tem_mini
  from public.gf_contratacao_participantes
  where pedido_id = v_pedido.id;

  update public.gf_contratacao_pedidos
  set status = 'conciliacao_pendente',
      reserva_status = case when v_tem_mini then 'conciliacao_pendente' else 'nao_aplicavel' end,
      atualizado_em = now()
  where id = v_pedido.id;

  update public.gf_contratacao_pagamentos p
  set transaction_nsu = case
        when p_transaction_nsu is not null
          and not exists (
            select 1 from public.gf_contratacao_pagamentos outro
            where outro.transaction_nsu = p_transaction_nsu
              and outro.pedido_id <> v_pedido.id
          )
          then coalesce(p.transaction_nsu,p_transaction_nsu)
        else p.transaction_nsu
      end,
      slug = coalesce(p.slug,p_slug),
      status = 'conciliacao_pendente',
      ultimo_payment_check = coalesce(p_payment_check,'{}'::jsonb),
      atualizado_em = now()
  where p.pedido_id = v_pedido.id;

  insert into public.gf_contratacao_auditoria(
    evento_contratacao_id,pedido_id,acao,detalhes
  ) values (
    v_pedido.evento_contratacao_id,v_pedido.id,'pagamento_em_conciliacao',
    jsonb_build_object('motivo',left(coalesce(p_motivo,'Revisão necessária.'),300))
  );

  return jsonb_build_object('status','conciliacao_pendente','ja_pago',false);
end;
$$;

create or replace function public.gf_contratacao_confirmar_pagamento(
  p_order_nsu text,
  p_transaction_nsu text,
  p_slug text,
  p_amount integer,
  p_paid_amount integer,
  p_metodo text,
  p_parcelas integer,
  p_payment_check jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_evento public.gf_contratacao_eventos%rowtype;
  v_tem_mini boolean;
  v_usadas integer := 0;
begin
  select evento_contratacao_id into v_pedido.evento_contratacao_id
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  -- A mesma linha de campanha usada na reserva é bloqueada primeiro,
  -- mantendo a ordem de locks e evitando ultrapassar a capacidade.
  select * into v_evento
  from public.gf_contratacao_eventos
  where id = v_pedido.evento_contratacao_id
  for update;

  select * into v_pedido
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu
  for update;

  if v_pedido.status = 'pago' then
    if exists (
      select 1 from public.gf_contratacao_pagamentos
      where pedido_id = v_pedido.id and transaction_nsu = p_transaction_nsu
    ) then
      return jsonb_build_object('status','pago','ja_processado',true);
    end if;
    return jsonb_build_object('status','pago','pagamento_duplicado',true);
  end if;

  if v_pedido.status in ('cancelado','reembolsado') then
    return jsonb_build_object('status','conciliacao_pendente','pedido_encerrado',true);
  end if;

  if p_amount is null or p_amount <> v_pedido.valor_total_centavos
    or p_paid_amount is null or p_paid_amount < v_pedido.valor_total_centavos then
    return public.gf_contratacao_marcar_conciliacao(
      p_order_nsu,p_transaction_nsu,p_slug,p_payment_check,
      'Valor confirmado pela InfinitePay diferente do total do pedido.'
    );
  end if;

  if exists (
    select 1 from public.gf_contratacao_pagamentos
    where transaction_nsu = p_transaction_nsu and order_nsu <> p_order_nsu
  ) then
    return public.gf_contratacao_marcar_conciliacao(
      p_order_nsu,p_transaction_nsu,p_slug,p_payment_check,
      'transaction_nsu já associado a outro pedido.'
    );
  end if;

  select coalesce(bool_or(consome_miniensaio),false) into v_tem_mini
  from public.gf_contratacao_participantes
  where pedido_id = v_pedido.id;

  if v_tem_mini and (
    v_pedido.reserva_status <> 'ativa'
    or v_pedido.reserva_expira_em is null
    or v_pedido.reserva_expira_em <= now()
  ) then
    select count(*) into v_usadas
    from public.gf_contratacao_participantes p
    join public.gf_contratacao_pedidos o on o.id = p.pedido_id
    where o.evento_contratacao_id = v_pedido.evento_contratacao_id
      and o.id <> v_pedido.id
      and p.consome_miniensaio = true
      and (
        o.status in ('pago','conciliacao_pendente')
        or (
          o.status in ('aguardando_pagamento','pagamento_pendente')
          and (o.reserva_expira_em > now() or o.reserva_status = 'conciliacao_pendente')
        )
      );

    if v_evento.capacidade_miniensaios is null
      or v_usadas >= v_evento.capacidade_miniensaios then
      return public.gf_contratacao_marcar_conciliacao(
        p_order_nsu,p_transaction_nsu,p_slug,p_payment_check,
        'Pagamento confirmado após expiração da reserva e sem vaga livre.'
      );
    end if;
  end if;

  update public.gf_contratacao_pagamentos
  set transaction_nsu = p_transaction_nsu,
      slug = p_slug,
      status = 'paid',
      metodo = p_metodo,
      parcelas = p_parcelas,
      valor_centavos = p_amount,
      ultimo_payment_check = coalesce(p_payment_check,'{}'::jsonb),
      atualizado_em = now()
  where pedido_id = v_pedido.id;

  update public.gf_contratacao_pedidos
  set status = 'pago',
      reserva_status = case when v_tem_mini then 'confirmada' else 'nao_aplicavel' end,
      pagamento_confirmado_em = now(),
      metodo_pagamento = case when p_metodo = 'pix' then 'pix' when p_metodo = 'credit_card' then 'cartao' else null end,
      parcelas = p_parcelas,
      valor_pago_centavos = p_paid_amount,
      atualizado_em = now()
  where id = v_pedido.id;

  insert into public.gf_contratacao_auditoria(
    evento_contratacao_id,pedido_id,acao,detalhes
  ) values (
    v_pedido.evento_contratacao_id,v_pedido.id,'pagamento_confirmado',
    jsonb_build_object('transaction_nsu',p_transaction_nsu,'amount',p_amount,'paid_amount',p_paid_amount,'metodo',p_metodo)
  );

  return jsonb_build_object('status','pago','ja_processado',false);
end;
$$;

-- Publicação somente quando todos os dados operacionais, comerciais e legais
-- estiverem preenchidos. A campanha começa e permanece como rascunho.
create or replace function public.gf_contratacao_marcar_reembolsado(
  p_order_nsu text,
  p_motivo text,
  p_usuario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_pedido public.gf_contratacao_pedidos%rowtype;
  v_evento_id uuid;
  v_tem_mini boolean;
begin
  if length(btrim(coalesce(p_motivo,''))) < 10 then
    raise exception 'Informe o motivo da conferência do estorno.';
  end if;

  select evento_contratacao_id into v_evento_id
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  perform 1
  from public.gf_contratacao_eventos
  where id = v_evento_id
  for update;

  select * into v_pedido
  from public.gf_contratacao_pedidos
  where order_nsu = p_order_nsu
  for update;

  if v_pedido.status = 'reembolsado' then
    return jsonb_build_object('ok',true,'ja_reembolsado',true);
  end if;

  if v_pedido.status not in ('pago','conciliacao_pendente') then
    raise exception 'Somente pedidos pagos ou em conciliação podem ser marcados como reembolsados.';
  end if;

  select coalesce(bool_or(consome_miniensaio),false) into v_tem_mini
  from public.gf_contratacao_participantes
  where pedido_id = v_pedido.id;

  update public.gf_contratacao_pedidos
  set status = 'reembolsado',
      reserva_status = case when v_tem_mini then 'expirada' else 'nao_aplicavel' end,
      atualizado_em = now()
  where id = v_pedido.id;

  update public.gf_contratacao_pagamentos
  set status = 'refunded',
      atualizado_em = now()
  where pedido_id = v_pedido.id;

  insert into public.gf_contratacao_auditoria(
    evento_contratacao_id,pedido_id,usuario_id,acao,detalhes
  ) values (
    v_pedido.evento_contratacao_id,v_pedido.id,p_usuario_id,
    'reembolso_confirmado_manualmente',
    jsonb_build_object('motivo',left(btrim(p_motivo),500))
  );

  return jsonb_build_object('ok',true,'status','reembolsado','ja_reembolsado',false);
end;
$$;

create or replace function public.gf_contratacao_admin_salvar_config(p_slug text,p_evento jsonb,p_pacotes jsonb,p_usuario_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_evento public.gf_contratacao_eventos%rowtype; v_item jsonb; v_codigo text; v_preco integer; v_pacotes_distintos integer;
begin
  if jsonb_typeof(p_evento) is distinct from 'object' or jsonb_typeof(p_pacotes) is distinct from 'array' or p_usuario_id is null then raise exception 'Configuração administrativa inválida.'; end if;
  select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if v_evento.status='publicado' then raise exception 'Pause a campanha antes de editar informações que afetam a contratação.'; end if;
  update public.gf_contratacao_eventos set
    data_evento=nullif(p_evento->>'data_evento','')::date,
    local=nullif(btrim(p_evento->>'local'),''),
    miniensaio_inicio=nullif(p_evento->>'miniensaio_inicio','')::timestamptz,
    miniensaio_fim=nullif(p_evento->>'miniensaio_fim','')::timestamptz,
    duracao_minutos=(p_evento->>'duracao_minutos')::integer,
    capacidade_miniensaios=nullif(p_evento->>'capacidade_miniensaios','')::integer,
    vendas_encerram_em=nullif(p_evento->>'vendas_encerram_em','')::timestamptz,
    reserva_minutos=(p_evento->>'reserva_minutos')::integer,
    prazo_entrega_dias=nullif(p_evento->>'prazo_entrega_dias','')::integer,
    whatsapp_atendimento=nullif(btrim(p_evento->>'whatsapp_atendimento'),''),
    fornecedor_nome=nullif(btrim(p_evento->>'fornecedor_nome'),''),
    fornecedor_documento=nullif(btrim(p_evento->>'fornecedor_documento'),''),
    fornecedor_endereco=nullif(btrim(p_evento->>'fornecedor_endereco'),''),
    fornecedor_email=nullif(btrim(p_evento->>'fornecedor_email'),''),
    privacidade_url=nullif(btrim(p_evento->>'privacidade_url'),''),
    privacidade_versao=nullif(btrim(p_evento->>'privacidade_versao'),''),
    privacidade_conteudo=nullif(btrim(p_evento->>'privacidade_conteudo'),''),
    termos_versao=nullif(btrim(p_evento->>'termos_versao'),''),
    termos_conteudo=nullif(p_evento->>'termos_conteudo',''),
    autorizacao_imagem_versao=nullif(btrim(p_evento->>'autorizacao_imagem_versao'),''),
    autorizacao_imagem_conteudo=nullif(p_evento->>'autorizacao_imagem_conteudo',''),
    atualizado_em=now() where id=v_evento.id;
  select count(distinct value->>'codigo') into v_pacotes_distintos from jsonb_array_elements(p_pacotes) as itens(value) where value->>'codigo' in ('miniensaio','palco','completo');
  if jsonb_array_length(p_pacotes)<>3 or v_pacotes_distintos<>3 then raise exception 'Envie os três pacotes da campanha para salvar os valores com segurança.'; end if;
  for v_item in select value from jsonb_array_elements(p_pacotes) loop
    v_codigo:=v_item->>'codigo';
    if v_codigo not in ('miniensaio','palco','completo') then raise exception 'Código de pacote inválido.'; end if;
    if jsonb_typeof(v_item->'ativo') is distinct from 'boolean' then raise exception 'Estado de disponibilidade do pacote inválido.'; end if;
    v_preco:=(v_item->>'preco_centavos')::integer;
    if v_preco not between 100 and 100000000 then raise exception 'O preço de cada pacote deve ficar entre R$ 1,00 e R$ 1.000.000,00.'; end if;
    update public.gf_contratacao_pacotes set preco_centavos=v_preco,ativo=(v_item->>'ativo')::boolean where evento_contratacao_id=v_evento.id and codigo=v_codigo;
    if not found then raise exception 'Pacote não encontrado para atualizar: %.',v_codigo; end if;
  end loop;
  insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes) values(v_evento.id,p_usuario_id,'configuracao_salva',jsonb_build_object('pacotes_atualizados',jsonb_array_length(p_pacotes)));
  return jsonb_build_object('ok',true);
end;
$$;
create or replace function public.gf_contratacao_admin_publicar(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_evento public.gf_contratacao_eventos%rowtype;
  v_pacotes integer;
  v_documento text;
begin
  select * into v_evento
  from public.gf_contratacao_eventos
  where slug = p_slug
  for update;

  if not found then
    raise exception 'Campanha não encontrada.';
  end if;

  v_documento := regexp_replace(coalesce(v_evento.fornecedor_documento,''),'\D','','g');

  if v_evento.data_evento is null
    or v_evento.data_evento < (now() at time zone 'America/Sao_Paulo')::date
    or nullif(btrim(v_evento.local),'') is null
    or v_evento.miniensaio_inicio is null
    or v_evento.miniensaio_fim is null
    or v_evento.miniensaio_fim <= v_evento.miniensaio_inicio
    or (v_evento.miniensaio_inicio at time zone 'America/Sao_Paulo')::date <> v_evento.data_evento
    or (v_evento.miniensaio_fim at time zone 'America/Sao_Paulo')::date <> v_evento.data_evento
    or v_evento.capacidade_miniensaios is null
    or v_evento.capacidade_miniensaios < 1
    or v_evento.vendas_encerram_em is null
    or v_evento.vendas_encerram_em <= now()
    or v_evento.vendas_encerram_em > now() + interval '366 days'
    or v_evento.vendas_encerram_em >= v_evento.miniensaio_inicio
    or extract(epoch from (v_evento.miniensaio_fim - v_evento.miniensaio_inicio))
      < (v_evento.duracao_minutos * v_evento.capacidade_miniensaios * 60)
    or v_evento.prazo_entrega_dias is null
    or v_evento.prazo_entrega_dias < 1
    or nullif(btrim(v_evento.termos_versao),'') is null
    or length(coalesce(v_evento.termos_conteudo,'')) < 100
    or coalesce(v_evento.privacidade_url,'') !~ '^https://[^[:space:]]+$'
    or nullif(btrim(v_evento.privacidade_versao),'') is null
    or length(coalesce(v_evento.privacidade_conteudo,'')) < 100
    or nullif(btrim(v_evento.fornecedor_nome),'') is null
    or length(v_documento) not between 11 and 14
    or nullif(btrim(v_evento.fornecedor_endereco),'') is null
    or coalesce(v_evento.fornecedor_email,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or (v_evento.autorizacao_imagem_conteudo is not null and v_evento.autorizacao_imagem_versao is null) then
    raise exception 'Faltam dados obrigatórios ou há informações inválidas. Revise data, local, horários, capacidade, prazo, termos, privacidade e identificação do fornecedor.';
  end if;

  if v_evento.whatsapp_atendimento is not null
    and length(regexp_replace(v_evento.whatsapp_atendimento,'\D','','g')) not between 10 and 13 then
    raise exception 'WhatsApp de atendimento inválido.';
  end if;

  select count(*) into v_pacotes
  from public.gf_contratacao_pacotes
  where evento_contratacao_id = v_evento.id
    and ativo = true
    and preco_centavos > 0;

  if v_pacotes < 1 then
    raise exception 'Ative ao menos um pacote com preço válido.';
  end if;

  if exists (
    select 1 from public.gf_contratacao_pacotes
    where evento_contratacao_id = v_evento.id
      and ativo = true
      and inclui_palco = true
      and minimo_fotos_por_coreografia < 10
  ) then
    raise exception 'Pacotes com fotos de palco precisam manter o mínimo de 10 fotos por coreografia.';
  end if;

  update public.gf_contratacao_eventos
  set status = 'publicado',
      publicado_em = now(),
      atualizado_em = now()
  where id = v_evento.id;

  insert into public.gf_contratacao_auditoria(evento_contratacao_id,acao,detalhes)
  values(v_evento.id,'campanha_publicada',jsonb_build_object('slug',p_slug));

  return jsonb_build_object('ok',true,'status','publicado');
end;
$$;

-- Todas as RPCs são internas e só podem ser chamadas pelas Edge Functions
-- autenticadas com a chave de serviço. Nenhuma delas é uma API pública direta.
revoke all on function public.gf_contratacao_registrar_tentativa(text,integer,integer) from public, anon, authenticated;
revoke all on function public.gf_contratacao_publica_dados(text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_payment_config() from public, anon, authenticated;
revoke all on function public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_registrar_checkout(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.gf_contratacao_status_por_hash(text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_webhook_dados(text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_marcar_conciliacao(text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_confirmar_pagamento(text,text,text,integer,integer,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.gf_contratacao_admin_salvar_config(text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.gf_contratacao_admin_publicar(text) from public, anon, authenticated;
revoke all on function public.gf_contratacao_marcar_reembolsado(text,text,uuid) from public, anon, authenticated;

grant execute on function public.gf_contratacao_registrar_tentativa(text,integer,integer) to service_role;
grant execute on function public.gf_contratacao_publica_dados(text) to service_role;
grant execute on function public.gf_contratacao_payment_config() to service_role;
grant execute on function public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.gf_contratacao_registrar_checkout(text,text,jsonb) to service_role;
grant execute on function public.gf_contratacao_status_por_hash(text) to service_role;
grant execute on function public.gf_contratacao_webhook_dados(text) to service_role;
grant execute on function public.gf_contratacao_marcar_conciliacao(text,text,text,jsonb,text) to service_role;
grant execute on function public.gf_contratacao_confirmar_pagamento(text,text,text,integer,integer,text,integer,jsonb) to service_role;
grant execute on function public.gf_contratacao_admin_salvar_config(text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gf_contratacao_admin_publicar(text) to service_role;
grant execute on function public.gf_contratacao_marcar_reembolsado(text,text,uuid) to service_role;
