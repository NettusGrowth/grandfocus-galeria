
-- 084 - Central de Respostas e Financeiro Grand Focus
-- Cria tabelas auxiliares; NÃO modifica pagamentos automáticos, pedidos ou fotografias.
create table if not exists public.gf_contratacao_form_respostas (
  id uuid primary key default gen_random_uuid(),
  evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id),
  origem_chave text not null,
  origem text not null default 'google_forms' check (origem in ('google_forms')),
  origem_linha integer not null check (origem_linha > 0),
  respondido_em timestamptz,
  responsavel_nome text not null check (char_length(responsavel_nome) between 2 and 180),
  responsavel_whatsapp text not null default '',
  bailarina_nome text not null check (char_length(bailarina_nome) between 2 and 180),
  modalidade_original text,
  experiencia_original text not null,
  valor_informado_centavos integer check (valor_informado_centavos between 0 and 100000000),
  pagamento_preferido text,
  responsavel_confirmou boolean not null default false,
  condicoes_confirmadas boolean not null default false,
  observacao_origem text,
  pagamento_situacao text not null default 'nao_conferido'
    check (pagamento_situacao in ('nao_conferido','pendente','parcial','pago_manual','cancelado')),
  valor_recebido_centavos integer not null default 0 check (valor_recebido_centavos >= 0),
  pagamento_metodo text,
  pagamento_referencia text,
  pagamento_observacao text,
  pagamento_conferido_em timestamptz,
  pagamento_conferido_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint gf_form_respostas_chave unique(evento_contratacao_id, origem_chave),
  constraint gf_form_respostas_recebido_valido check
    ((pagamento_situacao in ('nao_conferido','pendente','cancelado') and valor_recebido_centavos = 0)
     or (pagamento_situacao in ('parcial','pago_manual') and valor_recebido_centavos > 0)),
  constraint gf_form_respostas_conferencia_valida check
    ((pagamento_situacao in ('nao_conferido','pendente','cancelado') and pagamento_conferido_em is null)
     or (pagamento_situacao in ('parcial','pago_manual')
         and pagamento_conferido_em is not null
         and pagamento_conferido_por is not null
         and pagamento_referencia is not null))
);
create index if not exists gf_form_respostas_campanha_data
  on public.gf_contratacao_form_respostas (evento_contratacao_id, respondido_em desc);
create index if not exists gf_form_respostas_status
  on public.gf_contratacao_form_respostas (evento_contratacao_id, pagamento_situacao);

create table if not exists public.gf_contratacao_acompanhamentos (
  id uuid primary key default gen_random_uuid(),
  evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id),
  pedido_id uuid unique references public.gf_contratacao_pedidos(id),
  resposta_form_id uuid unique references public.gf_contratacao_form_respostas(id),
  situacao text not null default 'nao_iniciado'
    check (situacao in ('nao_iniciado','contatar','aguardando_resposta','concluido','nao_precisa')),
  proximo_contato_em date,
  ultimo_contato_em timestamptz,
  observacoes text,
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  constraint gf_acompanhamentos_exatamente_uma_origem
    check ((pedido_id is not null) <> (resposta_form_id is not null))
);
create index if not exists gf_acompanhamentos_campanha_follow
  on public.gf_contratacao_acompanhamentos (evento_contratacao_id, proximo_contato_em);

alter table public.gf_contratacao_form_respostas enable row level security;
alter table public.gf_contratacao_acompanhamentos enable row level security;
revoke all on table public.gf_contratacao_form_respostas, public.gf_contratacao_acompanhamentos from public, anon, authenticated;
grant select, insert, update on table public.gf_contratacao_form_respostas, public.gf_contratacao_acompanhamentos to service_role;
-- Não criar políticas públicas: acesso apenas via função administrativa autenticada.

create or replace function public.gf_contratacao_admin_salvar_acompanhamento(
  p_campanha_id uuid,
  p_origem text,
  p_referencia_id uuid,
  p_situacao text,
  p_proximo_contato_em date,
  p_observacoes text,
  p_registrar_contato boolean,
  p_usuario_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_valido boolean;
  v_registro uuid;
  v_pedido uuid;
  v_ultimo timestamptz;
begin
  if p_situacao not in ('nao_iniciado','contatar','aguardando_resposta','concluido','nao_precisa')
     or length(coalesce(p_observacoes,'')) > 3000
     or p_origem not in ('online','formulario') then
    raise exception 'Acompanhamento inválido.';
  end if;
  if p_usuario_id is null or not exists (select 1 from auth.users where id=p_usuario_id) then
    raise exception 'Administrador não encontrado.';
  end if;
  if p_origem='online' then
    select exists(
      select 1 from public.gf_contratacao_pedidos
      where id=p_referencia_id and evento_contratacao_id=p_campanha_id
    ) into v_valido;
  else
    select exists(
      select 1 from public.gf_contratacao_form_respostas
      where id=p_referencia_id and evento_contratacao_id=p_campanha_id
    ) into v_valido;
  end if;
  if not v_valido then raise exception 'Registro não encontrado nesta campanha.'; end if;
  v_ultimo := case when p_registrar_contato then now() else null end;
  if p_origem='online' then
    v_pedido := p_referencia_id;
    insert into public.gf_contratacao_acompanhamentos
      (evento_contratacao_id,pedido_id,situacao,proximo_contato_em,observacoes,ultimo_contato_em,atualizado_por)
    values (p_campanha_id,p_referencia_id,p_situacao,p_proximo_contato_em,nullif(btrim(p_observacoes),''),v_ultimo,p_usuario_id)
    on conflict (pedido_id) do update set
      situacao=excluded.situacao,
      proximo_contato_em=excluded.proximo_contato_em,
      observacoes=excluded.observacoes,
      ultimo_contato_em=coalesce(excluded.ultimo_contato_em,public.gf_contratacao_acompanhamentos.ultimo_contato_em),
      atualizado_por=excluded.atualizado_por,
      atualizado_em=now()
    returning id into v_registro;
  else
    insert into public.gf_contratacao_acompanhamentos
      (evento_contratacao_id,resposta_form_id,situacao,proximo_contato_em,observacoes,ultimo_contato_em,atualizado_por)
    values (p_campanha_id,p_referencia_id,p_situacao,p_proximo_contato_em,nullif(btrim(p_observacoes),''),v_ultimo,p_usuario_id)
    on conflict (resposta_form_id) do update set
      situacao=excluded.situacao,
      proximo_contato_em=excluded.proximo_contato_em,
      observacoes=excluded.observacoes,
      ultimo_contato_em=coalesce(excluded.ultimo_contato_em,public.gf_contratacao_acompanhamentos.ultimo_contato_em),
      atualizado_por=excluded.atualizado_por,
      atualizado_em=now()
    returning id into v_registro;
  end if;
  insert into public.gf_contratacao_auditoria(evento_contratacao_id,pedido_id,usuario_id,acao,detalhes)
    values (p_campanha_id,v_pedido,p_usuario_id,'acompanhamento_atualizado',
      jsonb_build_object('origem',p_origem,'referencia_id',p_referencia_id,
        'situacao',p_situacao,'proximo_contato_em',p_proximo_contato_em,
        'contato_realizado',coalesce(p_registrar_contato,false)));
  return jsonb_build_object('ok',true,'id',v_registro);
end $$;

create or replace function public.gf_contratacao_admin_registrar_pagamento_externo(
  p_campanha_id uuid,
  p_resposta_id uuid,
  p_situacao text,
  p_valor_recebido_centavos integer,
  p_metodo text,
  p_referencia text,
  p_observacao text,
  p_conferencia_confirmada boolean,
  p_usuario_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_antigo public.gf_contratacao_form_respostas%rowtype;
  v_pago boolean;
begin
  select * into v_antigo
  from public.gf_contratacao_form_respostas
  where id=p_resposta_id and evento_contratacao_id=p_campanha_id
  for update;
  if not found then raise exception 'Resposta não encontrada nesta campanha.'; end if;
  if p_usuario_id is null or not exists (select 1 from auth.users where id=p_usuario_id) then
    raise exception 'Administrador não encontrado.';
  end if;
  if p_situacao not in ('nao_conferido','pendente','parcial','pago_manual','cancelado')
    or p_valor_recebido_centavos is null or p_valor_recebido_centavos < 0
    or p_valor_recebido_centavos > 100000000 or length(coalesce(p_observacao,'')) > 1200 then
      raise exception 'Dados do pagamento inválidos.';
  end if;
  v_pago := p_situacao in ('parcial','pago_manual');
  if v_pago then
    if p_conferencia_confirmada is distinct from true then
      raise exception 'Confirme que você conferiu o recebimento antes de registrar.';
    end if;
    if p_valor_recebido_centavos <= 0
       or p_metodo not in ('pix','credito','dinheiro','outro')
       or length(btrim(coalesce(p_referencia,''))) < 5
       or length(p_referencia) > 180 then
      raise exception 'Informe valor recebido, meio e referência da comprovação.';
    end if;
    if p_situacao='pago_manual' and
       (v_antigo.valor_informado_centavos is null or
        p_valor_recebido_centavos < v_antigo.valor_informado_centavos) then
      raise exception 'Para pago, o valor recebido deve cobrir o valor informado.';
    end if;
    if p_situacao='parcial' and
       (v_antigo.valor_informado_centavos is null or
        p_valor_recebido_centavos >= v_antigo.valor_informado_centavos) then
      raise exception 'O valor parcial deve ser menor que o valor informado.';
    end if;
  else
    if p_valor_recebido_centavos <> 0 then
      raise exception 'Sem confirmação de recebimento, o valor recebido deve ser zero.';
    end if;
    if v_antigo.valor_recebido_centavos > 0 and length(btrim(coalesce(p_observacao,''))) < 10 then
      raise exception 'Explique a correção do registro de recebimento no campo observação.';
    end if;
  end if;
  update public.gf_contratacao_form_respostas set
    pagamento_situacao=p_situacao,
    valor_recebido_centavos=p_valor_recebido_centavos,
    pagamento_metodo=case when v_pago then p_metodo else null end,
    pagamento_referencia=case when v_pago then btrim(p_referencia) else null end,
    pagamento_observacao=nullif(btrim(coalesce(p_observacao,'')),''),
    pagamento_conferido_em=case when v_pago then now() else null end,
    pagamento_conferido_por=case when v_pago then p_usuario_id else null end,
    atualizado_em=now()
  where id=p_resposta_id;
  insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
  values(p_campanha_id,p_usuario_id,'pagamento_externo_conferido_manual',
    jsonb_build_object('resposta_id',p_resposta_id,'situacao_anterior',v_antigo.pagamento_situacao,
      'situacao_nova',p_situacao,'valor_recebido_anterior',v_antigo.valor_recebido_centavos,
      'valor_recebido_novo',p_valor_recebido_centavos,'meio',case when v_pago then p_metodo else null end,
      'referencia',case when v_pago then p_referencia else null end));
  return jsonb_build_object('ok',true,'situacao',p_situacao);
end $$;

revoke all on function public.gf_contratacao_admin_salvar_acompanhamento(uuid,text,uuid,text,date,text,boolean,uuid)
  from public, anon, authenticated;
revoke all on function public.gf_contratacao_admin_registrar_pagamento_externo(uuid,uuid,text,integer,text,text,text,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.gf_contratacao_admin_salvar_acompanhamento(uuid,text,uuid,text,date,text,boolean,uuid) to service_role;
grant execute on function public.gf_contratacao_admin_registrar_pagamento_externo(uuid,uuid,text,integer,text,text,text,boolean,uuid) to service_role;
