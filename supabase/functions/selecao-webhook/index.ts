// Edge Function pública (sem login) — recebe o webhook da InfinitePay
// quando um pagamento é confirmado no checkout da Seleção de Fotos
// (gerado por selecao-publica/criar_pagamento). NUNCA libera nada só
// com base no corpo desse POST: a documentação pública da InfinitePay
// não descreve verificação por assinatura, então qualquer um que
// descobrisse essa URL poderia forjar "paguei" — por isso, antes de
// chamar a RPC que libera o pedido, essa função SEMPRE reconfirma
// chamando payment_check() da própria InfinitePay (server-to-server,
// usando o handle salvo no banco, nunca o que vier no payload).
//
// Deploy (pelo dashboard do Supabase, sem precisar de CLI):
// Project → Edge Functions → Deploy a new function → nome
// "selecao-webhook" → cole este arquivo inteiro → Deploy. A URL final
// (https://<project-ref>.supabase.co/functions/v1/selecao-webhook) é a
// mesma que selecao-publica/criar_pagamento manda pra InfinitePay como
// webhook_url de cada link — não precisa configurar nada no painel
// deles, o webhook é por cobrança.
//
// Sempre responde 200 (mesmo em caso de erro/pagamento não confirmado)
// pra InfinitePay não ficar re-tentando pra sempre um webhook que nunca
// vai bater — os detalhes de qualquer falha ficam no log da função
// (Edge Functions → Logs) E agora também na tabela gr_webhook_events
// (Bloco 16 — Gold Reserve), pra dar prova auditável de cada estado de
// pagamento em vez de só um log efêmero que some.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return new Response('ok', { status: 200 })

  let body: any
  try { body = await req.json() } catch { return new Response('ok', { status: 200 }) }

  const orderNsu = body?.order_nsu
  const transactionNsu = body?.transaction_nsu
  const invoiceSlug = body?.invoice_slug

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // pedidoId nunca deve derrubar a função — se orderNsu não for um uuid
  // válido, o log fica sem pedido_id em vez de quebrar a resposta.
  const pedidoIdValido = typeof orderNsu === 'string' && /^[0-9a-f-]{36}$/i.test(orderNsu) ? orderNsu : null
  async function logWebhook(resultado: string, mensagem: string, checkData: any = null) {
    try {
      await admin.rpc('gr_log_webhook_evento', {
        p_pedido_id: pedidoIdValido, p_order_nsu: orderNsu ?? null, p_transaction_nsu: transactionNsu ?? null,
        p_payload: body ?? null, p_check: checkData, p_resultado: resultado, p_mensagem: mensagem,
      })
    } catch (e) { console.error('selecao-webhook: gr_log_webhook_evento falhou (não bloqueia a resposta)', String(e)) }
  }

  if (!orderNsu || !transactionNsu) {
    console.error('selecao-webhook: payload sem order_nsu/transaction_nsu', body)
    await logWebhook('erro', 'payload sem order_nsu/transaction_nsu')
    return new Response('ok', { status: 200 })
  }

  // order_nsu foi definido como selecao_pedidos.id na hora de criar o
  // link (ver acaoCriarPagamento em selecao-publica) — é assim que essa
  // função sabe qual galeria/pedido liberar. Lê tudo via RPC (nunca
  // .from() direto) — um SELECT raso depende de GRANT explícito pro
  // role que a Edge Function conseguiu autenticar em runtime, e é
  // exatamente isso que já quebrou aqui uma vez ("permission denied
  // for table selecao_pedidos" nos logs) mesmo com a service role key
  // configurada certa. RPC SECURITY DEFINER não tem essa dependência —
  // roda com o dono da função, sempre.
  const { data: dados, error: eDados } = await admin.rpc('selecao_webhook_dados', { p_pedido_id: orderNsu })
  if (eDados || !dados) {
    console.error('selecao-webhook: pedido não encontrado pro order_nsu', { orderNsu, error: eDados?.message })
    await logWebhook('erro', 'pedido não encontrado: ' + (eDados?.message || 'sem dados'))
    return new Response('ok', { status: 200 })
  }
  const pedido = { galeria_id: dados.galeria_id, valor_total: dados.valor_total }
  const handle = (dados.infinitepay_handle || '').replace(/^\$/, '').trim()
  if (!handle) {
    console.error('selecao-webhook: sem infinitepay_handle configurado', { orderNsu })
    await logWebhook('erro', 'sem infinitepay_handle configurado')
    return new Response('ok', { status: 200 })
  }

  // reconfirmação obrigatória — nunca pula essa etapa.
  let checkData: any
  try {
    const check = await fetch('https://api.checkout.infinitepay.io/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug: invoiceSlug }),
    })
    checkData = await check.json().catch(() => ({}))
  } catch (e) {
    console.error('selecao-webhook: payment_check falhou de rede', { orderNsu, error: String(e) })
    await logWebhook('erro', 'payment_check falhou de rede: ' + String(e))
    return new Response('ok', { status: 200 })
  }

  if (!checkData?.paid) {
    console.error('selecao-webhook: payment_check não confirmou pagamento', { orderNsu, transactionNsu, checkData })
    await logWebhook('nao_confirmado', 'payment_check não confirmou pagamento', checkData)
    return new Response('ok', { status: 200 })
  }

  const valorPagoCentavos = checkData.paid_amount ?? checkData.amount ?? 0
  const valorPago = valorPagoCentavos / 100

  const { data: liberarData, error: eLiberar } = await admin.rpc('selecao_liberar_pedido_automatico', {
    p_galeria_id: pedido.galeria_id, p_transaction_nsu: transactionNsu, p_valor_pago: valorPago,
  })
  if (eLiberar) {
    console.error('selecao-webhook: RPC selecao_liberar_pedido_automatico falhou', { orderNsu, message: eLiberar.message })
    await logWebhook('erro', 'selecao_liberar_pedido_automatico falhou: ' + eLiberar.message, checkData)
  } else if (liberarData?.ja_processado) {
    await logWebhook('ja_processado', 'retry do mesmo pagamento — no-op', checkData)
  } else {
    await logWebhook('confirmado', 'pagamento confirmado e pedido liberado — R$ ' + valorPago.toFixed(2), checkData)
  }

  return new Response('ok', { status: 200 })
})
