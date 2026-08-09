-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 11: checkout automático via InfinitePay
-- na Seleção de Fotos. Hoje a liberação é 100% manual: o cliente paga
-- por fora (PIX estático) e o admin confere o extrato e clica
-- "Confirmar Pagamento" (selecao_liberar_pedido, 025). Isso continua
-- existindo intacto — essa migration só ADICIONA um segundo caminho:
-- quando o estúdio tiver `infinitepay_handle` configurado, o cliente
-- pode pagar direto e a liberação acontece sozinha via webhook.
--
-- A API da InfinitePay não documenta verificação por assinatura no
-- webhook — por isso a liberação automática NUNCA confia só no corpo
-- do webhook: a Edge Function selecao-webhook sempre reconfirma
-- chamando `payment_check` da própria InfinitePay antes de chamar a RPC
-- abaixo. Rodar depois de 001 a 038. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_config add column if not exists infinitepay_handle text;
alter table selecao_pedidos add column if not exists transaction_nsu text;
alter table selecao_pedidos add column if not exists pago_automaticamente boolean not null default false;
-- idempotência: o webhook da InfinitePay pode chegar mais de uma vez
-- (retry deles se não respondermos rápido) pro MESMO pagamento — sem
-- unique, um retry processaria e liberaria/auditaria duas vezes.
create unique index if not exists idx_selecao_pedidos_transaction_nsu on selecao_pedidos(transaction_nsu) where transaction_nsu is not null;

create or replace function selecao_publica_dados(p_token text, p_senha text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_gal record;
  v_pedido record;
  v_fotos json;
  v_pix record;
begin
  select * into v_gal from selecao_galerias where token = p_token;
  if v_gal.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if v_gal.senha_hash is not null and (p_senha is null or crypt(p_senha, v_gal.senha_hash) <> v_gal.senha_hash) then
    raise exception 'Senha incorreta.';
  end if;
  if v_gal.status = 'expirada' or (v_gal.expira_em is not null and v_gal.expira_em < now()) then
    raise exception 'Esta galeria de seleção expirou em %. Entre em contato com o estúdio para reativar o acesso.', to_char(v_gal.expira_em, 'DD/MM/YYYY');
  end if;

  select json_agg(json_build_object('id', id, 'storage_path', storage_path, 'ordem', ordem) order by ordem)
  into v_fotos from selecao_fotos where galeria_id = v_gal.id;

  select * into v_pedido from selecao_pedidos where galeria_id = v_gal.id;
  select * into v_pix from selecao_config where id = true;

  return json_build_object(
    'galeria', json_build_object(
      'id', v_gal.id, 'titulo', v_gal.titulo, 'cliente_nome', v_gal.cliente_nome,
      'qtd_incluida', v_gal.qtd_incluida, 'preco_extra', v_gal.preco_extra,
      'faixas_preco', v_gal.faixas_preco, 'status', v_gal.status
    ),
    'fotos', coalesce(v_fotos, '[]'::json),
    'pedido', case when v_pedido.id is null then null else json_build_object(
      'id', v_pedido.id, 'foto_ids', v_pedido.foto_ids, 'status', v_pedido.status, 'valor_total', v_pedido.valor_total,
      'qtd_extra', v_pedido.qtd_extra, 'observacoes', v_pedido.observacoes
    ) end,
    'pix', json_build_object('chave', v_pix.pix_chave, 'nome', v_pix.pix_nome, 'qrcode_url', v_pix.pix_qrcode_url),
    -- só um booleano — o handle em si nunca sai do banco pro client,
    -- só a Edge Function (service role) lê ele de verdade.
    'pagamento_automatico', (v_pix.infinitepay_handle is not null and v_pix.infinitepay_handle <> '')
  );
end;
$$;

-- chamada só pela Edge Function selecao-webhook (service role), depois
-- dela já ter reconfirmado o pagamento chamando payment_check da
-- InfinitePay -- nunca é exposta pro client (sem grant a anon/authenticated).
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
    transaction_nsu = p_transaction_nsu, pago_automaticamente = true
  where id = v_pedido.id;

  update selecao_galerias set status = 'concluida' where id = p_galeria_id;

  insert into auditoria (user_id, user_nome, acao, tabela, registro_id, detalhe)
  values (null, 'InfinitePay (automático)', 'liberou pagamento automaticamente — R$ ' || to_char(p_valor_pago, 'FM999999990.00'), 'selecao_galerias', p_galeria_id, coalesce(v_galeria.titulo, ''));

  return json_build_object('ok', true);
end;
$$;
grant execute on function selecao_liberar_pedido_automatico(uuid, text, numeric) to service_role;
