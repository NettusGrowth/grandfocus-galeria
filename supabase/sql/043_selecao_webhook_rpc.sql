-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 11: fix real do webhook automático não
-- liberando pedidos pagos. Log de produção mostrou exatamente o
-- problema: "permission denied for table selecao_pedidos" — a Edge
-- Function selecao-webhook lia a tabela direto via
-- admin.from('selecao_pedidos')..., e esse SELECT raso (não é RPC)
-- depende de GRANT explícito pro role que está de fato conectando.
-- Todo resto do projeto (selecao-publica, galeria-publica) sempre leu
-- dado público via RPC SECURITY DEFINER de propósito — é o único jeito
-- que funciona de forma confiável nesse projeto (o dono da função
-- decide o acesso, não depende de qual client key a Edge Function
-- conseguiu montar em runtime). selecao-webhook foi a única exceção,
-- por isso foi a única que quebrou.
--
-- Essa migration junta as duas leituras que o webhook precisa (pedido
-- + handle) numa RPC só, granted só pra service_role. Rodar depois de
-- 001 a 042. Aditiva.
-- ════════════════════════════════════════════════════════════════

create or replace function selecao_webhook_dados(p_pedido_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_pedido record;
  v_handle text;
begin
  select id, galeria_id, valor_total into v_pedido from selecao_pedidos where id = p_pedido_id;
  if v_pedido.id is null then return null; end if;
  select infinitepay_handle into v_handle from selecao_config where id = true;
  return json_build_object('galeria_id', v_pedido.galeria_id, 'valor_total', v_pedido.valor_total, 'infinitepay_handle', v_handle);
end;
$$;
revoke all on function selecao_webhook_dados(uuid) from public;
grant execute on function selecao_webhook_dados(uuid) to service_role;

-- hardening: essa trava já devia existir desde a 039 (funções novas em
-- Postgres saem executáveis por PUBLIC por padrão, a menos que alguém
-- revogue explicitamente) — fecha a brecha agora, sem mudar o
-- comportamento pra quem já usa (service_role).
revoke all on function selecao_liberar_pedido_automatico(uuid, text, numeric) from public;
grant execute on function selecao_liberar_pedido_automatico(uuid, text, numeric) to service_role;
