import {
  createAdminClient,
  getInfinitePayConfig,
  infinitePayCheck,
  registrarWebhook,
  safeErrorMessage,
} from '../_shared/contratacao.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return new Response('Método não permitido.', { status: 405 })

  let body: any
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > 32 * 1024) {
      return new Response('Payload muito grande.', { status: 413 })
    }
    body = JSON.parse(raw)
  } catch {
    return new Response('Payload inválido.', { status: 400 })
  }

  let admin: any
  try {
    admin = createAdminClient()
  } catch (error) {
    console.error('contratacao-webhook: Supabase indisponível', safeErrorMessage(error))
    return new Response('Serviço indisponível.', { status: 503 })
  }

  const orderNsu = String(body?.order_nsu || '').trim()
  const transactionNsu = String(body?.transaction_nsu || '').trim()
  const slug = String(body?.slug || body?.invoice_slug || '').trim()
  const eventType = String(body?.event || body?.event_type || body?.type || '').trim().toLowerCase()

  if (!orderNsu) {
    await registrarWebhook(admin, {
      order_nsu: null,
      transaction_nsu: transactionNsu || null,
      evento_provedor: eventType || null,
      payload: body,
      resultado: 'payload_sem_order_nsu',
    })
    return new Response('order_nsu ausente.', { status: 400 })
  }

  if (eventType === 'created') {
    await registrarWebhook(admin, {
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu || null,
      evento_provedor: eventType,
      payload: body,
      resultado: 'pedido_criado_sem_pagamento',
    })
    return new Response('ok', { status: 200 })
  }

  if (!transactionNsu || !slug) {
    await registrarWebhook(admin, {
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu || null,
      evento_provedor: eventType || null,
      payload: body,
      resultado: 'payload_pagamento_incompleto',
    })
    return new Response('transaction_nsu ou slug ausente.', { status: 400 })
  }

  const { data: pedido, error: pedidoError } = await admin.rpc('gf_contratacao_webhook_dados', {
    p_order_nsu: orderNsu,
  })
  if (pedidoError) {
    console.error('contratacao-webhook: falha ao localizar pedido', pedidoError.message)
    return new Response('Não foi possível localizar o pedido.', { status: 503 })
  }
  if (!pedido) {
    await registrarWebhook(admin, {
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || null,
      payload: body,
      resultado: 'pedido_nao_encontrado',
    })
    return new Response('Pedido não encontrado.', { status: 200 })
  }


  let apiKey: string
  let handle: string
  try {
    const config = await getInfinitePayConfig(admin)
    apiKey = config.apiKey
    handle = config.handle
  } catch (error) {
    console.error('contratacao-webhook: credenciais InfinitePay indisponíveis', safeErrorMessage(error))
    return new Response('Configuração de pagamento indisponível.', { status: 503 })
  }

  let check: any
  try {
    check = await infinitePayCheck(apiKey, handle, orderNsu, transactionNsu, slug)
  } catch (error) {
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || 'unknown',
      payload: body,
      resultado: 'payment_check_indisponivel',
    })
    console.error('contratacao-webhook: payment_check indisponível', safeErrorMessage(error))
    return new Response('Falha temporária na conferência do pagamento.', { status: 503 })
  }

  if (check?.success !== true) {
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || 'unknown',
      payload: body,
      payment_check: check,
      resultado: 'payment_check_nao_validou_identificadores',
    })
    // A notificação não é assinada. Sem a validação da InfinitePay, nenhum estado financeiro é alterado.
    return new Response('Notificação não validada pela InfinitePay.', { status: 200 })
  }

  if (eventType === 'refunded') {
    const { data: conciliacao, error } = await admin.rpc('gf_contratacao_marcar_conciliacao', {
      p_order_nsu: orderNsu,
      p_transaction_nsu: transactionNsu,
      p_slug: slug,
      p_payment_check: check,
      p_motivo: 'A InfinitePay notificou um estorno. Confirme o estorno na Conta Web ou no App antes de marcar o pedido como reembolsado.',
    })
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType,
      payload: body,
      payment_check: check,
      resultado: error
        ? 'erro_ao_registrar_estorno'
        : conciliacao?.ja_pago
          ? 'estorno_notificado_pedido_pago_exige_conferencia'
          : 'estorno_em_conciliacao',
    })
    return error
      ? new Response('Não foi possível registrar a conciliação.', { status: 503 })
      : new Response('ok', { status: 200 })
  }

  if (eventType === 'canceled' || eventType === 'payment_failed') {
    if (check?.paid === true) {
      const { error } = await admin.rpc('gf_contratacao_marcar_conciliacao', {
        p_order_nsu: orderNsu,
        p_transaction_nsu: transactionNsu,
        p_slug: slug,
        p_payment_check: check,
        p_motivo: 'A InfinitePay notificou ' + eventType + ', mas payment_check confirmou pagamento. Revisão manual necessária.',
      })
      await registrarWebhook(admin, {
        pedido_id: pedido.pedido_id,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        evento_provedor: eventType,
        payload: body,
        payment_check: check,
        resultado: error ? 'erro_ao_marcar_conciliacao' : 'evento_financeiro_em_conflito',
      })
      return error
        ? new Response('Não foi possível registrar a conciliação.', { status: 503 })
        : new Response('ok', { status: 200 })
    }

    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType,
      payload: body,
      payment_check: check,
      resultado: eventType + '_validado_sem_pagamento',
    })
    // O bloqueio temporário de vaga termina no prazo da reserva; nenhum pagamento é confirmado.
    return new Response('ok', { status: 200 })
  }

  if (check?.paid !== true) {
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || 'unknown',
      payload: body,
      payment_check: check,
      resultado: 'pagamento_nao_confirmado',
    })
    return new Response('Pagamento ainda não confirmado pela InfinitePay.', { status: 503 })
  }

  const amount = Number(check.amount)
  const paidAmount = Number(check.paid_amount)
  if (!Number.isInteger(amount) || !Number.isInteger(paidAmount)) {
    const { error } = await admin.rpc('gf_contratacao_marcar_conciliacao', {
      p_order_nsu: orderNsu,
      p_transaction_nsu: transactionNsu,
      p_slug: slug,
      p_payment_check: check,
      p_motivo: 'A InfinitePay confirmou o pagamento, mas retornou valores ausentes ou inválidos.',
    })
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || 'unknown',
      payload: body,
      payment_check: check,
      resultado: error ? 'erro_ao_marcar_conciliacao' : 'conciliacao_pendente',
    })
    return error
      ? new Response('Falha ao registrar conciliação.', { status: 503 })
      : new Response('Pagamento encaminhado para conciliação.', { status: 200 })
  }

  const { data: confirmado, error: confirmarError } = await admin.rpc('gf_contratacao_confirmar_pagamento', {
    p_order_nsu: orderNsu,
    p_transaction_nsu: transactionNsu,
    p_slug: slug,
    p_amount: amount,
    p_paid_amount: paidAmount,
    p_metodo: String(check.capture_method || ''),
    p_parcelas: check.installments != null && Number.isInteger(Number(check.installments))
      ? Number(check.installments)
      : null,
    p_payment_check: check,
  })

  if (confirmarError) {
    await registrarWebhook(admin, {
      pedido_id: pedido.pedido_id,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      evento_provedor: eventType || 'unknown',
      payload: body,
      payment_check: check,
      resultado: 'erro_ao_confirmar',
    })
    console.error('contratacao-webhook: RPC de confirmação falhou', confirmarError.message)
    return new Response('Falha temporária ao confirmar o pedido.', { status: 503 })
  }

  const resultado = confirmado?.status === 'pago'
    ? (confirmado?.ja_processado ? 'ja_processado' : confirmado?.pagamento_duplicado ? 'pagamento_duplicado' : 'confirmado')
    : 'conciliacao_pendente'

  await registrarWebhook(admin, {
    pedido_id: pedido.pedido_id,
    order_nsu: orderNsu,
    transaction_nsu: transactionNsu,
    evento_provedor: eventType || 'unknown',
    payload: body,
    payment_check: check,
    resultado,
  })

  return new Response('ok', { status: 200 })
})
