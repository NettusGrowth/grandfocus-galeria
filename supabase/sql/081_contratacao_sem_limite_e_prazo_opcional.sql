-- Permite campanha por ordem de chegada sem limite numérico de miniensaios
-- e sem publicar prazo de entrega quando ele não foi definido.
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

    if nullif(v_item->>'idade','') is not null then
      if length(v_item->>'idade') not between 1 and 2
        or (v_item->>'idade') ~ '[^0-9]' then
        raise exception 'A idade informada deve ser um número inteiro entre 1 e 99.';
      end if;
      if (v_item->>'idade')::integer not between 1 and 99 then
        raise exception 'A idade informada deve ser um número inteiro entre 1 e 99.';
      end if;
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

    if v_evento.capacidade_miniensaios is not null
      and v_usadas + v_vagas > v_evento.capacidade_miniensaios then
      raise exception 'Não há vagas suficientes para o miniensaio.';
    end if;
  end if;

  -- Uma reserva nunca pode ultrapassar o encerramento das vendas.
  v_expira := case
    when v_tem_mini then least(
      now() + make_interval(mins => v_evento.reserva_minutos),
      v_evento.vendas_encerram_em
    )
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

  if coalesce((p_payment_check->>'success')::boolean,false) is not true
    or coalesce((p_payment_check->>'paid')::boolean,false) is not true
    or coalesce(p_transaction_nsu,'') = ''
    or coalesce(p_slug,'') = ''
    or coalesce(p_payment_check->>'amount','') = ''
    or coalesce(p_payment_check->>'paid_amount','') = '' then
    raise exception 'A confirmação financeira não corresponde à resposta validada da InfinitePay.';
  end if;
  if (p_payment_check->>'amount') ~ '[^0-9]'
    or length(p_payment_check->>'amount') > 10
    or (p_payment_check->>'paid_amount') ~ '[^0-9]'
    or length(p_payment_check->>'paid_amount') > 10 then
    raise exception 'Os valores do payment_check precisam ser inteiros em centavos.';
  end if;
  if (p_payment_check->>'amount')::integer is distinct from p_amount
    or (p_payment_check->>'paid_amount')::integer is distinct from p_paid_amount then
    raise exception 'A confirmação financeira não corresponde à resposta validada da InfinitePay.';
  end if;
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

    if v_evento.capacidade_miniensaios is not null
      and v_usadas >= v_evento.capacidade_miniensaios then
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
  v_vagas_ocupadas integer := 0;
begin
  select * into v_evento
  from public.gf_contratacao_eventos
  where slug = p_slug
  for update;

  if not found then
    raise exception 'Campanha não encontrada.';
  end if;

  if v_evento.status = 'encerrado' then
    raise exception 'Esta campanha foi encerrada e não pode ser reaberta. Crie uma nova campanha para um novo evento.';
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
    or (v_evento.capacidade_miniensaios is not null and v_evento.capacidade_miniensaios < 1)
    or v_evento.vendas_encerram_em is null
    or v_evento.vendas_encerram_em <= now()
    or v_evento.vendas_encerram_em > now() + interval '366 days'
    or v_evento.vendas_encerram_em >= v_evento.miniensaio_inicio
    or (
      v_evento.capacidade_miniensaios is not null
      and extract(epoch from (v_evento.miniensaio_fim - v_evento.miniensaio_inicio))
        < (v_evento.duracao_minutos * v_evento.capacidade_miniensaios * 60)
    )
    or (v_evento.prazo_entrega_dias is not null and v_evento.prazo_entrega_dias < 1)
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

  -- A capacidade nunca pode ser reduzida abaixo das vagas já vendidas
  -- ou temporariamente reservadas. O lock na linha do evento serializa
  -- esta conferência com novas reservas e confirmações de pagamento.
  select count(*)::integer into v_vagas_ocupadas
  from public.gf_contratacao_participantes p
  join public.gf_contratacao_pedidos o on o.id = p.pedido_id
  where o.evento_contratacao_id = v_evento.id
    and p.consome_miniensaio = true
    and (
      o.status in ('pago','conciliacao_pendente')
      or (
        o.status in ('aguardando_pagamento','pagamento_pendente')
        and (
          o.reserva_expira_em > now()
          or o.reserva_status = 'conciliacao_pendente'
        )
      )
    );

  if v_evento.capacidade_miniensaios is not null
    and v_vagas_ocupadas > v_evento.capacidade_miniensaios then
    raise exception 'A capacidade informada é menor que os miniensaios já vendidos ou reservados. Revise as vagas antes de publicar.';
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
revoke all on function public.gf_contratacao_admin_alterar_status(text,text,uuid) from public, anon, authenticated;
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
grant execute on function public.gf_contratacao_admin_alterar_status(text,text,uuid) to service_role;
grant execute on function public.gf_contratacao_admin_publicar(text) to service_role;
grant execute on function public.gf_contratacao_marcar_reembolsado(text,text,uuid) to service_role;
