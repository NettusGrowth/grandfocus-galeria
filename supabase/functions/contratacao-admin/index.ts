import {
  corsHeaders,
  createAdminClient,
  getInfinitePayConfig,
  infinitePayCheck,
  jsonResponse,
  readJson,
  safeErrorMessage,
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

  const authorization = req.headers.get('authorization') || ''
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonResponse(req, { error: 'Faça login para acessar a administração.' }, 401)

  let admin: any
  try {
    admin = createAdminClient()
  } catch (error) {
    console.error('contratacao-admin: configuração Supabase ausente', safeErrorMessage(error))
    return jsonResponse(req, { error: 'Serviço temporariamente indisponível.' }, 503)
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const user = authData?.user
  if (authError || !user) return jsonResponse(req, { error: 'Sessão inválida. Entre novamente.' }, 401)

  const { data: perfil, error: perfilError } = await admin
    .from('perfis')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (perfilError || !['admin', 'super_admin'].includes(perfil?.role || '')) {
    return jsonResponse(req, { error: 'Acesso restrito à equipe administrativa da Grand Focus.' }, 403)
  }

  try {
    switch (body?.action) {
      case 'config':
        return await actionConfig(req, admin)
      case 'salvar':
        return await actionSalvar(req, admin, user.id, body)
      case 'publicar':
        return await actionPublicar(req, admin, user.id)
      case 'pausar':
        return await actionStatus(req, admin, user.id, 'pausado')
      case 'encerrar':
        return await actionStatus(req, admin, user.id, 'encerrado')
      case 'pedidos':
        return await actionPedidos(req, admin)
      case 'detalhe':
        return await actionDetalhe(req, admin, body)
      case 'reconciliar':
        return await actionReconciliar(req, admin, body)
      case 'marcar_reembolsado':
        return await actionMarcarReembolsado(req, admin, user.id, body)
      default:
        return jsonResponse(req, { error: 'Ação administrativa desconhecida.' }, 400)
    }
  } catch (error) {
    console.error('contratacao-admin: erro tratado', safeErrorMessage(error))
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Não foi possível concluir a ação.' }, 400)
  }
})

async function getCampaign(admin: any) {
  const { data, error } = await admin
    .from('gf_contratacao_eventos')
    .select('*')
    .eq('slug', CAMPAIGN_SLUG)
    .maybeSingle()
  if (error) throw new Error('Não foi possível consultar a configuração da campanha.')
  if (!data) throw new Error('Campanha ainda não cadastrada. A migration 080 precisa ser aplicada primeiro.')
  return data
}

async function actionConfig(req: Request, admin: any) {
  const evento = await getCampaign(admin)
  const { data: pacotes, error } = await admin
    .from('gf_contratacao_pacotes')
    .select('id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,minimo_fotos_por_coreografia,ativo,ordem')
    .eq('evento_contratacao_id', evento.id)
    .order('ordem', { ascending: true })
  if (error) throw new Error('Não foi possível consultar os pacotes.')
  return jsonResponse(req, { evento, pacotes: pacotes || [] })
}

async function actionSalvar(req: Request, admin: any, userId: string, body: any) {
  const evento = await getCampaign(admin)
  if (evento.status === 'publicado') {
    return jsonResponse(req, { error: 'Pause a campanha antes de editar informações que afetam a contratação.' }, 409)
  }

  const input = body?.evento || {}
  const toIso = (value: unknown, label: string) => {
    if (value == null || value === '') return null
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) throw new Error('Data ou horário inválido em ' + label + '.')
    return date.toISOString()
  }
  const toInt = (value: unknown, label: string, min: number, max: number) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error('Valor inválido em ' + label + '.')
    return n
  }
  const nullableText = (value: unknown, max: number, label: string) => {
    const s = String(value ?? '').trim()
    if (s.length > max) throw new Error(label + ' excede o limite de caracteres.')
    return s || null
  }

  const update = {
    data_evento: nullableText(input.data_evento, 10, 'Data do evento'),
    local: nullableText(input.local, 240, 'Local'),
    miniensaio_inicio: toIso(input.miniensaio_inicio, 'início do miniensaio'),
    miniensaio_fim: toIso(input.miniensaio_fim, 'fim do miniensaio'),
    duracao_minutos: toInt(input.duracao_minutos, 'duração', 1, 60),
    capacidade_miniensaios: input.capacidade_miniensaios === '' || input.capacidade_miniensaios == null
      ? null
      : toInt(input.capacidade_miniensaios, 'capacidade', 0, 10000),
    vendas_encerram_em: toIso(input.vendas_encerram_em, 'prazo de vendas'),
    reserva_minutos: toInt(input.reserva_minutos, 'duração da reserva', 1, 60),
    prazo_entrega_dias: input.prazo_entrega_dias === '' || input.prazo_entrega_dias == null
      ? null
      : toInt(input.prazo_entrega_dias, 'prazo de entrega', 1, 365),
    whatsapp_atendimento: nullableText(input.whatsapp_atendimento, 30, 'WhatsApp de atendimento'),
    termos_versao: nullableText(input.termos_versao, 40, 'Versão dos termos'),
    termos_conteudo: nullableText(input.termos_conteudo, 30000, 'Termos da contratação'),
    privacidade_url: nullableText(input.privacidade_url, 500, 'URL de privacidade'),
    autorizacao_imagem_versao: nullableText(input.autorizacao_imagem_versao, 40, 'Versão da autorização de imagem'),
    autorizacao_imagem_conteudo: nullableText(input.autorizacao_imagem_conteudo, 10000, 'Texto de autorização de imagem'),
    fornecedor_nome: nullableText(input.fornecedor_nome, 180, 'Nome do fornecedor'),
    fornecedor_documento: nullableText(input.fornecedor_documento, 40, 'Documento do fornecedor'),
    fornecedor_endereco: nullableText(input.fornecedor_endereco, 500, 'Endereço do fornecedor'),
    fornecedor_email: nullableText(input.fornecedor_email, 180, 'E-mail do fornecedor'),
    atualizado_em: new Date().toISOString(),
  }

  if (update.data_evento && !/^\d{4}-\d{2}-\d{2}$/.test(update.data_evento)) {
    return jsonResponse(req, { error: 'Informe a data do evento no formato correto.' }, 400)
  }

  const { error: updateError } = await admin
    .from('gf_contratacao_eventos')
    .update(update)
    .eq('id', evento.id)
  if (updateError) throw new Error('Não foi possível salvar os dados da campanha.')

  const pacotes = Array.isArray(body?.pacotes) ? body.pacotes : []
  const allowed = new Set(['miniensaio','palco','completo'])
  for (const item of pacotes) {
    if (!allowed.has(item?.codigo)) continue
    const preco = Number(item.preco_centavos)
    if (!Number.isInteger(preco) || preco < 100) throw new Error('O preço de cada pacote deve ser de pelo menos R$ 1,00.')
    const { error } = await admin
      .from('gf_contratacao_pacotes')
      .update({ preco_centavos: preco, ativo: item.ativo === true })
      .eq('evento_contratacao_id', evento.id)
      .eq('codigo', item.codigo)
    if (error) throw new Error('Não foi possível atualizar o pacote ' + item.codigo + '.')
  }

  await admin.from('gf_contratacao_auditoria').insert({
    evento_contratacao_id: evento.id,
    usuario_id: userId,
    acao: 'configuracao_salva',
    detalhes: { pacotes_atualizados: pacotes.map((item: any) => item.codigo).filter(Boolean) },
  })

  return await actionConfig(req, admin)
}

async function actionPublicar(req: Request, admin: any, userId: string) {
  const { data, error } = await admin.rpc('gf_contratacao_admin_publicar', { p_slug: CAMPAIGN_SLUG })
  if (error) return jsonResponse(req, { error: error.message }, 409)
  const evento = await getCampaign(admin)
  await admin.from('gf_contratacao_auditoria').insert({
    evento_contratacao_id: evento.id,
    usuario_id: userId,
    acao: 'publicacao_confirmada_pelo_admin',
    detalhes: {},
  })
  return jsonResponse(req, { ok: true, resultado: data, evento })
}

async function actionStatus(req: Request, admin: any, userId: string, status: string) {
  const evento = await getCampaign(admin)
  const { error } = await admin
    .from('gf_contratacao_eventos')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('id', evento.id)
  if (error) throw new Error('Não foi possível atualizar o status da campanha.')
  await admin.from('gf_contratacao_auditoria').insert({
    evento_contratacao_id: evento.id,
    usuario_id: userId,
    acao: status === 'pausado' ? 'campanha_pausada' : 'campanha_encerrada',
    detalhes: {},
  })
  return jsonResponse(req, { ok: true, status })
}

async function actionPedidos(req: Request, admin: any) {
  const evento = await getCampaign(admin)
  const { data: pedidos, error } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,numero,responsavel_nome,responsavel_whatsapp,responsavel_email,valor_total_centavos,status,reserva_status,reserva_expira_em,pagamento_confirmado_em,criado_em,order_nsu')
    .eq('evento_contratacao_id', evento.id)
    .order('criado_em', { ascending: false })
    .limit(100)
  if (error) throw new Error('Não foi possível consultar os pedidos.')

  const ids = (pedidos || []).map((pedido: any) => pedido.id)
  const counts: Record<string, number> = {}
  if (ids.length) {
    const { data: participantes, error: participantesError } = await admin
      .from('gf_contratacao_participantes')
      .select('pedido_id')
      .in('pedido_id', ids)
    if (participantesError) throw new Error('Não foi possível contar as bailarinas dos pedidos.')
    for (const item of participantes || []) counts[item.pedido_id] = (counts[item.pedido_id] || 0) + 1
  }

  return jsonResponse(req, {
    pedidos: (pedidos || []).map((pedido: any) => ({ ...pedido, quantidade_bailarinas: counts[pedido.id] || 0 })),
  })
}

async function actionDetalhe(req: Request, admin: any, body: any) {
  const pedidoId = String(body?.pedido_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return jsonResponse(req, { error: 'Pedido inválido.' }, 400)

  const { data: pedido, error } = await admin
    .from('gf_contratacao_pedidos')
    .select('*')
    .eq('id', pedidoId)
    .maybeSingle()
  if (error || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado.' }, 404)

  const [participantesResult, pagamentoResult, aceiteResult, webhookResult] = await Promise.all([
    admin.from('gf_contratacao_participantes')
      .select('id,bailarina_nome,turma,idade,preco_centavos,consome_miniensaio,pacote_id')
      .eq('pedido_id', pedidoId),
    admin.from('gf_contratacao_pagamentos').select('*').eq('pedido_id', pedidoId).maybeSingle(),
    admin.from('gf_contratacao_aceites').select('*').eq('pedido_id', pedidoId).maybeSingle(),
    admin.from('gf_contratacao_webhook_eventos')
      .select('evento_provedor,resultado,criado_em,order_nsu,transaction_nsu')
      .eq('pedido_id', pedidoId)
      .order('criado_em', { ascending: false })
      .limit(30),
  ])

  if (participantesResult.error || pagamentoResult.error || aceiteResult.error || webhookResult.error) {
    throw new Error('Não foi possível carregar todos os detalhes deste pedido.')
  }

  const participantes = participantesResult.data || []
  const participanteIds = participantes.map((item: any) => item.id)
  const [pacotesResult, coreografiasResult] = await Promise.all([
    admin.from('gf_contratacao_pacotes').select('id,codigo,nome').in('id', participantes.map((item: any) => item.pacote_id)),
    participanteIds.length
      ? admin.from('gf_contratacao_coreografias').select('*').in('participante_id', participanteIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (pacotesResult.error || coreografiasResult.error) throw new Error('Não foi possível carregar pacotes e coreografias.')

  const pacotesById = Object.fromEntries((pacotesResult.data || []).map((item: any) => [item.id, item]))
  const coreografias = coreografiasResult.data || []

  return jsonResponse(req, {
    pedido,
    participantes: participantes.map((item: any) => ({
      ...item,
      pacote: pacotesById[item.pacote_id] || null,
      coreografias: coreografias.filter((coreografia: any) => coreografia.participante_id === item.id),
    })),
    pagamento: pagamentoResult.data,
    aceite: aceiteResult.data,
    webhooks: webhookResult.data || [],
  })
}

async function actionReconciliar(req: Request, admin: any, body: any) {
  const pedidoId = String(body?.pedido_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return jsonResponse(req, { error: 'Pedido inválido.' }, 400)

  const { data: pedido, error: pedidoError } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,order_nsu,valor_total_centavos,status')
    .eq('id', pedidoId)
    .maybeSingle()
  if (pedidoError || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado.' }, 404)

  const { data: pagamento, error: pagamentoError } = await admin
    .from('gf_contratacao_pagamentos')
    .select('transaction_nsu,slug')
    .eq('pedido_id', pedidoId)
    .maybeSingle()
  if (pagamentoError || !pagamento?.transaction_nsu || !pagamento?.slug) {
    return jsonResponse(req, { error: 'Ainda não há identificadores suficientes para consultar este pagamento.' }, 409)
  }

  const { apiKey, handle } = await getInfinitePayConfig(admin)
  const check = await infinitePayCheck(apiKey, handle, pedido.order_nsu, pagamento.transaction_nsu, pagamento.slug)
  if (check?.success !== true || check?.paid !== true) {
    return jsonResponse(req, { ok: false, status: pedido.status, mensagem: 'A InfinitePay ainda não confirmou o pagamento.' }, 409)
  }

  const amount = Number(check.amount)
  const paidAmount = Number(check.paid_amount)
  if (!Number.isInteger(amount) || !Number.isInteger(paidAmount)) {
    return jsonResponse(req, { error: 'A InfinitePay retornou valores inválidos. Mantenha o pedido em conciliação.' }, 409)
  }

  const { data: resultado, error } = await admin.rpc('gf_contratacao_confirmar_pagamento', {
    p_order_nsu: pedido.order_nsu,
    p_transaction_nsu: pagamento.transaction_nsu,
    p_slug: pagamento.slug,
    p_amount: amount,
    p_paid_amount: paidAmount,
    p_metodo: String(check.capture_method || ''),
    p_parcelas: check.installments != null && Number.isInteger(Number(check.installments)) ? Number(check.installments) : null,
    p_payment_check: check,
  })
  if (error) throw new Error('Falha ao atualizar a conciliação do pagamento.')
  return jsonResponse(req, { ok: true, resultado })
}

async function actionMarcarReembolsado(req: Request, admin: any, userId: string, body: any) {
  const pedidoId = String(body?.pedido_id || '').trim()
  const motivo = String(body?.motivo || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId) || motivo.length < 10) {
    return jsonResponse(req, { error: 'Informe o pedido e o motivo da conferência do estorno.' }, 400)
  }

  const { data: pedido, error: pedidoError } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,evento_contratacao_id,status')
    .eq('id', pedidoId)
    .maybeSingle()
  if (pedidoError || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado.' }, 404)

  const { error: orderError } = await admin
    .from('gf_contratacao_pedidos')
    .update({ status: 'reembolsado', reserva_status: 'expirada', atualizado_em: new Date().toISOString() })
    .eq('id', pedidoId)
  if (orderError) throw new Error('Não foi possível atualizar o pedido.')

  const { error: paymentError } = await admin
    .from('gf_contratacao_pagamentos')
    .update({ status: 'refunded', atualizado_em: new Date().toISOString() })
    .eq('pedido_id', pedidoId)
  if (paymentError) throw new Error('Pedido atualizado, mas o pagamento não foi atualizado. Verifique a administração.')

  await admin.from('gf_contratacao_auditoria').insert({
    evento_contratacao_id: pedido.evento_contratacao_id,
    pedido_id: pedidoId,
    usuario_id: userId,
    acao: 'reembolso_confirmado_manualmente',
    detalhes: { motivo: motivo.slice(0, 500) },
  })
  return jsonResponse(req, { ok: true, status: 'reembolsado' })
}
