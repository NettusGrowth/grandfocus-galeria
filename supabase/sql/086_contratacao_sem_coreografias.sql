
-- 086 | Contratação por pacote, sem cadastro de números individuais de palco.
-- O esquema legado permanece para leitura histórica; nenhum registro antigo é destruído.
-- Reservas futuras guardam apenas responsável, bailarina, turma e pacote.
-- NÃO ativa pagamentos reais; checkout segue bloqueado pelo backend.
-- A versão dos documentos atuais é atualizada para novos aceites.

create or replace function public.gf_contratacao_admin_salvar_config(
  p_slug text,
  p_evento jsonb,
  p_pacotes jsonb,
  p_usuario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_evento public.gf_contratacao_eventos%rowtype;
  v_item jsonb;
  v_codigo text;
  v_nome text;
  v_descricao jsonb;
  v_preco integer;
  v_inclui_mini boolean;
  v_inclui_palco boolean;
  v_minimo integer;
  v_ativo boolean;
  v_ordem integer;
  v_existing public.gf_contratacao_pacotes%rowtype;
  v_existing_found boolean;
  v_seen text[] := array[]::text[];
  v_count integer := 0;
  v_nome_publico text;
begin
  if jsonb_typeof(p_evento) is distinct from 'object'
    or jsonb_typeof(p_pacotes) is distinct from 'array'
    or p_usuario_id is null then
    raise exception 'Configuração administrativa inválida.';
  end if;
  if jsonb_array_length(p_pacotes) > 20 then
    raise exception 'Cada campanha pode ter até 20 experiências.';
  end if;

  select * into v_evento
  from public.gf_contratacao_eventos
  where slug = p_slug
  for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if v_evento.status = 'publicado' then
    raise exception 'Pause a campanha antes de editar informações que afetam a contratação.';
  end if;

  v_nome_publico := nullif(btrim(p_evento->>'nome_publico'),'');
  if v_nome_publico is null or length(v_nome_publico) not between 3 and 120 then
    raise exception 'Informe um nome público entre 3 e 120 caracteres.';
  end if;

  update public.gf_contratacao_eventos set
    nome_publico = v_nome_publico,
    data_evento = nullif(p_evento->>'data_evento','')::date,
    local = nullif(btrim(p_evento->>'local'),''),
    miniensaio_inicio = nullif(p_evento->>'miniensaio_inicio','')::timestamptz,
    miniensaio_fim = nullif(p_evento->>'miniensaio_fim','')::timestamptz,
    duracao_minutos = (p_evento->>'duracao_minutos')::integer,
    capacidade_miniensaios = nullif(p_evento->>'capacidade_miniensaios','')::integer,
    vendas_encerram_em = nullif(p_evento->>'vendas_encerram_em','')::timestamptz,
    reserva_minutos = (p_evento->>'reserva_minutos')::integer,
    prazo_entrega_dias = nullif(p_evento->>'prazo_entrega_dias','')::integer,
    whatsapp_atendimento = nullif(btrim(p_evento->>'whatsapp_atendimento'),''),
    fornecedor_nome = nullif(btrim(p_evento->>'fornecedor_nome'),''),
    fornecedor_documento = nullif(btrim(p_evento->>'fornecedor_documento'),''),
    fornecedor_endereco = nullif(btrim(p_evento->>'fornecedor_endereco'),''),
    fornecedor_email = nullif(btrim(p_evento->>'fornecedor_email'),''),
    privacidade_url = nullif(btrim(p_evento->>'privacidade_url'),''),
    privacidade_versao = nullif(btrim(p_evento->>'privacidade_versao'),''),
    privacidade_conteudo = nullif(btrim(p_evento->>'privacidade_conteudo'),''),
    termos_versao = nullif(btrim(p_evento->>'termos_versao'),''),
    termos_conteudo = nullif(p_evento->>'termos_conteudo',''),
    autorizacao_imagem_versao = nullif(btrim(p_evento->>'autorizacao_imagem_versao'),''),
    autorizacao_imagem_conteudo = nullif(p_evento->>'autorizacao_imagem_conteudo',''),
    atualizado_em = now()
  where id = v_evento.id;

  update public.eventos
  set nome = v_nome_publico,
      data = nullif(p_evento->>'data_evento','')::date
  where id = v_evento.evento_id
    and escola_id = v_evento.escola_id;
  if not found then
    raise exception 'O evento vinculado não foi encontrado na galeria. Nenhuma alteração foi mantida.';
  end if;

  for v_item in select value from jsonb_array_elements(p_pacotes) loop
    v_codigo := lower(btrim(coalesce(v_item->>'codigo','')));
    v_nome := btrim(coalesce(v_item->>'nome',''));
    v_descricao := coalesce(v_item->'descricao','[]'::jsonb);

    if v_codigo !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(v_codigo) not between 2 and 60 then
      raise exception 'Código interno de experiência inválido.';
    end if;
    if length(v_nome) not between 2 and 100 then
      raise exception 'Cada experiência precisa ter um nome entre 2 e 100 caracteres.';
    end if;
    if jsonb_typeof(v_descricao) is distinct from 'array'
      or jsonb_array_length(v_descricao) > 20 then
      raise exception 'A descrição de cada experiência deve ser uma lista com até 20 itens.';
    end if;
    if jsonb_typeof(v_item->'ativo') is distinct from 'boolean'
      or jsonb_typeof(v_item->'inclui_miniensaio') is distinct from 'boolean'
      or jsonb_typeof(v_item->'inclui_palco') is distinct from 'boolean' then
      raise exception 'Revise a disponibilidade e os itens incluídos na experiência.';
    end if;

    v_ativo := (v_item->>'ativo')::boolean;
    v_inclui_mini := (v_item->>'inclui_miniensaio')::boolean;
    v_inclui_palco := (v_item->>'inclui_palco')::boolean;
    v_preco := nullif(v_item->>'preco_centavos','')::integer;
    v_minimo := 0; -- Campo legado mantido apenas por compatibilidade do esquema.
    v_ordem := coalesce(nullif(v_item->>'ordem','')::integer,v_count);

    if v_preco is null or v_preco not between 100 and 100000000 then
      raise exception 'O preço de cada experiência deve ficar entre R$ 1,00 e R$ 1.000.000,00.';
    end if;
    if v_ordem < 0 or v_ordem > 100 then
      raise exception 'A ordem das experiências é inválida.';
    end if;
    if v_codigo = any(v_seen) then
      raise exception 'Há duas experiências com o mesmo código interno.';
    end if;
    v_seen := array_append(v_seen,v_codigo);

    select * into v_existing
    from public.gf_contratacao_pacotes
    where evento_contratacao_id = v_evento.id
      and codigo = v_codigo;
    v_existing_found := found;

    if v_existing_found and exists (
      select 1 from public.gf_contratacao_participantes where pacote_id = v_existing.id
    ) and (
      v_existing.nome is distinct from v_nome
      or v_existing.descricao is distinct from v_descricao
      or v_existing.preco_centavos is distinct from v_preco
      or v_existing.inclui_miniensaio is distinct from v_inclui_mini
      or v_existing.inclui_palco is distinct from v_inclui_palco
    ) then
      raise exception 'A experiência "%" já aparece em pedidos. Para preservar o histórico, desative-a e crie outra em vez de alterar seus dados.',v_existing.nome;
    end if;

    insert into public.gf_contratacao_pacotes (
      evento_contratacao_id,codigo,nome,descricao,preco_centavos,
      inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ativo,ordem
    )
    values (
      v_evento.id,v_codigo,v_nome,v_descricao,v_preco,
      v_inclui_mini,v_inclui_palco,v_minimo,v_ativo,v_ordem
    )
    on conflict (evento_contratacao_id,codigo) do update set
      nome = excluded.nome,
      descricao = excluded.descricao,
      preco_centavos = excluded.preco_centavos,
      inclui_miniensaio = excluded.inclui_miniensaio,
      inclui_palco = excluded.inclui_palco,
      minimo_fotos_por_coreografia = excluded.minimo_fotos_por_coreografia,
      ativo = excluded.ativo,
      ordem = excluded.ordem;

    v_count := v_count + 1;
  end loop;

  update public.gf_contratacao_pacotes
  set ativo = false
  where evento_contratacao_id = v_evento.id
    and not (codigo = any(v_seen));

  insert into public.gf_contratacao_auditoria (
    evento_contratacao_id,usuario_id,acao,detalhes
  )
  values (
    v_evento.id,p_usuario_id,'configuracao_salva',
    jsonb_build_object('experiencias_atualizadas',v_count)
  );

  return jsonb_build_object('ok',true,'experiencias_atualizadas',v_count);
end;
$$;

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
  v_campanha_tem_mini boolean := false;
  v_item jsonb;
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

  select exists (
    select 1 from public.gf_contratacao_pacotes
    where evento_contratacao_id = v_evento.id and ativo = true and inclui_miniensaio = true
  ) into v_campanha_tem_mini;

  if v_evento.data_evento is null
    or (v_campanha_tem_mini and (v_evento.miniensaio_inicio is null or v_evento.miniensaio_fim is null))
    or nullif(btrim(v_evento.local),'') is null
    or v_evento.termos_versao is null
    or v_evento.termos_conteudo is null
    or coalesce(v_evento.privacidade_url,'') !~ '^https://[^[:space:]]+$'
    or nullif(btrim(v_evento.privacidade_versao),'') is null
    or length(coalesce(v_evento.privacidade_conteudo,'')) < 100
    or v_evento.fornecedor_nome is null
    or v_evento.fornecedor_documento is null
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
      raise exception 'Experiência inválida para esta campanha.';
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
  v_tem_mini boolean := false;
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

  select exists (
    select 1 from public.gf_contratacao_pacotes
    where evento_contratacao_id = v_evento.id and ativo = true and inclui_miniensaio = true
  ) into v_tem_mini;

  v_documento := regexp_replace(coalesce(v_evento.fornecedor_documento,''),'\D','','g');

  if v_evento.data_evento is null
    or v_evento.data_evento < (now() at time zone 'America/Sao_Paulo')::date
    or nullif(btrim(v_evento.local),'') is null
    or v_evento.vendas_encerram_em is null
    or v_evento.vendas_encerram_em <= now()
    or v_evento.vendas_encerram_em > now() + interval '366 days'
    or (v_tem_mini and (
      v_evento.miniensaio_inicio is null
      or v_evento.miniensaio_fim is null
      or v_evento.miniensaio_fim <= v_evento.miniensaio_inicio
      or (v_evento.miniensaio_inicio at time zone 'America/Sao_Paulo')::date <> v_evento.data_evento
      or (v_evento.miniensaio_fim at time zone 'America/Sao_Paulo')::date <> v_evento.data_evento
      or (v_evento.capacidade_miniensaios is not null and v_evento.capacidade_miniensaios < 1)
      or v_evento.vendas_encerram_em >= v_evento.miniensaio_inicio
      or (
        v_evento.capacidade_miniensaios is not null
        and extract(epoch from (v_evento.miniensaio_fim - v_evento.miniensaio_inicio))
          < (v_evento.duracao_minutos * v_evento.capacidade_miniensaios * 60)
      )
    ))
    or (v_evento.prazo_entrega_dias is not null and v_evento.prazo_entrega_dias < 1)
    or nullif(btrim(v_evento.termos_versao),'') is null
    or length(coalesce(v_evento.termos_conteudo,'')) < 100
    or coalesce(v_evento.privacidade_url,'') !~ '^https://[^[:space:]]+$'
    or nullif(btrim(v_evento.privacidade_versao),'') is null
    or length(coalesce(v_evento.privacidade_conteudo,'')) < 100
    or nullif(btrim(v_evento.fornecedor_nome),'') is null
    or length(v_documento) not between 11 and 14
    or coalesce(v_evento.fornecedor_email,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or (v_evento.autorizacao_imagem_conteudo is not null and v_evento.autorizacao_imagem_versao is null) then
    raise exception 'Faltam dados obrigatórios ou há informações inválidas. Revise data, local, horários e capacidade quando houver miniensaio, prazo de vendas, termos, privacidade e identificação do fornecedor.';
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
    raise exception 'Ative ao menos uma experiência com preço válido.';
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

  if v_tem_mini and v_evento.capacidade_miniensaios is not null
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


-- As fotografias em palco continuam coletivas e em pequenos grupos.
-- Preservar preços e pacotes; remover apenas a antiga descrição de contagem por dança.
update public.gf_contratacao_pacotes p
set descricao=(
  select jsonb_agg(
    case when lower(part.value) like '%coreograf%'
      then to_jsonb('Cobertura fotográfica do palco durante o espetáculo, com registros coletivos e de pequenos grupos; sem garantia de fotografias individuais.'::text)
      else to_jsonb(part.value)
    end
    order by part.ord
  )
  from jsonb_array_elements_text(p.descricao) with ordinality as part(value,ord)
)
where exists (
  select 1 from jsonb_array_elements_text(p.descricao) as item(value)
  where lower(item.value) like '%coreograf%'
);

-- O mínimo antigo deixa de ter função operacional; nenhum pacote tem o preço alterado.
update public.gf_contratacao_pacotes set minimo_fotos_por_coreografia=0
where minimo_fotos_por_coreografia <> 0;

-- Atualiza somente documentos VIGENTES da campanha em questão;
-- aceites anteriores têm cópias imutáveis em gf_contratacao_aceites.
update public.gf_contratacao_eventos
set
 termos_conteudo = replace(
   replace(termos_conteudo,
      'Fotos de palco, R$ 79,00. Inclui no mínimo dez fotografias digitais por coreografia dançada e informada no pedido.',
      'Fotos de palco, R$ 79,00. Inclui cobertura fotográfica das apresentações no palco, com enquadramentos coletivos e de pequenos grupos. Fotografias individuais não são garantidas.'),
   'As fotografias de palco dependem da realização das coreografias e das condições do espetáculo, incluindo iluminação, posicionamento e visibilidade.',
   'As fotografias de palco dependem da realização das apresentações e das condições do espetáculo, incluindo iluminação, posicionamento e visibilidade.'),
 privacidade_conteudo = replace(privacidade_conteudo,'nomes de coreografias; ',''),
 termos_versao = '2026-11-08',
 privacidade_versao = '2026-11-08'
where slug = 'entre-estacoes'
  and (
    lower(coalesce(termos_conteudo,'')) like '%coreograf%'
    or lower(coalesce(privacidade_conteudo,'')) like '%coreograf%'
  );

-- Evitar deixar um texto legado incompleto ou incorreto em qualquer página pública.
do $check_current_copy$
begin
 if exists (
  select 1 from public.gf_contratacao_eventos
  where slug='entre-estacoes'
  and (lower(coalesce(termos_conteudo,'')) like '%coreograf%'
       or lower(coalesce(privacidade_conteudo,'')) like '%coreograf%')
 ) then
   raise exception 'Os textos de contratação ainda contêm uma referência antiga. Revise a migração.';
 end if;
end;
$check_current_copy$;
