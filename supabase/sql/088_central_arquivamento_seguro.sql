-- 088: Arquivamento reversível de respostas/testes, sem EXCLUSÃO de registros financeiros.
-- Apenas admins autenticados via Edge Function e perfil no banco podem executar.
-- Pagamentos confirmados/parciais e pedidos em conciliação nunca podem ser ocultados.
alter table public.gf_contratacao_form_respostas
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por uuid;
alter table public.gf_contratacao_pedidos
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por uuid;

create index if not exists gf_contratacao_form_respostas_arquivadas_idx
  on public.gf_contratacao_form_respostas (evento_contratacao_id,arquivado_em);
create index if not exists gf_contratacao_pedidos_arquivados_idx
  on public.gf_contratacao_pedidos (evento_contratacao_id,arquivado_em);

create or replace function public.gf_contratacao_admin_arquivar_registro(
  p_campanha_id uuid,
  p_origem text,
  p_referencia_id uuid,
  p_arquivar boolean,
  p_usuario_id uuid
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_form public.gf_contratacao_form_respostas%rowtype;
  v_pedido public.gf_contratacao_pedidos%rowtype;
begin
  if p_origem not in ('formulario','online')
    or p_referencia_id is null or p_campanha_id is null
    or p_arquivar is null or p_usuario_id is null then
    raise exception 'Dados de arquivamento inválidos.';
  end if;
  if not exists (
    select 1 from public.perfis
    where user_id=p_usuario_id and role in ('admin','super_admin')
  ) then
    raise exception 'Somente administradores podem arquivar registros.';
  end if;
  if p_origem='formulario' then
    select * into v_form from public.gf_contratacao_form_respostas
     where evento_contratacao_id=p_campanha_id and id=p_referencia_id for update;
    if not found then raise exception 'Resposta não encontrada nesta campanha.'; end if;
    if coalesce(v_form.valor_recebido_centavos,0)<>0
       or v_form.pagamento_conferido_em is not null
       or v_form.pagamento_situacao not in ('nao_conferido','pendente','cancelado') then
      raise exception 'Este registro tem histórico financeiro. Não é permitido arquivá-lo.';
    end if;
    if p_arquivar and v_form.arquivado_em is not null then
      return jsonb_build_object('ok',true,'arquivado',true,'sem_alteracao',true);
    end if;
    if not p_arquivar and v_form.arquivado_em is null then
      return jsonb_build_object('ok',true,'arquivado',false,'sem_alteracao',true);
    end if;
    update public.gf_contratacao_form_respostas set
      arquivado_em=case when p_arquivar then now() else null end,
      arquivado_por=case when p_arquivar then p_usuario_id else null end,
      atualizado_em=now()
    where id=p_referencia_id and evento_contratacao_id=p_campanha_id;
  else
    select * into v_pedido from public.gf_contratacao_pedidos
     where evento_contratacao_id=p_campanha_id and id=p_referencia_id for update;
    if not found then raise exception 'Pedido não encontrado nesta campanha.'; end if;
    if coalesce(v_pedido.valor_pago_centavos,0)<>0
       or v_pedido.pagamento_confirmado_em is not null
       or v_pedido.status not in ('aguardando_pagamento','pagamento_pendente','expirado','cancelado') then
      raise exception 'Este pedido tem pagamento ou conciliação. Não é permitido arquivá-lo.';
    end if;
    if p_arquivar and v_pedido.arquivado_em is not null then
      return jsonb_build_object('ok',true,'arquivado',true,'sem_alteracao',true);
    end if;
    if not p_arquivar and v_pedido.arquivado_em is null then
      return jsonb_build_object('ok',true,'arquivado',false,'sem_alteracao',true);
    end if;
    update public.gf_contratacao_pedidos set
      arquivado_em=case when p_arquivar then now() else null end,
      arquivado_por=case when p_arquivar then p_usuario_id else null end
    where id=p_referencia_id and evento_contratacao_id=p_campanha_id;
  end if;

  insert into public.gf_contratacao_auditoria
    (evento_contratacao_id,pedido_id,usuario_id,acao,detalhes)
  values
    (p_campanha_id,
     case when p_origem='online' then p_referencia_id else null end,
     p_usuario_id,
     case when p_arquivar then 'registro_arquivado' else 'registro_restaurado' end,
     jsonb_build_object('origem',p_origem,'referencia_id',p_referencia_id,
                        'arquivado',p_arquivar));
  return jsonb_build_object('ok',true,'arquivado',p_arquivar);
end;
$$;

revoke all on function public.gf_contratacao_admin_arquivar_registro(uuid,text,uuid,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_contratacao_admin_arquivar_registro(uuid,text,uuid,boolean,uuid)
 to service_role;
