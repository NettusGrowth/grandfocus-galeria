import {
  PUBLIC_CAMPAIGN_URL,
  corsHeaders,
  createAdminClient,
  getInfinitePayConfig,
  infinitePayCheck,
  jsonResponse,
  readJson,
  safeErrorMessage,
  sha256Hex,
} from '../_shared/contratacao.ts'

const CAMPAIGN_SLUG = 'entre-estacoes'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método não permitido.' }, 405)

  let body: any
  try {
    body = await readJson(req)
  } catch (error) {
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Corpo inválido.' }, 400)
  }

  let admin: any
  try {
    admin = createAdminClient()
  } catch (error) {
    console.error('contratacao-publica: configuração Supabase ausente', safeErrorMessage(error))
    return jsonResponse(req, { error: 'Serviço temporariamente indisponível.' }, 503)
  }

  try {
    switch (body?.action) {
      case 'dados':
        return await actionDados(req, admin)
      case 'contratar':
        return await actionContratar(req, admin, body)
      case 'status':
        return await actionStatus(req, admin, body)
      case 'verificar_retorno':
        return await actionVerificarRetorno(req, admin, body)
      default:
        return jsonResponse(req, { error: 'Ação desconhecida.' }, 400)
    }
  } catch (error) {
    console.error('contratacao-publica: erro tratado', safeErrorMessage(error))
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Não foi possível concluir a solicitação.' }, 400)
  }
})

async function actionDados(req: Request, admin: any) {
  if (Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') !== 'true') {
    return jsonResponse(req, {
      disponivel: false,
      mensagem: 'Esta experiência está em preparação. As contratações serão liberadas assim que a configuração e os pagamentos forem autorizados.',
    })
  }
  const { data, error } = await admin.rpc('gf_contratacao_publica_dados', { p_slug: CAMPAIGN_SLUG })
  if (error) {
    console.error('contratacao-publica[dados]: falha ao consultar campanha', error.message)
    return jsonResponse(req, { error: 'Não foi possível carregar esta campanha.' }, 503)
  }
  if (!data) return jsonResponse(req, { disponivel: false, mensagem: 'As contratações desta experiência ainda não foram liberadas.' })
  return jsonResponse(req, { disponivel: true, ...data })
}

async function actionContratar(req: Request, admin: any, body: any) {
  // Kill switch obrigatório. A InfinitePay não oferece sandbox e a criação de link é real.
  // Nenhum pedido ou link é criado até a ativação explícita deste secret.
  if (Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') !== 'true') {
    return jsonResponse(req, {
      error: 'Os pagamentos ainda estão desativados para testes. Nenhuma reserva ou cobrança foi criada.',
      modo_preparacao: true,
    }, 503)
  }
  if (String(body?.company_website || '').trim()) {
    return jsonResponse(req, { error: 'Solicitação inválida.' }, 400)
  }
  const accessToken = String(body?.access_token || '').trim().toLowerCase()
  const idempotencyKey = String(body?.idempotency_key || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(accessToken)) {
    return jsonResponse(req, { error: 'Token de acesso inválido. Atualize a página e tente novamente.' }, 400)
  }
  if (!/^[a-f0-9-]{36}$/.test(idempotencyKey)) {
    return jsonResponse(req, { error: 'Identificador de solicitação inválido. Atualize a página e tente novamente.' }, 400)
  }

  const responsavel = {
    nome: String(body?.responsavel?.nome || '').trim(),
    whatsapp: String(body?.responsavel?.whatsapp || '').trim(),
    email: String(body?.responsavel?.email || '').trim().toLowerCase(),
  }
  const phoneDigits = responsavel.whatsapp.replace(/\D/g, '')
  if (phoneDigits.length < 10 || phoneDigits.length > 13) {
    return jsonResponse(req, { error: 'Informe um WhatsApp válido com DDD.' }, 400)
  }

  // Limites por IP, e-mail e telefone. Apenas hashes são armazenados no banco.
  const sourceIp = (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0] ||
    ''
  ).trim()
  const rateKeys = [
    { hash: await sha256Hex('email:' + responsavel.email), limit: 5, window: 3600 },
    { hash: await sha256Hex('phone:' + phoneDigits), limit: 5, window: 3600 },
  ]
  if (sourceIp) rateKeys.push({ hash: await sha256Hex('ip:' + sourceIp), limit: 20, window: 900 })

  for (const key of rateKeys) {
    const { data: rate, error: rateError } = await admin.rpc('gf_contratacao_registrar_tentativa', {
      p_chave_hash: key.hash,
      p_limite: key.limit,
      p_janela_segundos: key.window,
    })
    if (rateError || !rate) {
      console.error('contratacao-publica[rate-limit]: falha ao validar limite', rateError?.message || 'sem retorno')
      return jsonResponse(req, { error: 'Não foi possível validar a segurança da solicitação. Tente novamente.' }, 503)
    }
    if (rate.permitido !== true) {
      return jsonResponse(req, {
        error: 'Muitas tentativas para estes dados. Aguarde alguns minutos antes de tentar novamente.',
        retry_after: Number(rate.retry_after) || key.window,
      }, 429)
    }
  }

  let paymentConfig: { apiKey: string; handle: string }
  try {
    paymentConfig = await getInfinitePayConfig(admin)
  } catch (error) {
    return jsonResponse(req, { error: safeErrorMessage(error) }, 503)
  }
  const { apiKey, handle } = paymentConfig
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) return jsonResponse(req, { error: 'Configuração do serviço de pagamento incompleta.' }, 503)

  let webhookToken: string
  try {
    webhookToken = getContratacaoWebhookToken()
  } catch (error) {
    return jsonResponse(req, { error: safeErrorMessage(error) }, 503)
  }

  const webhookUrl = new URL('/functions/v1/contratacao-webhook', supabaseUrl)
  webhookUrl.searchParams.set('token', webhookToken)

  const { data: campanha, error: campanhaError } = await admin.rpc('gf_contratacao_publica_dados', { p_slug: CAMPAIGN_SLUG })
  if (campanhaError || !campanha) {
    return jsonResponse(req, { error: 'Esta campanha não está aberta para contratação.' }, 409)
  }
  const participantes = Array.isArray(body?.participantes) ? body.participantes : []
  const aceite = {
    responsavel_legal: body?.aceite?.responsavel_legal === true,
    aceitou_termos: body?.aceite?.aceitou_termos === true,
    ciente_privacidade: body?.aceite?.ciente_privacidade === true,
    uso_imagem: body?.aceite?.uso_imagem === true,
    metadados: { user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) },
  }

  const requestHash = await sha256Hex(JSON.stringify({
    slug: CAMPAIGN_SLUG,
    responsavel,
    participantes,
    aceite: {
      responsavel_legal: aceite.responsavel_legal,
      aceitou_termos: aceite.aceitou_termos,
      ciente_privacidade: aceite.ciente_privacidade,
      uso_imagem: aceite.uso_imagem,
    },
  }))
  const accessHash = await sha256Hex(accessToken)

  const { data: reserva, error: reservaError } = await admin.rpc('gf_contratacao_criar_reserva', {
    p_evento_slug: CAMPAIGN_SLUG,
    p_responsavel: responsavel,
    p_participantes: participantes,
    p_aceite: aceite,
    p_acesso_hash: accessHash,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  })
  if (reservaError || !reserva) {
    console.error('contratacao-publica[contratar]: reserva recusada', reservaError?.message || 'sem retorno')
    return jsonResponse(req, { error: reservaError?.message || 'Não foi possível reservar a experiência.' }, 409)
  }

  if (['pago','conciliacao_pendente','expirado','cancelado','reembolsado'].includes(reserva.status)) {
    return jsonResponse(req, {
      error: 'Este pedido não está mais disponível para iniciar um pagamento.',
      status: reserva.status,
      order_nsu: reserva.order_nsu,
    }, 409)
  }

  const validUntil = reserva.reserva_expira_em || reserva.vendas_encerram_em
  const validUntilDate = validUntil ? new Date(validUntil) : null
  if (!validUntilDate || Number.isNaN(validUntilDate.getTime()) || validUntilDate.getTime() <= Date.now()) {
    return jsonResponse(req, { error: 'O prazo para pagamento desta reserva terminou.' }, 409)
  }
  if (validUntilDate.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    return jsonResponse(req, { error: 'O prazo de pagamento configurado excede o limite aceito pelo provedor.' }, 409)
  }

  if (reserva.checkout_url) {
    return jsonResponse(req, {
      checkout_url: reserva.checkout_url,
      order_nsu: reserva.order_nsu,
      valor_total_centavos: reserva.valor_total_centavos,
      reserva_expira_em: reserva.reserva_expira_em,
      reutilizado: true,
    })
  }

  const description = 'Grand Focus | ' + (campanha.evento?.nome_publico || 'Experiência fotográfica') +
    ' | Pedido ' + String(reserva.order_nsu).slice(0, 8)

  let response: Response
  try {
    response = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        order_nsu: reserva.order_nsu,
        webhook: {
          url: webhookUrl.toString(),
          events: ['paid','settled','refunded','canceled','payment_failed'],
        },
        redirect_url: PUBLIC_CAMPAIGN_URL,
        customer: {
          name: responsavel.nome,
          email: responsavel.email,
          phone_number: phoneDigits.startsWith('55') ? '+' + phoneDigits : '+55' + phoneDigits,
        },
        items: [{
          description,
          quantity: 1,
          price: Number(reserva.valor_total_centavos),
        }],
        options: {
          single_payment: true,
          valid_until: validUntilDate.toISOString(),
        },
      }),
    })
  } catch (error) {
    console.error('contratacao-publica[contratar]: falha de rede ao criar checkout', {
      order_nsu: reserva.order_nsu,
      message: safeErrorMessage(error),
    })
    return jsonResponse(req, {
      error: 'Não foi possível conectar à InfinitePay. Sua solicitação foi preservada e pode ser tentada novamente.',
      order_nsu: reserva.order_nsu,
      retryable: true,
    }, 502)
  }

  const linkData = await response.json().catch(() => ({}))
  const checkoutUrl = linkData?.url || linkData?.payment_url || linkData?.link
  let checkoutHostOk = false
  try {
    const parsed = new URL(checkoutUrl)
    checkoutHostOk = parsed.protocol === 'https:' && (parsed.hostname === 'infinitepay.io' || parsed.hostname.endsWith('.infinitepay.io'))
  } catch {
    checkoutHostOk = false
  }

  if (!response.ok || !checkoutUrl || !checkoutHostOk) {
    console.error('contratacao-publica[contratar]: InfinitePay recusou a criação do link', {
      order_nsu: reserva.order_nsu,
      http_status: response.status,
    })
    return jsonResponse(req, {
      error: 'A InfinitePay não conseguiu gerar o checkout agora. Sua solicitação foi preservada para uma nova tentativa.',
      order_nsu: reserva.order_nsu,
      retryable: true,
    }, 502)
  }

  const { data: registrado, error: registroError } = await admin.rpc('gf_contratacao_registrar_checkout', {
    p_order_nsu: reserva.order_nsu,
    p_checkout_url: checkoutUrl,
    p_resposta: linkData,
  })
  if (registroError || !registrado?.ok) {
    console.error('contratacao-publica[contratar]: link criado, mas não foi possível registrá-lo', {
      order_nsu: reserva.order_nsu,
      message: registroError?.message || registrado?.motivo || 'sem retorno',
    })
    return jsonResponse(req, {
      error: 'O link foi gerado, mas ainda não conseguimos concluir o registro do pagamento. Tente novamente com esta mesma solicitação.',
      order_nsu: reserva.order_nsu,
      retryable: true,
    }, 503)
  }

  return jsonResponse(req, {
    checkout_url: registrado.checkout_url || checkoutUrl,
    order_nsu: reserva.order_nsu,
    valor_total_centavos: reserva.valor_total_centavos,
    reserva_expira_em: reserva.reserva_expira_em,
    reutilizado: false,
  })
}

async function actionStatus(req: Request, admin: any, body: any) {
  const token = String(body?.access_token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(token)) return jsonResponse(req, { error: 'Token de acesso inválido.' }, 400)

  const accessHash = await sha256Hex(token)
  const { data, error } = await admin.rpc('gf_contratacao_status_por_hash', { p_acesso_hash: accessHash })
  if (error) {
    console.error('contratacao-publica[status]: falha ao consultar pedido', error.message)
    return jsonResponse(req, { error: 'Não foi possível consultar o pedido.' }, 503)
  }
  if (!data) return jsonResponse(req, { error: 'Pedido não encontrado.' }, 404)
  return jsonResponse(req, { pedido: data })
}

async function actionVerificarRetorno(req: Request, admin: any, body: any) {
  const token = String(body?.access_token || '').trim().toLowerCase()
  const orderNsu = String(body?.order_nsu || '').trim()
  const transactionNsu = String(body?.transaction_nsu || '').trim()
  const slug = String(body?.slug || '').trim()

  if (!/^[a-f0-9]{64}$/.test(token) || !orderNsu || !transactionNsu || !slug) {
    return jsonResponse(req, { error: 'Dados de retorno do pagamento incompletos.' }, 400)
  }

  const accessHash = await sha256Hex(token)
  const { data: pedido, error: statusError } = await admin.rpc('gf_contratacao_status_por_hash', { p_acesso_hash: accessHash })
  if (statusError || !pedido || pedido.order_nsu !== orderNsu) {
    return jsonResponse(req, { error: 'Não foi possível localizar este pedido.' }, 404)
  }
  if (pedido.status === 'pago') return jsonResponse(req, { pedido })

  let paymentConfig: { apiKey: string; handle: string }
  try {
    paymentConfig = await getInfinitePayConfig(admin)
  } catch (error) {
    return jsonResponse(req, { pedido, confirmacao_pendente: true, error: safeErrorMessage(error) }, 503)
  }
  const { apiKey, handle } = paymentConfig
  let check: any
  try {
    check = await infinitePayCheck(apiKey, handle, orderNsu, transactionNsu, slug)
  } catch (error) {
    console.error('contratacao-publica[retorno]: payment_check indisponível', {
      order_nsu: orderNsu,
      message: safeErrorMessage(error),
    })
    return jsonResponse(req, { pedido, confirmacao_pendente: true }, 503)
  }

  if (check?.success !== true || check?.paid !== true) {
    return jsonResponse(req, { pedido, confirmacao_pendente: true })
  }

  const amount = Number(check.amount)
  const paidAmount = Number(check.paid_amount)
  if (!Number.isInteger(amount) || !Number.isInteger(paidAmount)) {
    await admin.rpc('gf_contratacao_marcar_conciliacao', {
      p_order_nsu: orderNsu,
      p_transaction_nsu: transactionNsu,
      p_slug: slug,
      p_payment_check: check,
      p_motivo: 'A InfinitePay retornou valores ausentes ou inválidos.',
    })
    return jsonResponse(req, { confirmacao_pendente: true }, 202)
  }

  const { data: confirmado, error: confirmarError } = await admin.rpc('gf_contratacao_confirmar_pagamento', {
    p_order_nsu: orderNsu,
    p_transaction_nsu: transactionNsu,
    p_slug: slug,
    p_amount: amount,
    p_paid_amount: paidAmount,
    p_metodo: String(check.capture_method || ''),
    p_parcelas: check.installments != null && Number.isInteger(Number(check.installments)) ? Number(check.installments) : null,
    p_payment_check: check,
  })
  if (confirmarError) {
    console.error('contratacao-publica[retorno]: falha ao confirmar', confirmarError.message)
    return jsonResponse(req, { pedido, confirmacao_pendente: true }, 503)
  }

  const { data: atualizado } = await admin.rpc('gf_contratacao_status_por_hash', { p_acesso_hash: accessHash })
  return jsonResponse(req, { pedido: atualizado || pedido, confirmacao: confirmado })
}
