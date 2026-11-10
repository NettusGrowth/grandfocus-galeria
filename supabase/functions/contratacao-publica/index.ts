import { isAllowedInfinitePayCheckoutUrl } from '../_shared/infinitepay_checkout.ts'
import {
  PUBLIC_ORIGIN,
  corsHeaders,
  createAdminClient,
  getContratacaoWebhookToken,
  getInfinitePayConfig,
  infinitePayCheck,
  jsonResponse,
  readJson,
  safeErrorMessage,
  sha256Hex,
} from '../_shared/contratacao.ts'

// Lançamento controlado: a autorização para cobranças exige revisão e remoção explícita deste bloqueio.
const REAL_PAYMENTS_ENABLED = false

const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function pedidoPertenceCampanha(admin: any, pedido: any, campaignSlug: string) {
  const { data: campanha, error: campanhaError } = await admin.from('gf_contratacao_eventos').select('id').eq('slug', campaignSlug).maybeSingle()
  if (campanhaError || !campanha || !pedido?.order_nsu) return false
  const { data: registro, error } = await admin.from('gf_contratacao_pedidos').select('evento_contratacao_id').eq('order_nsu', pedido.order_nsu).maybeSingle()
  return !error && registro?.evento_contratacao_id === campanha.id
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método não permitido.' }, 405)

  let body: any
  try {
    body = await readJson(req)
  } catch (error) {
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Corpo inválido.' }, 400)
  }

  const campaignSlug = String(body?.campaign_slug || '').trim().toLowerCase()
  if (!CAMPAIGN_SLUG_PATTERN.test(campaignSlug) || campaignSlug.length > 60) {
    return jsonResponse(req, { error: 'Endereço da contratação inválido.' }, 400)
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
      case 'natal_horarios':
        return await actionNatalHorarios(req, admin, body, campaignSlug)
      case 'natal_seguranca_horario':
        return await actionNatalReter(req, admin, body, campaignSlug)
      case 'natal_liberar_horario':
        return await actionNatalLiberar(req, admin, body, campaignSlug)
      case 'natal_inscrever':
        return await actionNatalInscrever(req, admin, body, campaignSlug)
      case 'gente_inscrever':
        return await actionGenteInscrever(req, admin, body, campaignSlug)
      case 'dados':
        return await actionDados(req, admin, campaignSlug)
      case 'contratar':
        return await actionContratar(req, admin, body, campaignSlug)
      case 'status':
        return await actionStatus(req, admin, body, campaignSlug)
      case 'verificar_retorno':
        return await actionVerificarRetorno(req, admin, body, campaignSlug)
      default:
        return jsonResponse(req, { error: 'Ação desconhecida.' }, 400)
    }
  } catch (error) {
    console.error('contratacao-publica: erro tratado', safeErrorMessage(error))
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Não foi possível concluir a solicitação.' }, 400)
  }
})

// Agendamento *manual* do Natal: não envolve InfinitePay, não gera checkout,
// não registra um pagamento confirmado. Disponível exclusivamente para esta campanha.
const NATAL_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function actionNatalHorarios(req:Request,admin:any,body:any,slug:string){
 if(slug!=='natal-fada-acucarada-2026')return jsonResponse(req,{error:'Agenda não disponível nesta campanha.'},404)
 const quantidade=Number(body?.quantidade||1)
 const token=String(body?.idempotencia||'')
 if(!Number.isInteger(quantidade)||quantidade<1||quantidade>4||
   (token&&!NATAL_UUID.test(token)))return jsonResponse(req,{error:'Quantidade inválida.'},400)
 const {data,error}=await admin.rpc('gf_natal_listar_inicios',{
  p_slug:slug,p_quantidade:quantidade,p_token:token||null,p_preview:false
 })
 if(error)return jsonResponse(req,{error:'Não foi possível consultar os horários.'},503)
 return jsonResponse(req,data||{disponivel:false,horarios:[]})
}
async function actionNatalReter(req:Request,admin:any,body:any,slug:string){
 if(slug!=='natal-fada-acucarada-2026')return jsonResponse(req,{error:'Reserva indisponível.'},404)
 const token=String(body?.idempotencia||'')
 const horario=String(body?.horario_id||'')
 const quantidade=Number(body?.quantidade)
 if(!NATAL_UUID.test(token)||!NATAL_UUID.test(horario)||!Number.isInteger(quantidade)||quantidade<1||quantidade>4)
  return jsonResponse(req,{error:'Escolha um horário válido.'},400)
 // Anti-automação para não reter todas as vagas sem preencher o cadastro.
 const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||
  req.headers.get('x-forwarded-for')?.split(',')[0]||'').trim()
 if(ip){
   const hash=await sha256Hex('natal:hold-ip:'+ip)
   const {data,error}=await admin.rpc('gf_contratacao_registrar_tentativa',{
     p_chave_hash:hash,p_limite:35,p_janela_segundos:900
   })
   if(error||!data)return jsonResponse(req,{error:'Não foi possível validar a reserva.'},503)
   if(data.permitido!==true)return jsonResponse(req,{error:'Muitas tentativas. Consulte a Grand Focus para reservar.'},429)
 }
 const {data,error}=await admin.rpc('gf_natal_reservar_temporariamente',{
   p_slug:slug,p_horario:horario,p_quantidade:quantidade,p_token:token
 })
 if(error)return jsonResponse(req,{error:error.message||'Esse horário foi reservado por outra família.'},409)
 return jsonResponse(req,data||{ok:false})
}
async function actionNatalLiberar(req:Request,admin:any,body:any,slug:string){
 if(slug!=='natal-fada-acucarada-2026')return jsonResponse(req,{error:'Reserva indisponível.'},404)
 const token=String(body?.idempotencia||'')
 if(!NATAL_UUID.test(token))return jsonResponse(req,{error:'Reserva inválida.'},400)
 const {data,error}=await admin.rpc('gf_natal_liberar_reserva',{p_slug:slug,p_token:token})
 if(error)return jsonResponse(req,{error:'Não foi possível liberar agora. A reserva expira automaticamente.'},409)
 return jsonResponse(req,data||{ok:true})
}
async function actionGenteInscrever(req:Request,admin:any,body:any,slug:string){
 if(slug!=='gente-que-danca-2026')
  return jsonResponse(req,{error:'Inscrição indisponível nesta campanha.'},404)
 if(String(body?.company_website||'').trim())
  return jsonResponse(req,{error:'Solicitação não aceita.'},400)
 const id=String(body?.idempotencia||'')
 const phone=String(body?.whatsapp||'').replace(/\D/g,'')
 const students=body?.alunos
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ||!Array.isArray(students)||students.length<1||students.length>4
    ||!['pix','credito'].includes(body?.preferencia)
    ||String(body?.nome||'').trim().length<5
    ||phone.length<10||phone.length>13
    ||body?.aceite!==true || JSON.stringify(body).length>12000)
  return jsonResponse(req,{error:'Confira os campos obrigatórios.'},400)
 const ip=(req.headers.get('cf-connecting-ip')||
  req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'').trim()
 for(const limit of [
   {hash:await sha256Hex('gente:phone:'+phone),max:8,window:3600},
   ...(ip?[{hash:await sha256Hex('gente:ip:'+ip),max:25,window:900}]:[])
 ]){
  const {data,error}=await admin.rpc('gf_contratacao_registrar_tentativa',{
   p_chave_hash:limit.hash,p_limite:limit.max,p_janela_segundos:limit.window})
  if(error||!data)return jsonResponse(req,{error:'Não foi possível validar a inscrição.'},503)
  if(data.permitido!==true)return jsonResponse(req,{error:'Muitas tentativas. Entre em contato com a Grand Focus.'},429)
 }
 const {data,error}=await admin.rpc('gf_gente_solicitar_interesse',{
  p_slug:slug,p_responsavel:String(body.nome||''),p_whatsapp:phone,
  p_alunos:students,p_preferencia:body.preferencia,p_idempotencia:id,p_aceite:true
 })
 if(error)return jsonResponse(req,{error:error.message||'Não foi possível registrar sua participação.'},409)
 return jsonResponse(req,data||{ok:false})
}

async function actionNatalInscrever(req:Request,admin:any,body:any,slug:string){
 if(slug!=='natal-fada-acucarada-2026')
   return jsonResponse(req,{error:'Inscrição indisponível nesta campanha.'},404)
 if(String(body?.company_website||'').trim())
   return jsonResponse(req,{error:'Solicitação não aceita.'},400)
 const payload=body||{}
 const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 if(!uuidPattern.test(String(payload.horario_id||''))||
    !uuidPattern.test(String(payload.idempotencia||''))||
    !Array.isArray(payload.alunos)||payload.alunos.length<1||payload.alunos.length>4||
    !['ja_paguei','a_pagar'].includes(payload.pagamento)||
    typeof payload.aceite!=='boolean'||payload.aceite!==true||
    JSON.stringify(payload).length>14000)
   return jsonResponse(req,{error:'Revise as informações do formulário.'},400)
 const phone=String(payload.whatsapp||'').replace(/\D/g,'')
 if(phone.length<10||phone.length>13)return jsonResponse(req,{error:'WhatsApp inválido.'},400)
 // Limites do projeto: apenas hashes são registrados (nunca o telefone em texto).
 const ip=(req.headers.get('cf-connecting-ip')||
    req.headers.get('x-real-ip')||
    req.headers.get('x-forwarded-for')?.split(',')[0]||'').trim()
 const limits=[
  {hash:await sha256Hex('natal:phone:'+phone),limit:6,window:3600},
  ...(ip?[{hash:await sha256Hex('natal:ip:'+ip),limit:20,window:900}]:[])
 ]
 for(const limit of limits){
  const {data,error}=await admin.rpc('gf_contratacao_registrar_tentativa',{
   p_chave_hash:limit.hash,p_limite:limit.limit,p_janela_segundos:limit.window
  })
  if(error||!data)return jsonResponse(req,{error:'Não foi possível validar a segurança da inscrição.'},503)
  if(data.permitido!==true)return jsonResponse(req,{
    error:'Muitas tentativas. Aguarde alguns minutos para continuar.'
  },429)
 }
 const {data,error}=await admin.rpc('gf_natal_solicitar_sem_cronometro',{
  p_slug:slug,p_horario:payload.horario_id,
  p_nome:String(payload.nome||''),p_whatsapp:String(payload.whatsapp||''),
  p_email:String(payload.email||''),p_alunos:payload.alunos,
  p_pagamento:payload.pagamento,p_meio:String(payload.meio_pagamento||''),
  p_data_pagamento:payload.data_pagamento||null,
  p_familia:String(payload.familia||''),p_observacao:String(payload.observacao||''),
  p_idempotencia:payload.idempotencia,p_aceite:true
 })
 if(error){
  console.error('contratacao-publica[natal_inscrever]: solicitação recusada',error.message)
  return jsonResponse(req,{error:error.message||'Não foi possível solicitar o horário.'},409)
 }
 return jsonResponse(req,data||{ok:false})
}

async function actionDados(req: Request, admin: any, campaignSlug: string) {
  // Mantenha a página pública fechada enquanto o checkout real não estiver autorizado.
  if (!REAL_PAYMENTS_ENABLED || Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') !== 'true') {
    return jsonResponse(req, {
      disponivel: false,
      mensagem: 'As contratações desta experiência ainda não foram liberadas.',
    })
  }
  const { data, error } = await admin.rpc('gf_contratacao_publica_dados', { p_slug: campaignSlug })
  if (error) {
    console.error('contratacao-publica[dados]: falha ao consultar campanha', error.message)
    return jsonResponse(req, { error: 'Não foi possível carregar esta campanha.' }, 503)
  }
  if (!data) return jsonResponse(req, { disponivel: false, mensagem: 'As contratações desta experiência ainda não foram liberadas.' })
  const {data:modelo,error:modeloError}=await admin.from('gf_contratacao_eventos')
    .select('formulario_modelo,formulario_versao').eq('slug',campaignSlug).eq('status','publicado').maybeSingle()
  if(modeloError || !modelo) return jsonResponse(req,{error:'Não foi possível carregar as perguntas da campanha.'},503)
  return jsonResponse(req, {
    disponivel: true,...data,
    evento:{...data.evento,formulario_modelo:modelo.formulario_modelo,formulario_versao:modelo.formulario_versao}
  })
}

async function actionContratar(req: Request, admin: any, body: any, campaignSlug: string) {
  // A InfinitePay não oferece sandbox. Bloqueie a reserva antes de gravar qualquer pedido
  // até que a Grand Focus autorize explicitamente a criação de checkouts reais.
  if (!REAL_PAYMENTS_ENABLED || Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') !== 'true') {
    return jsonResponse(req, {
      error: 'A contratação online ainda não foi liberada. Nenhum pedido foi registrado.',
      retryable: false,
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

  const { data: campanha, error: campanhaError } = await admin.rpc('gf_contratacao_publica_dados', { p_slug: campaignSlug })
  if (campanhaError || !campanha) {
    return jsonResponse(req, { error: 'Esta campanha não está aberta para contratação.' }, 409)
  }
  const participantes = Array.isArray(body?.participantes) ? body.participantes : []
  const formulario = body?.formulario
  if (!formulario || typeof formulario !== 'object' || Array.isArray(formulario) ||
      !Number.isInteger(formulario.versao) || formulario.versao < 1 ||
      typeof formulario.respostas !== 'object' || formulario.respostas === null ||
      Array.isArray(formulario.respostas) || JSON.stringify(formulario).length > 22000)
    return jsonResponse(req,{error:'As respostas adicionais estão inválidas. Atualize o formulário e tente novamente.'},400)
  const aceite = {
    responsavel_legal: body?.aceite?.responsavel_legal === true,
    aceitou_termos: body?.aceite?.aceitou_termos === true,
    ciente_privacidade: body?.aceite?.ciente_privacidade === true,
    uso_imagem: body?.aceite?.uso_imagem === true,
    metadados: { user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) },
    formulario: {versao:formulario.versao,respostas:formulario.respostas},
  }

  const requestHash = await sha256Hex(JSON.stringify({
    slug: campaignSlug,
    responsavel,
    participantes,
    formulario:aceite.formulario,
    aceite: {
      responsavel_legal: aceite.responsavel_legal,
      aceitou_termos: aceite.aceitou_termos,
      ciente_privacidade: aceite.ciente_privacidade,
      uso_imagem: aceite.uso_imagem,
    },
  }))
  const accessHash = await sha256Hex(accessToken)

  const { data: reserva, error: reservaError } = await admin.rpc('gf_contratacao_criar_reserva', {
    p_evento_slug: campaignSlug,
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
          // A InfinitePay documenta o payload de aprovação sem campo de tipo de evento.
          // Assinamos somente paid/settled para que um payload sem discriminador nunca
          // possa ser confundido com um estorno ou cancelamento.
          events: ['paid','settled'],
        },
        redirect_url: PUBLIC_ORIGIN + '/contratar/' + campaignSlug + '/',
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

  const responseText = await response.text().catch(() => '')
  let linkData: any = {}
  try { linkData = responseText ? JSON.parse(responseText) : {} } catch { /* resposta não JSON */ }
  const checkoutUrl = linkData?.url || linkData?.payment_url || linkData?.link
  let checkoutHost: string | null = null
  try { checkoutHost = new URL(String(checkoutUrl || '')).hostname || null } catch { /* URL ausente ou inválida */ }
  const checkoutHostOk = isAllowedInfinitePayCheckoutUrl(checkoutUrl)
  const providerError = linkData?.error && typeof linkData.error === 'object' ? linkData.error : {}
  const providerCode = String(linkData?.code || providerError?.code || '').slice(0, 100) || null
  const providerMessage = String(
    linkData?.message || providerError?.message || linkData?.error_description ||
    (typeof linkData?.error === 'string' ? linkData.error : '')
  ).slice(0, 300) || null
  const responseKeys = linkData && typeof linkData === 'object' ? Object.keys(linkData) : []

  if (!response.ok || !checkoutUrl || !checkoutHostOk) {
    console.error('contratacao-publica[contratar]: resposta da InfinitePay sem checkout válido', {
      order_nsu: reserva.order_nsu,
      http_status: response.status,
      response_keys: responseKeys,
      provider_code: providerCode,
      provider_message: providerMessage,
      checkout_url_present: Boolean(checkoutUrl),
      checkout_host: checkoutHost,
      checkout_host_ok: checkoutHostOk,
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

async function actionStatus(req: Request, admin: any, body: any, campaignSlug: string) {
  const token = String(body?.access_token || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(token)) return jsonResponse(req, { error: 'Token de acesso inválido.' }, 400)

  const accessHash = await sha256Hex(token)
  const { data, error } = await admin.rpc('gf_contratacao_status_por_hash', { p_acesso_hash: accessHash })
  if (error) {
    console.error('contratacao-publica[status]: falha ao consultar pedido', error.message)
    return jsonResponse(req, { error: 'Não foi possível consultar o pedido.' }, 503)
  }
  if (!data || !(await pedidoPertenceCampanha(admin, data, campaignSlug))) return jsonResponse(req, { error: 'Pedido não encontrado nesta contratação.' }, 404)
  return jsonResponse(req, { pedido: data })
}

async function actionVerificarRetorno(req: Request, admin: any, body: any, campaignSlug: string) {
  const token = String(body?.access_token || '').trim().toLowerCase()
  const orderNsu = String(body?.order_nsu || '').trim()
  const transactionNsu = String(body?.transaction_nsu || '').trim()
  const slug = String(body?.slug || '').trim()

  if (!/^[a-f0-9]{64}$/.test(token) || !orderNsu || !transactionNsu || !slug) {
    return jsonResponse(req, { error: 'Dados de retorno do pagamento incompletos.' }, 400)
  }

  const accessHash = await sha256Hex(token)
  const { data: pedido, error: statusError } = await admin.rpc('gf_contratacao_status_por_hash', { p_acesso_hash: accessHash })
  if (statusError || !pedido || pedido.order_nsu !== orderNsu || !(await pedidoPertenceCampanha(admin, pedido, campaignSlug))) {
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
