
-- 087: Editor de perguntas e identidade visual por campanha, com respostas versionadas.
-- Não altera status de pagamento, arquivos, fotos ou pedidos já existentes.
alter table public.gf_contratacao_eventos
 add column if not exists formulario_modelo jsonb not null default
 '{"aparencia":{"cor":"#4B0416","fundo":"#F1EDF1","titulo":"","introducao":""},"perguntas":[]}'::jsonb,
 add column if not exists formulario_versao integer not null default 1;
alter table public.gf_contratacao_eventos
 add constraint gf_formulario_modelo_objeto_check check (jsonb_typeof(formulario_modelo)='object');
alter table public.gf_contratacao_pedidos
 add column if not exists formulario_respostas jsonb not null default '{}'::jsonb,
 add column if not exists formulario_modelo_snapshot jsonb not null default '{}'::jsonb;

-- Somente backend (service_role) pode salvar modelos. Nunca público.
create or replace function public.gf_contratacao_admin_salvar_formulario(
 p_slug text,p_modelo jsonb,p_versao_esperada integer,p_usuario_id uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 v_evento public.gf_contratacao_eventos%rowtype;
 v_nova_versao integer;
begin
 if jsonb_typeof(p_modelo) <> 'object'
   or jsonb_typeof(p_modelo->'perguntas') <> 'array'
   or jsonb_array_length(p_modelo->'perguntas') > 30
   or jsonb_typeof(p_modelo->'aparencia') <> 'object'
   or pg_catalog.length(p_modelo::text)>28000 then
    raise exception 'Modelo do formulário inválido.';
 end if;
 if not exists (
    select 1 from public.perfis where user_id=p_usuario_id
      and role in ('admin','super_admin')
 ) then raise exception 'Somente administradores podem editar perguntas.'; end if;
 select * into v_evento from public.gf_contratacao_eventos
 where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 if v_evento.status='publicado' then
   raise exception 'Pause a campanha antes de alterar perguntas.';
 end if;
 if v_evento.formulario_versao <> p_versao_esperada then
   raise exception 'As perguntas mudaram desde que você abriu o editor. Recarregue antes de salvar.';
 end if;
 update public.gf_contratacao_eventos
   set formulario_modelo=p_modelo, formulario_versao=formulario_versao+1,
       atualizado_em=now()
 where id=v_evento.id
 returning formulario_versao into v_nova_versao;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_evento.id,p_usuario_id,'formulario_editado',
   jsonb_build_object('versao_anterior',p_versao_esperada,'versao_nova',v_nova_versao,
     'quantidade_perguntas',jsonb_array_length(p_modelo->'perguntas')));
 return jsonb_build_object('ok',true,'versao',v_nova_versao);
end;
$$;
revoke all on function public.gf_contratacao_admin_salvar_formulario(text,jsonb,integer,uuid)
 from public, anon, authenticated;
grant execute on function public.gf_contratacao_admin_salvar_formulario(text,jsonb,integer,uuid) to service_role;

-- Novos pedidos registram o modelo e as respostas apresentados no momento do aceite.
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
  v_form jsonb;
  v_answers jsonb;
  v_question jsonb;
  v_answer jsonb;
  v_choices jsonb;
  v_condition jsonb;
  v_show boolean;
  v_qid text;
  v_qtype text;
  v_value text;
  v_choice text;
  v_key text;
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


  -- Guardar respostas EXATAMENTE com a versão visualizada; mudanças feitas depois
  -- não reescrevem pedidos anteriores. Respostas são validadas novamente no banco.
  v_form := coalesce(v_evento.formulario_modelo,'{"perguntas":[]}'::jsonb);
  if p_aceite ? 'formulario' then
    if jsonb_typeof(p_aceite->'formulario') is distinct from 'object'
      or coalesce((p_aceite->'formulario'->>'versao')::integer,0) <> v_evento.formulario_versao then
      raise exception 'As perguntas do formulário foram atualizadas. Recarregue a página antes de contratar.';
    end if;
  elsif jsonb_array_length(coalesce(v_form->'perguntas','[]'::jsonb)) > 0 then
    raise exception 'Este evento exige respostas adicionais. Atualize o formulário.';
  end if;
  v_answers := coalesce(p_aceite->'formulario'->'respostas','{}'::jsonb);
  if jsonb_typeof(v_answers) is distinct from 'object' then
    raise exception 'As respostas adicionais estão em formato inválido.';
  end if;
  for v_key in select jsonb_object_keys(v_answers) loop
    if not exists (
      select 1 from jsonb_array_elements(v_form->'perguntas') q
      where q->>'id'=v_key
    ) then
      raise exception 'Uma resposta não corresponde às perguntas desta campanha.';
    end if;
  end loop;
  for v_question in select value from jsonb_array_elements(v_form->'perguntas') loop
    v_qid := v_question->>'id';
    v_qtype := v_question->>'tipo';
    v_answer := v_answers->v_qid;
    v_condition := v_question->'condicao';
    v_show := true;
    if jsonb_typeof(v_condition)='object' and coalesce(v_condition->>'pergunta_id','')<>'' then
      v_show := coalesce(v_answers->>(v_condition->>'pergunta_id'),'') = coalesce(v_condition->>'valor','');
    end if;
    if not v_show then
      if v_answers ? v_qid then
        raise exception 'Há uma resposta enviada para uma pergunta que não deveria aparecer.';
      end if;
      continue;
    end if;
    if v_answer is null or v_answer='null'::jsonb
       or (jsonb_typeof(v_answer)='string' and btrim(v_answer #>> '{}')='')
       or (jsonb_typeof(v_answer)='array' and jsonb_array_length(v_answer)=0) then
      if coalesce((v_question->>'obrigatoria')::boolean,false) then
        raise exception 'Responda à pergunta obrigatória: %',v_question->>'titulo';
      end if;
      continue;
    end if;
    if v_qtype='multipla' then
      if jsonb_typeof(v_answer) is distinct from 'array' or jsonb_array_length(v_answer)>12 then
        raise exception 'Resposta de múltipla seleção inválida.';
      end if;
      v_choices := coalesce(v_question->'opcoes','[]'::jsonb);
      for v_choice in select value #>> '{}' from jsonb_array_elements(v_answer) loop
        if length(v_choice)>160 or not v_choices ? v_choice then
          raise exception 'Uma das alternativas escolhidas não existe.';
        end if;
      end loop;
    else
      if jsonb_typeof(v_answer) is distinct from 'string' then
        raise exception 'A resposta da pergunta % deve ser um texto.',v_question->>'titulo';
      end if;
      v_value := v_answer #>> '{}';
      if length(v_value)>1000 then raise exception 'Resposta maior que o permitido.'; end if;
      if v_qtype in ('unica','lista','sim_nao') then
        v_choices := case when v_qtype='sim_nao' then '["Sim","Não"]'::jsonb
           else coalesce(v_question->'opcoes','[]'::jsonb) end;
        if not v_choices ? v_value then raise exception 'Alternativa inválida.'; end if;
      elsif v_qtype='email' then
        if v_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}
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
    idempotency_key,request_hash,acesso_publico_hash,formulario_respostas,formulario_modelo_snapshot
  ) values (
    v_pedido_id,v_evento.id,btrim(p_responsavel->>'nome'),v_telefone,
    lower(btrim(p_responsavel->>'email')),v_total,'aguardando_pagamento',
    case when v_tem_mini then 'ativa' else 'nao_aplicavel' end,
    v_expira,v_order_nsu,p_idempotency_key,p_request_hash,p_acesso_hash,v_answers,
    jsonb_build_object('versao',v_evento.formulario_versao,'modelo',v_form)
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
$$; then raise exception 'E-mail de resposta adicional inválido.';end if;
      elsif v_qtype='telefone' then
        if length(regexp_replace(v_value,'\D','','g')) not between 10 and 13 then raise exception 'Telefone adicional inválido.';end if;
      elsif v_qtype='numero' then
        if v_value !~ '^-?[0-9]{1,12}(\.[0-9]{1,4})?
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
$$; then raise exception 'Número adicional inválido.';end if;
      elsif v_qtype='data' then
        if v_value !~ '^\d{4}-\d{2}-\d{2}
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
$$; then raise exception 'Data adicional inválida.';end if;
      elsif v_qtype not in ('texto','paragrafo') then
        raise exception 'Tipo de pergunta não suportado.';
      end if;
    end if;
  end loop;

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
