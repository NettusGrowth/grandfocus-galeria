do $test$
declare
  v_mini uuid;
  v_palco uuid;
  v_idempotency uuid;
  v_mini_result jsonb;
  v_mini_two_result jsonb;
  v_mini_three_result jsonb;
  v_retry_result jsonb;
  v_status_transition_result jsonb;
  v_palco_result jsonb;
  v_confirm_result jsonb;
  v_status_result jsonb;
  v_rate_result jsonb;
  v_duplicate_result jsonb;
  v_conciliation_result jsonb;
  v_refund_result jsonb;
  v_conflict_result jsonb;
  v_event_json jsonb;
  v_new_campaign jsonb;
  v_new_event_id uuid;
  v_new_campaign_id uuid;
  v_stage_only_package uuid;
  v_stage_only_result jsonb;
  v_rate_key text := repeat('9',64);
begin
  v_new_campaign := public.gf_contratacao_admin_criar_campanha(
    'Evento criado pelo gerenciador',
    current_date + 12,
    '7896da46-5dd8-4d4e-ac50-36fda4966566',
    'gerenciador-teste',
    '11111111-1111-4111-8111-111111111111'
  );
  v_new_event_id := (v_new_campaign->>'evento_id')::uuid;
  v_new_campaign_id := (v_new_campaign->>'evento_contratacao_id')::uuid;
  if not exists (
    select 1 from public.eventos e
    join public.gf_contratacao_eventos c on c.evento_id = e.id
    where e.id = v_new_event_id
      and c.id = v_new_campaign_id
      and c.slug = 'gerenciador-teste'
      and c.status = 'rascunho'
      and e.nome = 'Evento criado pelo gerenciador'
  ) then
    raise exception 'O evento da galeria e a contratação não foram criados juntos.';
  end if;

  -- Uma campanha apenas de palco pode ser publicada sem horários ou capacidade de miniensaio.
  perform public.gf_contratacao_admin_salvar_config(
    'gerenciador-teste',
    jsonb_build_object(
      'nome_publico','Evento criado pelo gerenciador',
      'data_evento',current_date + 12,
      'local','Teatro de teste',
      'miniensaio_inicio',null,
      'miniensaio_fim',null,
      'duracao_minutos',5,
      'capacidade_miniensaios',null,
      'vendas_encerram_em',((current_date + 11)::timestamp + time '22:00') at time zone 'America/Sao_Paulo',
      'reserva_minutos',15,
      'prazo_entrega_dias',null,
      'whatsapp_atendimento',null,
      'fornecedor_nome','Fornecedor de Teste',
      'fornecedor_documento','11222333000181',
      'fornecedor_endereco',null,
      'fornecedor_email','teste@example.com',
      'privacidade_url','https://example.com/privacidade',
      'privacidade_versao','1.0',
      'privacidade_conteudo','Política de privacidade de teste com finalidade, base legal, dados coletados, armazenamento, compartilhamento, direitos dos titulares e canal de contato.',
      'termos_versao','1.0',
      'termos_conteudo','Termos de teste com informações sobre valores, responsabilidades, entrega das fotografias e condições da contratação.',
      'autorizacao_imagem_versao',null,
      'autorizacao_imagem_conteudo',null
    ),
    jsonb_build_array(jsonb_build_object(
      'codigo','somente-palco',
      'nome','Fotos de palco',
      'descricao',jsonb_build_array('Fotografias das coreografias selecionadas'),
      'preco_centavos',7900,
      'inclui_miniensaio',false,
      'inclui_palco',true,
      'minimo_fotos_por_coreografia',10,
      'ativo',true,
      'ordem',0
    )),
    '11111111-1111-4111-8111-111111111111'
  );
  perform public.gf_contratacao_admin_publicar('gerenciador-teste');
  select id into v_stage_only_package
  from public.gf_contratacao_pacotes
  where evento_contratacao_id = v_new_campaign_id and codigo = 'somente-palco';

  v_stage_only_result := public.gf_contratacao_criar_reserva(
    'gerenciador-teste',
    '{"nome":"Responsável Palco","whatsapp":"34977777777","email":"palco@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_stage_only_package,
      'nome','Bailarina Palco',
      'turma','Avançado',
      'idade',15
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('5',64),
    gen_random_uuid()::text,
    repeat('6',64)
  );
  if v_stage_only_result->>'status' <> 'aguardando_pagamento'
    or (select reserva_status from public.gf_contratacao_pedidos where id=(v_stage_only_result->>'pedido_id')::uuid) <> 'nao_aplicavel'
    or v_stage_only_result->>'reserva_expira_em' is not null then
    raise exception 'Uma contratação somente de palco não deveria reservar horário de miniensaio.';
  end if;

  update public.gf_contratacao_eventos
  set data_evento = current_date + 3,
      local = 'Local de teste',
      miniensaio_inicio = ((current_date + 3)::timestamp + time '17:30') at time zone 'America/Sao_Paulo',
      miniensaio_fim = ((current_date + 3)::timestamp + time '18:45') at time zone 'America/Sao_Paulo',
      duracao_minutos = 5,
      capacidade_miniensaios = 1,
      vendas_encerram_em = ((current_date + 2)::timestamp + time '23:00') at time zone 'America/Sao_Paulo',
      reserva_minutos = 15,
      prazo_entrega_dias = 20,
      termos_versao = '1.0',
      termos_conteudo = 'Termos de teste com mais de cem caracteres para validar a publicação da campanha em ambiente temporário e sem qualquer cobrança real.',
      privacidade_url = 'https://example.com/privacidade',
      privacidade_versao = '1.0',
      privacidade_conteudo = 'Política de privacidade de teste com informações sobre finalidade, base legal, dados coletados, armazenamento, compartilhamento, direitos dos titulares e canal de contato para solicitações.',
      fornecedor_nome = 'Fornecedor de Teste',
      fornecedor_documento = '11222333000181',
      fornecedor_endereco = 'Endereço de teste, 100, Centro',
      fornecedor_email = 'teste@example.com'
  where slug = 'entre-estacoes';

  -- Salvar a campanha e os pacotes em uma única transação.
  perform public.gf_contratacao_admin_salvar_config(
    'entre-estacoes',
    jsonb_build_object(
      'nome_publico','Entre Estações',
      'data_evento',current_date + 3,
      'local','Local de teste',
      'miniensaio_inicio',((current_date + 3)::timestamp + time '17:30') at time zone 'America/Sao_Paulo',
      'miniensaio_fim',((current_date + 3)::timestamp + time '18:45') at time zone 'America/Sao_Paulo',
      'duracao_minutos',5,
      'capacidade_miniensaios',1,
      'vendas_encerram_em',((current_date + 2)::timestamp + time '23:00') at time zone 'America/Sao_Paulo',
      'reserva_minutos',15,
      'prazo_entrega_dias',20,
      'whatsapp_atendimento',null,
      'fornecedor_nome','Fornecedor de Teste',
      'fornecedor_documento','11222333000181',
      'fornecedor_endereco','Endereço de teste, 100, Centro',
      'fornecedor_email','teste@example.com',
      'privacidade_url','https://example.com/privacidade',
      'privacidade_versao','1.0',
      'privacidade_conteudo','Política de privacidade de teste com informações sobre finalidade, base legal, dados coletados, armazenamento, compartilhamento, direitos dos titulares e canal de contato para solicitações.',
      'termos_versao','1.0',
      'termos_conteudo','Termos de teste com mais de cem caracteres para validar a publicação da campanha em ambiente temporário e sem qualquer cobrança real.',
      'autorizacao_imagem_versao',null,
      'autorizacao_imagem_conteudo',null
    ),
    jsonb_build_array(
      jsonb_build_object('codigo','miniensaio','nome','Miniensaio no teatro','descricao',jsonb_build_array('3 fotos individuais','2 fotos com a família'),'preco_centavos',11900,'inclui_miniensaio',true,'inclui_palco',false,'minimo_fotos_por_coreografia',0,'ativo',true,'ordem',0),
      jsonb_build_object('codigo','palco','nome','Fotos de palco','descricao',jsonb_build_array('Mínimo de 10 fotos por coreografia selecionada'),'preco_centavos',7900,'inclui_miniensaio',false,'inclui_palco',true,'minimo_fotos_por_coreografia',10,'ativo',true,'ordem',1),
      jsonb_build_object('codigo','completo','nome','Experiência completa','descricao',jsonb_build_array('3 fotos individuais','2 fotos com a família','Mínimo de 10 fotos por coreografia selecionada'),'preco_centavos',15900,'inclui_miniensaio',true,'inclui_palco',true,'minimo_fotos_por_coreografia',10,'ativo',true,'ordem',2)
    ),
    '11111111-1111-4111-8111-111111111111'
  );

  -- Uma falha no preço de um pacote deve desfazer também a atualização do evento.
  select to_jsonb(e) into v_event_json
  from public.gf_contratacao_eventos e
  where slug='entre-estacoes';
  v_event_json := jsonb_set(v_event_json,'{local}','"Local que não deve ser salvo"');
  begin
    perform public.gf_contratacao_admin_salvar_config(
      'entre-estacoes',
      v_event_json,
      jsonb_build_array(
        jsonb_build_object('codigo','miniensaio','nome','Miniensaio no teatro','descricao',jsonb_build_array('3 fotos individuais','2 fotos com a família'),'preco_centavos',0,'inclui_miniensaio',true,'inclui_palco',false,'minimo_fotos_por_coreografia',0,'ativo',true,'ordem',0),
        jsonb_build_object('codigo','palco','nome','Fotos de palco','descricao',jsonb_build_array('Mínimo de 10 fotos por coreografia selecionada'),'preco_centavos',7900,'inclui_miniensaio',false,'inclui_palco',true,'minimo_fotos_por_coreografia',10,'ativo',true,'ordem',1),
        jsonb_build_object('codigo','completo','nome','Experiência completa','descricao',jsonb_build_array('3 fotos individuais','2 fotos com a família','Mínimo de 10 fotos por coreografia selecionada'),'preco_centavos',15900,'inclui_miniensaio',true,'inclui_palco',true,'minimo_fotos_por_coreografia',10,'ativo',true,'ordem',2)
      ),
      '11111111-1111-4111-8111-111111111111'
    );
    raise exception 'O salvamento deveria rejeitar o preço inválido.';
  exception when others then
    if sqlerrm not like '%preço%' then raise; end if;
  end;
  if (select local from public.gf_contratacao_eventos where slug='entre-estacoes') <> 'Local de teste' then
    raise exception 'O salvamento administrativo deixou uma alteração parcial.';
  end if;

  -- A capacidade não pode prometer mais miniensaios do que cabem na janela.
  update public.gf_contratacao_eventos
  set capacidade_miniensaios = 1000
  where slug = 'entre-estacoes';
  begin
    perform public.gf_contratacao_admin_publicar('entre-estacoes');
    raise exception 'A publicação deveria rejeitar uma capacidade impossível para a duração configurada.';
  exception when others then
    if sqlerrm not like '%Faltam dados obrigatórios%' then
      raise;
    end if;
  end;

  update public.gf_contratacao_eventos
  set capacidade_miniensaios = 1
  where slug = 'entre-estacoes';
  perform public.gf_contratacao_admin_publicar('entre-estacoes');

  -- Rate limit: duas tentativas permitidas, a terceira bloqueada.
  v_rate_result := public.gf_contratacao_registrar_tentativa(v_rate_key,2,3600);
  if (v_rate_result->>'permitido')::boolean is not true then
    raise exception 'A primeira tentativa deveria ser permitida.';
  end if;
  v_rate_result := public.gf_contratacao_registrar_tentativa(v_rate_key,2,3600);
  if (v_rate_result->>'permitido')::boolean is not true then
    raise exception 'A segunda tentativa deveria ser permitida.';
  end if;
  v_rate_result := public.gf_contratacao_registrar_tentativa(v_rate_key,2,3600);
  if (v_rate_result->>'permitido')::boolean is not false then
    raise exception 'A terceira tentativa deveria ser bloqueada pelo rate limit.';
  end if;

  if not has_function_privilege('service_role','public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') then
    raise exception 'service_role precisa executar a RPC de reserva.';
  end if;
  if has_function_privilege('anon','public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.gf_contratacao_criar_reserva(text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') then
    raise exception 'A RPC de reserva não pode ser executável por anon ou authenticated.';
  end if;
  if has_table_privilege('anon','public.gf_contratacao_pedidos','SELECT')
    or has_table_privilege('authenticated','public.gf_contratacao_pedidos','SELECT') then
    raise exception 'As tabelas de pedidos precisam permanecer privadas.';
  end if;

  select id into v_mini
  from public.gf_contratacao_pacotes
  where codigo = 'miniensaio' and evento_contratacao_id = (
    select id from public.gf_contratacao_eventos where slug='entre-estacoes'
  );

  select id into v_palco
  from public.gf_contratacao_pacotes
  where codigo = 'palco' and evento_contratacao_id = (
    select id from public.gf_contratacao_eventos where slug='entre-estacoes'
  );

  -- A contratação não pode ser criada sem ciência separada da política de privacidade.
  begin
    perform public.gf_contratacao_criar_reserva(
      'entre-estacoes',
      '{"nome":"Responsável Teste","whatsapp":"34999999999","email":"teste@example.com"}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'pacote_id',v_mini,
        'nome','Bailarina Sem Ciência',
        'turma','Intermediário',
        'idade',10,
        'coreografias','[]'::jsonb
      )),
      '{"responsavel_legal":true,"aceitou_termos":true,"uso_imagem":false}'::jsonb,
      repeat('1',64),
      gen_random_uuid()::text,
      repeat('2',64)
    );
    raise exception 'O teste deveria exigir ciência da política de privacidade.';
  exception when others then
    if sqlerrm not like '%ciência da política de privacidade%' then raise; end if;
  end;

  -- Idade fora da faixa deve ser rejeitada no banco, mesmo se alguém ignorar o navegador.
  begin
    perform public.gf_contratacao_criar_reserva(
      'entre-estacoes',
      '{"nome":"Responsável Teste","whatsapp":"34999999999","email":"teste@example.com"}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'pacote_id',v_mini,
        'nome','Bailarina Idade Inválida',
        'turma','Intermediário',
        'idade',0,
        'coreografias','[]'::jsonb
      )),
      '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
      repeat('3',64),
      gen_random_uuid()::text,
      repeat('4',64)
    );
    raise exception 'O teste deveria rejeitar idade zero.';
  exception when others then
    if sqlerrm not like '%idade informada%' then raise; end if;
  end;

  v_idempotency := gen_random_uuid();
  v_mini_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Teste","whatsapp":"34999999999","email":"teste@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_mini,
      'nome','Bailarina Teste',
      'turma','Intermediário',
      'idade',10,
      'coreografias','[]'::jsonb
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('a',64),
    v_idempotency::text,
    repeat('b',64)
  );

  if (v_mini_result->>'valor_total_centavos')::integer <> 11900 then
    raise exception 'Preço do miniensaio não foi validado pelo servidor.';
  end if;

  if not exists (
    select 1 from public.gf_contratacao_aceites a
    where a.pedido_id = (v_mini_result->>'pedido_id')::uuid
      and a.privacidade_versao = '1.0'
      and a.privacidade_sha256 = encode(extensions.digest(a.privacidade_conteudo,'sha256'),'hex')
  ) then
    raise exception 'O aceite não preservou a versão e o hash da política de privacidade.';
  end if;

  v_retry_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Teste","whatsapp":"34999999999","email":"teste@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_mini,
      'nome','Bailarina Teste',
      'turma','Intermediário',
      'idade',10,
      'coreografias','[]'::jsonb
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('a',64),
    v_idempotency::text,
    repeat('b',64)
  );

  if coalesce((v_retry_result->>'reutilizado')::boolean,false) is not true
    or v_retry_result->>'order_nsu' <> v_mini_result->>'order_nsu' then
    raise exception 'A idempotência do pedido não foi preservada.';
  end if;

  begin
    perform public.gf_contratacao_criar_reserva(
      'entre-estacoes',
      '{"nome":"Outro Responsável","whatsapp":"34988888888","email":"outro@example.com"}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'pacote_id',v_mini,
        'nome','Outra Bailarina',
        'turma','Intermediário',
        'idade',11,
        'coreografias','[]'::jsonb
      )),
      '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
      repeat('c',64),
      gen_random_uuid()::text,
      repeat('d',64)
    );
    raise exception 'O teste deveria ter bloqueado a segunda reserva de miniensaio.';
  exception when others then
    if sqlerrm not like '%Não há vagas suficientes para o miniensaio%' then
      raise;
    end if;
  end;

  v_palco_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Palco","whatsapp":"34977777777","email":"palco@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_palco,
      'nome','Bailarina Palco',
      'turma','Avançado',
      'idade',14
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('e',64),
    gen_random_uuid()::text,
    repeat('f',64)
  );

  if (v_palco_result->>'valor_total_centavos')::integer <> 7900 then
    raise exception 'Preço do pacote de palco não foi validado pelo servidor.';
  end if;
  -- Regressão: contratação de palco não exige nem grava nomes de apresentações.
  if exists (
    select 1 from public.gf_contratacao_coreografias legacy
    join public.gf_contratacao_participantes participante
      on participante.id = legacy.participante_id
    join public.gf_contratacao_pedidos pedido
      on pedido.id = participante.pedido_id
    where pedido.order_nsu = v_palco_result->>'order_nsu'
  ) then
    raise exception 'Uma contratação nova não pode depender de registros legados de palco.';
  end if;

  -- A RPC não aceita valores que não correspondam ao retorno do payment_check.
  begin
    perform public.gf_contratacao_confirmar_pagamento(
      v_palco_result->>'order_nsu',
      'transaction-nsu-test',
      'invoice-slug-test',
      7900,
      7900,
      'pix',
      1,
      '{"success":true,"paid":true,"amount":7800,"paid_amount":7800}'::jsonb
    );
    raise exception 'A confirmação deveria rejeitar valores diferentes do payment_check.';
  exception when others then
    if sqlerrm not like '%não corresponde à resposta validada%' then raise; end if;
  end;

  v_confirm_result := public.gf_contratacao_confirmar_pagamento(
    v_palco_result->>'order_nsu',
    'transaction-nsu-test',
    'invoice-slug-test',
    7900,
    7900,
    'pix',
    1,
    '{"success":true,"paid":true,"amount":7900,"paid_amount":7900}'::jsonb
  );

  if v_confirm_result->>'status' <> 'pago' then
    raise exception 'A confirmação idempotente do pagamento não foi concluída.';
  end if;

  v_duplicate_result := public.gf_contratacao_confirmar_pagamento(
    v_palco_result->>'order_nsu',
    'transaction-nsu-test',
    'invoice-slug-test',
    7900,
    7900,
    'pix',
    1,
    '{"success":true,"paid":true,"amount":7900,"paid_amount":7900}'::jsonb
  );
  if coalesce((v_duplicate_result->>'ja_processado')::boolean,false) is not true then
    raise exception 'A confirmação repetida do mesmo pagamento não foi idempotente.';
  end if;

  v_status_result := public.gf_contratacao_status_por_hash(repeat('e',64));
  if v_status_result->>'status' <> 'pago' then
    raise exception 'A consulta privada do status do pedido pago falhou.';
  end if;

  -- Um webhook de estorno não pode retirar automaticamente o estado pago.
  v_conciliation_result := public.gf_contratacao_marcar_conciliacao(
    v_palco_result->>'order_nsu',
    'transaction-nsu-test',
    'invoice-slug-test',
    '{"success":true,"paid":true,"amount":7900,"paid_amount":7900}'::jsonb,
    'Notificação de estorno recebida; requer conferência administrativa.'
  );
  if coalesce((v_conciliation_result->>'ja_pago')::boolean,false) is not true
    or (select status from public.gf_contratacao_pedidos where id=(v_palco_result->>'pedido_id')::uuid) <> 'pago' then
    raise exception 'A notificação de estorno alterou indevidamente um pedido já pago.';
  end if;

  -- Um valor diferente do total deve ir para conciliação, nunca ser confirmado como pago.
  v_conflict_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Divergência","whatsapp":"34966666666","email":"divergencia@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_palco,
      'nome','Bailarina Divergência',
      'turma','Avançado',
      'idade',15,
      'coreografias',jsonb_build_array(jsonb_build_object('nome','Coreografia Divergência','confirmar_depois',false))
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('7',64),
    gen_random_uuid()::text,
    repeat('8',64)
  );
  v_conciliation_result := public.gf_contratacao_confirmar_pagamento(
    v_conflict_result->>'order_nsu',
    'transaction-nsu-conflict',
    'invoice-slug-conflict',
    7800,
    7800,
    'pix',
    1,
    '{"success":true,"paid":true,"amount":7800,"paid_amount":7800}'::jsonb
  );
  if v_conciliation_result->>'status' <> 'conciliacao_pendente'
    or (select status from public.gf_contratacao_pedidos where id=(v_conflict_result->>'pedido_id')::uuid) <> 'conciliacao_pendente' then
    raise exception 'Pagamento com valor divergente deveria ficar em conciliação.';
  end if;

  -- Não é permitido marcar como reembolsado um pedido que nunca foi pago.
  begin
    perform public.gf_contratacao_marcar_reembolsado(
      v_mini_result->>'order_nsu',
      'Tentativa de estorno de pedido não pago.',
      '11111111-1111-4111-8111-111111111111'
    );
    raise exception 'O teste deveria impedir estorno de pedido não pago.';
  exception when others then
    if sqlerrm not like '%Somente pedidos pagos%' then raise; end if;
  end;

  -- O estorno só é registrado após a confirmação manual; repetir a ação não duplica o estado.
  v_refund_result := public.gf_contratacao_marcar_reembolsado(
    v_palco_result->>'order_nsu',
    'Estorno realizado e conferido na Conta Web InfinitePay.',
    '11111111-1111-4111-8111-111111111111'
  );
  if v_refund_result->>'status' <> 'reembolsado'
    or (select status from public.gf_contratacao_pedidos where id=(v_palco_result->>'pedido_id')::uuid) <> 'reembolsado'
    or (select status from public.gf_contratacao_pagamentos where pedido_id=(v_palco_result->>'pedido_id')::uuid) <> 'refunded' then
    raise exception 'O estorno manual não atualizou pedido e pagamento corretamente.';
  end if;
  v_refund_result := public.gf_contratacao_marcar_reembolsado(
    v_palco_result->>'order_nsu',
    'Estorno realizado e conferido na Conta Web InfinitePay.',
    '11111111-1111-4111-8111-111111111111'
  );
  if coalesce((v_refund_result->>'ja_reembolsado')::boolean,false) is not true then
    raise exception 'Registrar o mesmo estorno duas vezes deve ser idempotente.';
  end if;

  v_status_result := public.gf_contratacao_status_por_hash(repeat('e',64));
  if v_status_result->>'status' <> 'reembolsado' then
    raise exception 'A consulta privada do status do pedido reembolsado falhou.';
  end if;

  -- Uma campanha não pode ser republicada com capacidade menor que
  -- o número de participantes com miniensaio já vendidos/reservados.
  update public.gf_contratacao_eventos
  set capacidade_miniensaios = 2
  where slug = 'entre-estacoes';
  v_mini_two_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Segunda Vaga","whatsapp":"34955555555","email":"segunda.vaga@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_mini,
      'nome','Bailarina Segunda Vaga',
      'turma','Intermediário',
      'idade',12,
      'coreografias','[]'::jsonb
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('1',64),
    gen_random_uuid()::text,
    repeat('2',64)
  );
  if v_mini_two_result->>'status' <> 'aguardando_pagamento' then
    raise exception 'A segunda vaga deveria ser reservada quando a capacidade fosse dois.';
  end if;

  -- A reserva temporária precisa terminar no horário de fechamento das vendas,
  -- mesmo quando a janela padrão de 15 minutos ultrapassaria esse limite.
  update public.gf_contratacao_eventos
  set capacidade_miniensaios = 3,
      vendas_encerram_em = now() + interval '2 minutes'
  where slug = 'entre-estacoes';
  v_mini_three_result := public.gf_contratacao_criar_reserva(
    'entre-estacoes',
    '{"nome":"Responsável Terceira Vaga","whatsapp":"34944444444","email":"terceira.vaga@example.com"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'pacote_id',v_mini,
      'nome','Bailarina Terceira Vaga',
      'turma','Intermediário',
      'idade',13,
      'coreografias','[]'::jsonb
    )),
    '{"responsavel_legal":true,"aceitou_termos":true,"ciente_privacidade":true,"uso_imagem":false}'::jsonb,
    repeat('3',64),
    gen_random_uuid()::text,
    repeat('4',64)
  );
  if (v_mini_three_result->>'reserva_expira_em')::timestamptz >
     (v_mini_three_result->>'vendas_encerram_em')::timestamptz then
    raise exception 'A reserva temporária ultrapassou o encerramento das vendas.';
  end if;

  update public.gf_contratacao_eventos
  set status = 'pausado',
      capacidade_miniensaios = 2
  where slug = 'entre-estacoes';

  begin
    perform public.gf_contratacao_admin_publicar('entre-estacoes');
    raise exception 'A publicação deveria rejeitar uma capacidade menor que as vagas já vendidas ou reservadas.';
  exception when others then
    if sqlerrm not like '%capacidade informada é menor%' then
      raise;
    end if;
  end;

  if (select status from public.gf_contratacao_eventos where slug='entre-estacoes') <> 'pausado' then
    raise exception 'A campanha não deveria ser publicada quando a capacidade é insuficiente.';
  end if;

  -- Uma campanha encerrada é definitiva e não pode ser reaberta pelo botão publicar.
  update public.gf_contratacao_eventos
  set status = 'encerrado',
      capacidade_miniensaios = 2
  where slug = 'entre-estacoes';
  begin
    perform public.gf_contratacao_admin_publicar('entre-estacoes');
    raise exception 'O teste deveria impedir a reabertura de uma campanha encerrada.';
  exception when others then
    if sqlerrm not like '%encerrada e não pode ser reaberta%' then
      raise;
    end if;
  end;
  if (select status from public.gf_contratacao_eventos where slug='entre-estacoes') <> 'encerrado' then
    raise exception 'A campanha encerrada teve o status alterado indevidamente.';
  end if;

  begin
    v_status_transition_result := public.gf_contratacao_admin_alterar_status(
      'entre-estacoes','pausado','11111111-1111-4111-8111-111111111111'
    );
    raise exception 'O teste deveria impedir a transição de encerrado para pausado.';
  exception when others then
    if sqlerrm not like '%encerrada não pode ser reaberta nem pausada%' then
      raise;
    end if;
  end;
  if (select status from public.gf_contratacao_eventos where slug='entre-estacoes') <> 'encerrado' then
    raise exception 'A tentativa de pausar reabriu uma campanha encerrada.';
  end if;
end
$test$;
