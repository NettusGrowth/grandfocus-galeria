-- Grand Focus | Gerenciador reutilizável de contratações
-- Cria o evento da galeria e a campanha de contratação na mesma transação.
-- Permite experiências configuráveis sem alterar pedidos históricos.

begin;

alter table public.gf_contratacao_pacotes
  drop constraint if exists gf_contratacao_pacotes_codigo_check;

alter table public.gf_contratacao_pacotes
  add constraint gf_contratacao_pacotes_codigo_check
  check (
    codigo ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(codigo) between 2 and 60
  );

create or replace function public.gf_contratacao_admin_criar_campanha(
  p_nome_evento text,
  p_data_evento date,
  p_escola_id uuid,
  p_slug text,
  p_usuario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_evento_id uuid;
  v_contratacao_id uuid;
  v_nome text := btrim(coalesce(p_nome_evento,''));
  v_slug text := lower(btrim(coalesce(p_slug,'')));
begin
  if p_usuario_id is null then
    raise exception 'Sessão administrativa inválida.';
  end if;
  if length(v_nome) not between 3 and 120 then
    raise exception 'Informe um nome de evento entre 3 e 120 caracteres.';
  end if;
  if p_data_evento is null then
    raise exception 'Informe a data do evento.';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or length(v_slug) not between 3 and 60
    or v_slug = 'admin' then
    raise exception 'O endereço da contratação precisa usar letras minúsculas, números e hífens, sem espaços.';
  end if;
  if p_escola_id is null or not exists (
    select 1 from public.escolas where id = p_escola_id
  ) then
    raise exception 'Selecione uma escola cadastrada na galeria.';
  end if;
  if exists (select 1 from public.gf_contratacao_eventos where slug = v_slug) then
    raise exception 'Este endereço já está sendo usado por outra contratação. Escolha outro.';
  end if;

  -- O evento da galeria e a contratação são criados juntos.
  -- Se qualquer etapa falhar, o PostgreSQL desfaz as duas inserções.
  insert into public.eventos (nome, data, escola_id)
  values (v_nome, p_data_evento, p_escola_id)
  returning id into v_evento_id;

  insert into public.gf_contratacao_eventos (
    evento_id, escola_id, slug, nome_publico, status, data_evento
  )
  values (
    v_evento_id, p_escola_id, v_slug, v_nome, 'rascunho', p_data_evento
  )
  returning id into v_contratacao_id;

  insert into public.gf_contratacao_auditoria (
    evento_contratacao_id, usuario_id, acao, detalhes
  )
  values (
    v_contratacao_id, p_usuario_id, 'campanha_criada_com_evento',
    jsonb_build_object('evento_id',v_evento_id,'escola_id',p_escola_id,'slug',v_slug)
  );

  return jsonb_build_object(
    'evento_id',v_evento_id,
    'evento_contratacao_id',v_contratacao_id,
    'slug',v_slug,
    'nome_publico',v_nome,
    'status','rascunho'
  );
end;
$$;

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
    v_minimo := coalesce(nullif(v_item->>'minimo_fotos_por_coreografia','')::integer,0);
    v_ordem := coalesce(nullif(v_item->>'ordem','')::integer,v_count);

    if v_preco is null or v_preco not between 100 and 100000000 then
      raise exception 'O valor de cada experiência deve ficar entre R$ 1,00 e R$ 1.000.000,00.';
    end if;
    if v_minimo < 0 or v_minimo > 1000 then
      raise exception 'O mínimo de fotografias por coreografia é inválido.';
    end if;
    if v_inclui_palco and v_minimo < 10 then
      raise exception 'Experiências com fotos de palco precisam manter o mínimo de 10 fotos por coreografia.';
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
      or v_existing.minimo_fotos_por_coreografia is distinct from v_minimo
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

revoke all on function public.gf_contratacao_admin_criar_campanha(text,date,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.gf_contratacao_admin_criar_campanha(text,date,uuid,text,uuid) to service_role;
revoke all on function public.gf_contratacao_admin_salvar_config(text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.gf_contratacao_admin_salvar_config(text,jsonb,jsonb,uuid) to service_role;

commit;
