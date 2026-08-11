-- Bloco 16 (2/12) — persistir o valor realmente pago + trilha de
-- auditoria de todo evento de webhook da InfinitePay.
--
-- Rodar isso inteiro no SQL Editor do Supabase. Depois, redeploy manual
-- da Edge Function selecao-webhook (não é publicado por git push).

-- selecao_liberar_pedido_automatico() já recebia p_valor_pago mas só
-- usava pra validar e jogava fora — agora grava na coluna nova
-- (046_gold_reserve_schema.sql). Resto da função idêntico.
create or replace function selecao_liberar_pedido_automatico(p_galeria_id uuid, p_transaction_nsu text, p_valor_pago numeric)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_pedido record;
  v_galeria record;
begin
  select * into v_pedido from selecao_pedidos where galeria_id = p_galeria_id;
  if v_pedido.id is null then raise exception 'Pedido não encontrado pra essa galeria.'; end if;
  select * into v_galeria from selecao_galerias where id = p_galeria_id;

  -- idempotência: retry do webhook pro mesmo pagamento vira no-op.
  if v_pedido.status = 'liberado' and v_pedido.transaction_nsu = p_transaction_nsu then
    return json_build_object('ja_processado', true);
  end if;

  if p_valor_pago < v_pedido.valor_total then
    raise exception 'Valor pago (%) menor que o valor do pedido (%).', p_valor_pago, v_pedido.valor_total;
  end if;

  update selecao_pedidos set
    status = 'liberado', liberado_em = now(), liberado_por = null,
    transaction_nsu = p_transaction_nsu, pago_automaticamente = true,
    valor_pago = p_valor_pago
  where id = v_pedido.id;

  update selecao_galerias set status = 'concluida' where id = p_galeria_id;

  insert into auditoria (user_id, user_nome, acao, tabela, registro_id, detalhe)
  values (null, 'InfinitePay (automático)', 'liberou pagamento automaticamente — R$ ' || to_char(p_valor_pago, 'FM999999990.00'), 'selecao_galerias', p_galeria_id, coalesce(v_galeria.titulo, ''));

  return json_build_object('ok', true);
end;
$$;
grant execute on function selecao_liberar_pedido_automatico(uuid, text, numeric) to service_role;

-- registra CADA chamada de webhook recebida (confirmada ou não) — hoje
-- isso só existe em log efêmero do Supabase. security definer pelo
-- mesmo motivo documentado em selecao-webhook/index.ts: um insert
-- direto de service_role já falhou nesse projeto com "permission
-- denied" mesmo devendo bypassar RLS; RPC não tem essa dependência.
-- p_pedido_id pode ser null (ex: order_nsu não bateu com pedido nenhum).
create or replace function gr_log_webhook_evento(
  p_pedido_id uuid, p_order_nsu text, p_transaction_nsu text,
  p_payload jsonb, p_check jsonb, p_resultado text, p_mensagem text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  insert into gr_webhook_events (pedido_id, order_nsu, transaction_nsu, payload_recebido, payment_check_resultado, resultado, mensagem)
  values (p_pedido_id, p_order_nsu, p_transaction_nsu, p_payload, p_check, p_resultado, p_mensagem);
end;
$$;
-- só a Edge Function chama isso — nunca exposto ao client.
grant execute on function gr_log_webhook_evento(uuid, text, text, jsonb, jsonb, text, text) to service_role;
