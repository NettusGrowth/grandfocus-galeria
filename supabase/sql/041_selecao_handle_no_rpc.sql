-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 11: fix do checkout automático não
-- reconhecendo o handle da InfinitePay já configurado. A Edge Function
-- selecao-publica (ação criar_pagamento) fazia DUAS leituras separadas
-- do banco: a RPC selecao_publica_dados (que só devolve um booleano,
-- de propósito, pra nunca vazar o handle pro navegador do cliente) e,
-- depois, uma leitura direta em selecao_config só pra pegar o valor
-- puro do handle — essa segunda leitura é quem geralmente falha
-- silenciosamente (o erro dela nunca era logado), caindo na mesma
-- mensagem de "não configurado" mesmo com o handle salvo certinho.
--
-- Em vez de manter duas leituras, a RPC passa a devolver o handle cru
-- também — sem risco, porque quem decide o que repassar pro navegador
-- é a Edge Function (acaoDados só encaminha 'pagamento_automatico',
-- nunca 'infinitepay_handle'; só acaoCriarPagamento, rodando com a
-- service role no servidor, é que lê esse campo). Rodar depois de 001
-- a 040. Aditiva.
-- ════════════════════════════════════════════════════════════════

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
  into v_fotos from selecao_fotos where galeria_id = v_gal.id and not bonus;

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
    'pagamento_automatico', (v_pix.infinitepay_handle is not null and v_pix.infinitepay_handle <> ''),
    -- uso interno da Edge Function (service role) só em criar_pagamento
    -- — acaoDados nunca encaminha esse campo pro cliente.
    'infinitepay_handle', v_pix.infinitepay_handle
  );
end;
$$;
