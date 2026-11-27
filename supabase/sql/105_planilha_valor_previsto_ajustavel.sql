-- 105: Ajuste controlado do Valor previsto nas respostas de formulário.
-- O Financeiro Geral utiliza exatamente valor_informado_centavos como valor fechado.
-- Não modifica pagamento_situacao, valor_recebido_centavos ou pedidos online.
create or replace function public.gf_contratacao_admin_ajustar_valor_previsto(
  p_campanha_id uuid,
  p_resposta_id uuid,
  p_usuario_id uuid,
  p_valor_anterior_centavos integer,
  p_valor_novo_centavos integer,
  p_motivo text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_resposta public.gf_contratacao_form_respostas%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if p_usuario_id is null or not exists (
    select 1 from public.perfis
    where user_id = p_usuario_id and role = 'super_admin'
  ) then
    raise exception 'Somente o Super Admin pode ajustar o valor previsto.';
  end if;

  if p_valor_novo_centavos is null or p_valor_novo_centavos < 0
     or p_valor_novo_centavos > 100000000 then
    raise exception 'Informe um valor previsto válido, entre R$ 0,00 e R$ 1.000.000,00.';
  end if;
  if char_length(v_motivo) not between 5 and 400 then
    raise exception 'Informe o motivo do ajuste (5 a 400 caracteres).';
  end if;

  select * into v_resposta
  from public.gf_contratacao_form_respostas
  where id = p_resposta_id and evento_contratacao_id = p_campanha_id
  for update;
  if not found then raise exception 'Resposta não localizada nesta campanha.'; end if;
  if v_resposta.arquivado_em is not null then
    raise exception 'Restaure a resposta antes de ajustar o valor previsto.';
  end if;
  if v_resposta.valor_informado_centavos is distinct from p_valor_anterior_centavos then
    raise exception 'O valor previsto foi alterado por outra pessoa. Atualize a planilha e tente novamente.';
  end if;
  if v_resposta.valor_informado_centavos is not distinct from p_valor_novo_centavos then
    return jsonb_build_object('ok', true, 'sem_alteracao', true,
      'resposta_id', v_resposta.id, 'valor_previsto_centavos', p_valor_novo_centavos);
  end if;

  update public.gf_contratacao_form_respostas
  set valor_informado_centavos = p_valor_novo_centavos, atualizado_em = now()
  where id = v_resposta.id and evento_contratacao_id = p_campanha_id;

  insert into public.gf_contratacao_auditoria(
    evento_contratacao_id, usuario_id, acao, detalhes
  ) values (
    p_campanha_id, p_usuario_id, 'valor_previsto_ajustado_planilha',
    jsonb_build_object(
      'resposta_id', v_resposta.id,
      'valor_anterior_centavos', v_resposta.valor_informado_centavos,
      'valor_novo_centavos', p_valor_novo_centavos,
      'valor_recebido_preservado_centavos', v_resposta.valor_recebido_centavos,
      'pagamento_situacao_preservada', v_resposta.pagamento_situacao,
      'motivo', v_motivo
    )
  );

  return jsonb_build_object('ok', true, 'resposta_id', v_resposta.id,
    'valor_anterior_centavos', v_resposta.valor_informado_centavos,
    'valor_previsto_centavos', p_valor_novo_centavos,
    'valor_recebido_centavos', v_resposta.valor_recebido_centavos);
end;
$$;

revoke all on function public.gf_contratacao_admin_ajustar_valor_previsto(
  uuid,uuid,uuid,integer,integer,text
) from public,anon,authenticated;
grant execute on function public.gf_contratacao_admin_ajustar_valor_previsto(
  uuid,uuid,uuid,integer,integer,text
) to service_role;
