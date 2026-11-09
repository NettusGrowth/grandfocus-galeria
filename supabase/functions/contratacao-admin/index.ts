import {
  corsHeaders,
  createAdminClient,
  getInfinitePayConfig,
  getContratacaoWebhookToken,
  infinitePayCheck,
  jsonResponse,
  readJson,
  safeErrorMessage,
} from '../_shared/contratacao.ts'

// Lançamento controlado: não permitir publicação/cobranças sem liberação expressa.
const REAL_PAYMENTS_ENABLED = false

const DEFAULT_CAMPAIGN_SLUG = 'entre-estacoes'
const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function requestedCampaignSlug(body: any) {
  const slug = String(body?.slug || DEFAULT_CAMPAIGN_SLUG).trim().toLowerCase()
  if (slug.length > 60 || !CAMPAIGN_SLUG_PATTERN.test(slug)) throw new Error('Endereço da contratação inválido.')
  return slug
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
      case 'listar_campanhas': return await actionListarCampanhas(req, admin)
      case 'listar_escolas': return await actionListarEscolas(req, admin)
      case 'natal_agenda': return await actionNatalAgenda(req,admin,requestedCampaignSlug(body))
      case 'natal_gerar_horarios': return await actionNatalGerarHorarios(req,admin,user.id,body,requestedCampaignSlug(body))
      case 'natal_desativar_horario': return await actionNatalDesativar(req,admin,user.id,body,requestedCampaignSlug(body))
      case 'natal_atualizar_agendamento': return await actionNatalStatus(req,admin,user.id,body,requestedCampaignSlug(body))
      case 'central_listar': return await actionCentralListar(req, admin, requestedCampaignSlug(body))
      case 'central_salvar_taxa': return await actionCentralSalvarTaxa(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'central_salvar_acompanhamento': return await actionCentralSalvarAcompanhamento(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'central_registrar_pagamento': return await actionCentralRegistrarPagamento(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'central_arquivar': return await actionCentralArquivar(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'criar_campanha': return await actionCriarCampanha(req, admin, user.id, body)
      case 'config': return await actionConfig(req, admin, requestedCampaignSlug(body))
      case 'salvar': return await actionSalvar(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'formulario_salvar': return await actionFormularioSalvar(req, admin, user.id, body, requestedCampaignSlug(body))
      case 'publicar': return await actionPublicar(req, admin, user.id, requestedCampaignSlug(body))
      case 'pausar': return await actionStatus(req, admin, user.id, 'pausado', requestedCampaignSlug(body))
      case 'encerrar': return await actionStatus(req, admin, user.id, 'encerrado', requestedCampaignSlug(body))
      case 'pedidos': return await actionPedidos(req, admin, requestedCampaignSlug(body))
      case 'detalhe': return await actionDetalhe(req, admin, body, requestedCampaignSlug(body))
      case 'reconciliar': return await actionReconciliar(req, admin, body, requestedCampaignSlug(body))
      case 'marcar_reembolsado': return await actionMarcarReembolsado(req, admin, user.id, body, requestedCampaignSlug(body))
      default: return jsonResponse(req, { error: 'Ação administrativa desconhecida.' }, 400)
    }
  } catch (error) {
    console.error('contratacao-admin: erro tratado', safeErrorMessage(error))
    return jsonResponse(req, { error: safeErrorMessage(error) || 'Não foi possível concluir a ação.' }, 400)
  }
})

// Agenda e inscrições de Natal são separadas do checkout InfinitePay.
// Somente usuários admin/super_admin chegam a estas rotas.
async function actionNatalAgenda(req:Request,admin:any,slug:string){
 if(slug!=='natal-fada-acucarada-2026')
   return jsonResponse(req,{error:'Esta agenda não pertence à campanha.'},404)
 const {data,error}=await admin.rpc('gf_natal_listar_horarios',{p_slug:slug,p_preview:true})
 if(error)return jsonResponse(req,{error:error.message||'Agenda indisponível.'},409)
 return jsonResponse(req,data||{horarios:[]})
}
async function actionNatalGerarHorarios(req:Request,admin:any,userId:string,body:any,slug:string){
 const dia=String(body?.dia||'')
 const inicio=String(body?.inicio||'')
 const fim=String(body?.fim||'')
 const duracao=Number(body?.duracao_minutos)
 if(!['2026-12-12','2026-12-13'].includes(dia)||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(inicio)||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(fim)||
    !Number.isSafeInteger(duracao)||duracao<5||duracao>90)
  return jsonResponse(req,{error:'Informe data, horários e duração válidos.'},400)
 const {data,error}=await admin.rpc('gf_natal_gerar_horarios',{
  p_slug:slug,p_dia:dia,p_inicio:inicio,p_fim:fim,p_duracao:duracao,p_usuario:userId
 })
 if(error)return jsonResponse(req,{error:error.message||'Não foi possível gerar os horários.'},409)
 return jsonResponse(req,data||{ok:true})
}
async function actionNatalDesativar(req:Request,admin:any,userId:string,body:any,slug:string){
 const id=String(body?.horario_id||'')
 if(!/^[0-9a-f-]{36}$/i.test(id))return jsonResponse(req,{error:'Horário inválido.'},400)
 const {data,error}=await admin.rpc('gf_natal_desativar_horario',{
  p_slug:slug,p_horario:id,p_usuario:userId
 })
 if(error)return jsonResponse(req,{error:error.message||'Não foi possível alterar o horário.'},409)
 return jsonResponse(req,data||{ok:true})
}
async function actionNatalStatus(req:Request,admin:any,userId:string,body:any,slug:string){
 const id=String(body?.resposta_id||'')
 const status=String(body?.status||'')
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['confirmado','cancelado'].includes(status))
  return jsonResponse(req,{error:'Informe agendamento e situação válidos.'},400)
 const {data,error}=await admin.rpc('gf_natal_atualizar_agendamento',{
  p_slug:slug,p_resposta:id,p_status:status,p_usuario:userId
 })
 if(error)return jsonResponse(req,{error:error.message||'Não foi possível atualizar o agendamento.'},409)
 return jsonResponse(req,data||{ok:true})
}

async function actionListarCampanhas(req: Request, admin: any) {
  const { data: campanhas, error } = await admin.from('gf_contratacao_eventos')
    .select('id,evento_id,escola_id,slug,nome_publico,status,data_evento,local,criado_em')
    .order('criado_em', { ascending: false })
  if (error) throw new Error('Não foi possível listar as contratações.')
  const rows = campanhas || []
  if (!rows.length) return jsonResponse(req, { campanhas: [] })
  const eventoIds = [...new Set(rows.map((item: any) => item.evento_id))]
  const escolaIds = [...new Set(rows.map((item: any) => item.escola_id))]
  const campanhaIds = rows.map((item: any) => item.id)
  const [eventosResult, escolasResult, pedidosResult] = await Promise.all([
    admin.from('eventos').select('id,nome,data').in('id', eventoIds),
    admin.from('escolas').select('id,nome,cidade').in('id', escolaIds),
    admin.from('gf_contratacao_pedidos').select('evento_contratacao_id').in('evento_contratacao_id', campanhaIds),
  ])
  if (eventosResult.error || escolasResult.error || pedidosResult.error) throw new Error('Não foi possível completar a lista de contratações.')
  const eventos = Object.fromEntries((eventosResult.data || []).map((item: any) => [item.id,item]))
  const escolas = Object.fromEntries((escolasResult.data || []).map((item: any) => [item.id,item]))
  const pedidos: Record<string,number> = {}
  for (const item of pedidosResult.data || []) pedidos[item.evento_contratacao_id]=(pedidos[item.evento_contratacao_id]||0)+1
  return jsonResponse(req,{campanhas:rows.map((item:any)=>({
    ...item,
    evento_nome:eventos[item.evento_id]?.nome||item.nome_publico,
    escola_nome:escolas[item.escola_id]?.nome||'Escola não encontrada',
    escola_cidade:escolas[item.escola_id]?.cidade||null,
    quantidade_pedidos:pedidos[item.id]||0,
    public_url:'https://galeria.grandfocus.com.br/contratar/'+item.slug+'/',
  }))})
}

async function actionListarEscolas(req: Request, admin: any) {
  const { data,error }=await admin.from('escolas').select('id,nome,cidade').order('nome',{ascending:true})
  if(error)throw new Error('Não foi possível carregar as escolas cadastradas.')
  return jsonResponse(req,{escolas:data||[]})
}

async function actionCriarCampanha(req: Request, admin: any, userId: string, body: any) {
  const nome=String(body?.evento_nome||'').trim()
  const data=String(body?.data_evento||'').trim()
  const escolaId=String(body?.escola_id||'').trim()
  const slug=String(body?.slug||'').trim().toLowerCase()
  if(nome.length<3||nome.length>120)return jsonResponse(req,{error:'Informe um nome de evento entre 3 e 120 caracteres.'},400)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data))return jsonResponse(req,{error:'Informe a data do evento.'},400)
  if(!/^[0-9a-f-]{36}$/i.test(escolaId))return jsonResponse(req,{error:'Selecione uma escola cadastrada.'},400)
  if(slug.length>60||!CAMPAIGN_SLUG_PATTERN.test(slug)||slug==='admin')return jsonResponse(req,{error:'O endereço precisa usar letras minúsculas, números e hífens.'},400)
  const {data:campanha,error}=await admin.rpc('gf_contratacao_admin_criar_campanha',{
    p_nome_evento:nome,p_data_evento:data,p_escola_id:escolaId,p_slug:slug,p_usuario_id:userId,
  })
  if(error){console.error('contratacao-admin[criar_campanha]: falha transacional',error.message);return jsonResponse(req,{error:error.message||'Não foi possível criar o evento e a contratação.'},409)}
  return jsonResponse(req,{ok:true,campanha})
}

async function getCampaign(admin: any, slug: string) {
  const {data,error}=await admin.from('gf_contratacao_eventos').select('*').eq('slug',slug).maybeSingle()
  if(error)throw new Error('Não foi possível consultar a configuração da campanha.')
  if(!data)throw new Error('Campanha não encontrada.')
  return data
}

async function actionConfig(req: Request, admin: any, slug: string) {
  const evento = await getCampaign(admin, slug)
  const { data: pacotes, error } = await admin
    .from('gf_contratacao_pacotes')
    .select('id,codigo,nome,descricao,preco_centavos,inclui_miniensaio,inclui_palco,ativo,ordem')
    .eq('evento_contratacao_id', evento.id)
    .order('ordem', { ascending: true })
  if (error) throw new Error('Não foi possível consultar os pacotes.')
  const configuredApiKey = Deno.env.get('INFINITEPAY_API_KEY')?.trim() || ''
  let configuredHandle = (Deno.env.get('INFINITEPAY_HANDLE') || '').replace(/^\$/, '').trim()
  if (!configuredHandle) {
    const { data: paymentConfig } = await admin.rpc('gf_contratacao_payment_config')
    configuredHandle = String(paymentConfig?.handle || '').replace(/^\$/, '').trim()
  }
  const handleConfigured = Boolean(configuredHandle && !/[\s$]/.test(configuredHandle))
  let webhookTokenConfigured = false
  try {
    getContratacaoWebhookToken()
    webhookTokenConfigured = true
  } catch {
    webhookTokenConfigured = false
  }
  return jsonResponse(req, {
    evento,
    pacotes: pacotes || [],
    public_url: 'https://galeria.grandfocus.com.br/contratar/' + slug + '/',
    integracao: {
      pagamentos_reais_ativados: REAL_PAYMENTS_ENABLED && Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') === 'true',
      api_key_configurada: configuredApiKey.startsWith('inchk_'),
      infinite_tag_configurada: handleConfigured,
      webhook_token_configurado: webhookTokenConfigured,
    },
  })
}

async function actionSalvar(req: Request, admin: any, userId: string, body: any, slug: string) {
  const evento=await getCampaign(admin,slug)
  if(evento.status==='publicado')return jsonResponse(req,{error:'Pause a campanha antes de editar informações que afetam a contratação.'},409)
  const input=body?.evento||{}
  const toIso=(value:unknown,label:string)=>{if(value==null||value==='')return null;const d=new Date(String(value));if(Number.isNaN(d.getTime()))throw new Error('Data ou horário inválido em '+label+'.');return d.toISOString()}
  const toInt=(value:unknown,label:string,min:number,max:number)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Valor inválido em '+label+'.');return n}
  const nullableText=(value:unknown,max:number,label:string)=>{const v=String(value??'').trim();if(v.length>max)throw new Error(label+' excede o limite de caracteres.');return v||null}
  const update={
    nome_publico:nullableText(input.nome_publico,120,'Nome público da contratação'),
    data_evento:nullableText(input.data_evento,10,'Data do evento'),
    local:nullableText(input.local,240,'Local'),
    miniensaio_inicio:toIso(input.miniensaio_inicio,'início do miniensaio'),
    miniensaio_fim:toIso(input.miniensaio_fim,'fim do miniensaio'),
    duracao_minutos:toInt(input.duracao_minutos,'duração',1,60),
    capacidade_miniensaios:input.capacidade_miniensaios===''||input.capacidade_miniensaios==null?null:toInt(input.capacidade_miniensaios,'capacidade',0,10000),
    vendas_encerram_em:toIso(input.vendas_encerram_em,'prazo de vendas'),
    reserva_minutos:toInt(input.reserva_minutos,'duração da reserva',1,60),
    prazo_entrega_dias:input.prazo_entrega_dias===''||input.prazo_entrega_dias==null?null:toInt(input.prazo_entrega_dias,'prazo de entrega',1,365),
    whatsapp_atendimento:nullableText(input.whatsapp_atendimento,30,'WhatsApp de atendimento'),
    termos_versao:nullableText(input.termos_versao,40,'Versão dos termos'),
    termos_conteudo:nullableText(input.termos_conteudo,30000,'Texto dos termos'),
    privacidade_url:nullableText(input.privacidade_url,500,'URL de privacidade'),
    privacidade_versao:nullableText(input.privacidade_versao,40,'Versão da política de privacidade'),
    privacidade_conteudo:nullableText(input.privacidade_conteudo,30000,'Texto da política de privacidade'),
    autorizacao_imagem_versao:nullableText(input.autorizacao_imagem_versao,40,'Versão da autorização de imagem'),
    autorizacao_imagem_conteudo:nullableText(input.autorizacao_imagem_conteudo,10000,'Texto de autorização de imagem'),
    fornecedor_nome:nullableText(input.fornecedor_nome,180,'Nome do fornecedor'),
    fornecedor_documento:nullableText(input.fornecedor_documento,40,'Documento do fornecedor'),
    fornecedor_endereco:nullableText(input.fornecedor_endereco,500,'Endereço do fornecedor'),
    fornecedor_email:nullableText(input.fornecedor_email,180,'E-mail do fornecedor'),
    atualizado_em:new Date().toISOString(),
  }
  if(!update.nome_publico||update.nome_publico.length<3)return jsonResponse(req,{error:'Informe o nome público da contratação.'},400)
  if(update.data_evento&&!/^\d{4}-\d{2}-\d{2}$/.test(update.data_evento))return jsonResponse(req,{error:'Informe a data do evento no formato correto.'},400)

  const pacotes=Array.isArray(body?.pacotes)?body.pacotes:[]
  if(pacotes.length>20)return jsonResponse(req,{error:'Cada campanha pode ter até 20 experiências.'},400)
  const seen=new Set<string>()
  for(const item of pacotes){
    const codigo=String(item?.codigo||'').trim().toLowerCase()
    const nome=String(item?.nome||'').trim()
    if(!CAMPAIGN_SLUG_PATTERN.test(codigo)||codigo.length>60||codigo.length<2||seen.has(codigo))return jsonResponse(req,{error:'Código interno de experiência inválido ou duplicado.'},400)
    seen.add(codigo)
    if(nome.length<2||nome.length>100)return jsonResponse(req,{error:'Cada experiência precisa ter um nome entre 2 e 100 caracteres.'},400)
    const preco=Number(item?.preco_centavos)
    if(!Number.isInteger(preco)||preco<100||preco>100000000)return jsonResponse(req,{error:'O valor de cada experiência deve ficar entre R$ 1,00 e R$ 1.000.000,00.'},400)
    if(!Array.isArray(item?.descricao)||item.descricao.length>20||item.descricao.some((line:unknown)=>typeof line!=='string'||line.length>300))return jsonResponse(req,{error:'Revise a descrição das experiências. Use até 20 linhas de 300 caracteres.'},400)
    if(typeof item?.ativo!=='boolean'||typeof item?.inclui_miniensaio!=='boolean'||typeof item?.inclui_palco!=='boolean')return jsonResponse(req,{error:'Revise a disponibilidade e os itens incluídos na experiência.'},400)
  }
  const {error:saveError}=await admin.rpc('gf_contratacao_admin_salvar_config',{p_slug:slug,p_evento:update,p_pacotes:pacotes,p_usuario_id:userId})
  if(saveError){console.error('contratacao-admin[salvar]: falha transacional',saveError.message);throw new Error('Não foi possível salvar a configuração completa. Nenhuma alteração parcial foi mantida.')}
  return await actionConfig(req,admin,slug)
}

async function actionPublicar(req: Request, admin: any, userId: string, slug: string) {
  if (!REAL_PAYMENTS_ENABLED || Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') !== 'true') {
    return jsonResponse(req, { error: 'A ativação de pagamentos reais é necessária antes de publicar a campanha.' }, 403)
  }
  try {
    await getInfinitePayConfig(admin)
    getContratacaoWebhookToken()
  } catch (error) {
    return jsonResponse(req, { error: safeErrorMessage(error) }, 409)
  }
  const { data, error } = await admin.rpc('gf_contratacao_admin_publicar', { p_slug: slug })
  if (error) return jsonResponse(req, { error: error.message }, 409)
  const evento = await getCampaign(admin, slug)
  await admin.from('gf_contratacao_auditoria').insert({
    evento_contratacao_id: evento.id,
    usuario_id: userId,
    acao: 'publicacao_confirmada_pelo_admin',
    detalhes: {},
  })
  return jsonResponse(req, { ok: true, resultado: data, evento })
}

async function actionStatus(req: Request, admin: any, userId: string, status: string, slug: string) {
  const { data, error } = await admin.rpc('gf_contratacao_admin_alterar_status', {
    p_slug: slug,
    p_status: status,
    p_usuario_id: userId,
  })
  if (error) return jsonResponse(req, { error: error.message }, 409)
  return jsonResponse(req, data || { ok: true, status })
}

async function actionPedidos(req: Request, admin: any, slug: string) {
  const evento = await getCampaign(admin, slug)
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

async function actionDetalhe(req: Request, admin: any, body: any, slug: string) {
  const evento=await getCampaign(admin,slug)
  const pedidoId = String(body?.pedido_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return jsonResponse(req, { error: 'Pedido inválido.' }, 400)

  const { data: pedido, error } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,numero,evento_contratacao_id,responsavel_nome,responsavel_whatsapp,responsavel_email,valor_total_centavos,status,reserva_status,reserva_expira_em,pagamento_confirmado_em,metodo_pagamento,parcelas,valor_pago_centavos,comprovante_path,criado_em,atualizado_em,order_nsu,checkout_url')
    .eq('id', pedidoId)
    .eq('evento_contratacao_id', evento.id)
    .maybeSingle()
  if (error || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado nesta contratação.' }, 404)

  const [participantesResult, pagamentoResult, aceiteResult, webhookResult] = await Promise.all([
    admin.from('gf_contratacao_participantes')
      .select('id,bailarina_nome,turma,idade,preco_centavos,consome_miniensaio,pacote_id')
      .eq('pedido_id', pedidoId),
    admin.from('gf_contratacao_pagamentos').select('id,provedor,order_nsu,transaction_nsu,slug,status,metodo,parcelas,valor_centavos,checkout_url,ultimo_payment_check,criado_em,atualizado_em').eq('pedido_id', pedidoId).maybeSingle(),
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
  const {data: pacotes, error: pacotesError} = await admin.from('gf_contratacao_pacotes')
    .select('id,codigo,nome').in('id', participantes.map((item: any) => item.pacote_id))
  if (pacotesError) throw new Error('Não foi possível carregar os pacotes.')

  const pacotesById = Object.fromEntries((pacotes || []).map((item: any) => [item.id, item]))

  return jsonResponse(req, {
    pedido,
    participantes: participantes.map((item: any) => ({
      ...item,
      pacote: pacotesById[item.pacote_id] || null,
    })),
    pagamento: pagamentoResult.data,
    aceite: aceiteResult.data,
    webhooks: webhookResult.data || [],
  })
}

async function actionReconciliar(req: Request, admin: any, body: any, slug: string) {
  const evento=await getCampaign(admin,slug)
  const pedidoId = String(body?.pedido_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return jsonResponse(req, { error: 'Pedido inválido.' }, 400)

  const { data: pedido, error: pedidoError } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,order_nsu,valor_total_centavos,status')
    .eq('id', pedidoId)
    .eq('evento_contratacao_id', evento.id)
    .maybeSingle()
  if (pedidoError || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado nesta contratação.' }, 404)

  const { data: pagamento, error: pagamentoError } = await admin
    .from('gf_contratacao_pagamentos')
    .select('transaction_nsu,slug')
    .eq('pedido_id', pedidoId)
    .maybeSingle()
  if (pagamentoError || !pagamento?.transaction_nsu || !pagamento?.slug) {
    return jsonResponse(req, { error: 'Ainda não há identificadores suficientes para consultar este pagamento.' }, 409)
  }

  const { data: refundEvents, error: refundEventsError } = await admin
    .from('gf_contratacao_webhook_eventos')
    .select('id,criado_em,resultado')
    .eq('order_nsu', pedido.order_nsu)
    .eq('evento_provedor', 'refunded')
    .order('criado_em', { ascending: false })
    .limit(1)
  if (refundEventsError) throw new Error('Não foi possível conferir o histórico de estornos deste pedido.')
  if (refundEvents?.length) {
    return jsonResponse(req, {
      ok: false,
      status: pedido.status,
      precisa_conferencia_manual: true,
      mensagem: 'Há uma notificação de estorno registrada para este pedido. Confirme o movimento na InfinitePay antes de qualquer nova conciliação. Se o estorno foi realizado, registre-o na ação de estorno manual.',
    }, 409)
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

async function actionMarcarReembolsado(req: Request, admin: any, userId: string, body: any, slug: string) {
  const evento=await getCampaign(admin,slug)
  const pedidoId = String(body?.pedido_id || '').trim()
  const motivo = String(body?.motivo || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId) || motivo.length < 10) {
    return jsonResponse(req, { error: 'Informe o pedido e o motivo da conferência do estorno.' }, 400)
  }

  const { data: pedido, error: pedidoError } = await admin
    .from('gf_contratacao_pedidos')
    .select('id,order_nsu')
    .eq('id', pedidoId)
    .eq('evento_contratacao_id', evento.id)
    .maybeSingle()
  if (pedidoError || !pedido) return jsonResponse(req, { error: 'Pedido não encontrado nesta contratação.' }, 404)

  const { data, error } = await admin.rpc('gf_contratacao_marcar_reembolsado', {
    p_order_nsu: pedido.order_nsu,
    p_motivo: motivo,
    p_usuario_id: userId,
  })
  if (error) return jsonResponse(req, { error: error.message }, 409)
  return jsonResponse(req, data || { ok: true, status: 'reembolsado' })
}


// Central de Respostas. Todas as ações passam pela autenticação admin/super_admin acima.
// A situação "pago" dos pedidos online continua exclusiva do webhook/payment_check
// verificado. Este painel NÃO permite alterar esse status manualmente.
async function actionCentralListar(req: Request, admin: any, slug: string) {
  const evento = await getCampaign(admin, slug)
  const [nativeResult, formsResult, followResult] = await Promise.all([
    admin.from('gf_contratacao_pedidos')
      .select('id,numero,responsavel_nome,responsavel_whatsapp,responsavel_email,valor_total_centavos,status,valor_pago_centavos,pagamento_confirmado_em,metodo_pagamento,criado_em,formulario_respostas,formulario_modelo_snapshot,arquivado_em')
      .eq('evento_contratacao_id',evento.id)
      .order('criado_em',{ascending:false}).limit(1000),
    admin.from('gf_contratacao_form_respostas')
      .select('id,origem,origem_chave,origem_linha,respondido_em,responsavel_nome,responsavel_whatsapp,email_responsavel,bailarina_nome,modalidade_original,experiencia_original,valor_informado_centavos,pagamento_preferido,pagamento_declarado,pagamento_situacao,valor_recebido_centavos,pagamento_metodo,pagamento_referencia,pagamento_observacao,pagamento_conferido_em,observacao_origem,criado_em,arquivado_em,horario_id,agendamento_status,agendamento_expira_em')
      .eq('evento_contratacao_id',evento.id)
      .order('respondido_em',{ascending:false}).limit(1000),
    admin.from('gf_contratacao_acompanhamentos')
      .select('pedido_id,resposta_form_id,situacao,proximo_contato_em,ultimo_contato_em,observacoes,atualizado_em')
      .eq('evento_contratacao_id',evento.id).limit(1000),
  ])
  if(nativeResult.error || formsResult.error || followResult.error)
    throw new Error('Não foi possível consultar os registros da central de gestão.')
  const pedidos = nativeResult.data || []
  const participantes: any[] = []
  const ids = pedidos.map((item:any)=>item.id)
  if(ids.length) {
    // Pedidos de uma mesma campanha possuem no máximo dez participantes cada.
    const {data,error}=await admin.from('gf_contratacao_participantes')
      .select('pedido_id,bailarina_nome,turma,preco_centavos,pacote_id')
      .in('pedido_id',ids).limit(10000)
    if(error) throw new Error('Não foi possível consultar as bailarinas dos pedidos.')
    participantes.push(...(data||[]))
  }
  const pacoteIds=[...new Set(participantes.map((p:any)=>p.pacote_id))]
  let pacoteMap:Record<string,string>={}
  if(pacoteIds.length) {
    const {data,error}=await admin.from('gf_contratacao_pacotes')
      .select('id,nome').in('id',pacoteIds)
    if(error)throw new Error('Não foi possível consultar os pacotes.')
    pacoteMap=Object.fromEntries((data||[]).map((p:any)=>[p.id,p.nome]))
  }
  const grouped:Record<string,any[]>={}
  for(const p of participantes) {
    (grouped[p.pedido_id] ||= []).push({
      nome:p.bailarina_nome,turma:p.turma,pacote:pacoteMap[p.pacote_id]||'Pacote cadastrado',
      preco_centavos:p.preco_centavos,
    })
  }
  const rows=pedidos.map((p:any)=>({...p,participantes:grouped[p.id]||[]}))
  return jsonResponse(req, {
    campanha:{id:evento.id,nome:evento.nome_publico,status:evento.status,
      taxa_credito_a_vista_bps:evento.taxa_credito_a_vista_bps},
    pedidos:rows,
    respostas:formsResult.data||[],
    acompanhamentos:followResult.data||[],
    limite_por_origem:1000,
    resultados_possivelmente_truncados:
      pedidos.length>=1000||(formsResult.data||[]).length>=1000||(followResult.data||[]).length>=1000,
  })
}


async function actionCentralSalvarTaxa(req:Request,admin:any,userId:string,body:any,slug:string){
  const bps=Number(body?.taxa_credito_a_vista_bps)
  if(!Number.isSafeInteger(bps)||bps<0||bps>2000){
    return jsonResponse(req,{error:'Informe uma taxa válida entre 0% e 20%.'},400)
  }
  const {data,error}=await admin.rpc('gf_contratacao_admin_salvar_taxa_liquida',{
    p_slug:slug,p_taxa_bps:bps,p_usuario_id:userId
  })
  if(error)return jsonResponse(req,{error:error.message||'Não foi possível salvar a taxa.'},409)
  return jsonResponse(req,data||{ok:true,taxa_bps:bps})
}

async function actionCentralArquivar(req:Request,admin:any,userId:string,body:any,slug:string){
  const evento=await getCampaign(admin,slug)
  const origem=String(body?.origem||'')
  const referencia=String(body?.referencia_id||'')
  const arquivar=body?.arquivar
  if(!/^[0-9a-f-]{36}$/i.test(referencia) ||
     !['formulario','online'].includes(origem) || typeof arquivar!=='boolean'){
    return jsonResponse(req,{error:'Não foi possível identificar o registro a arquivar.'},400)
  }
  const {data,error}=await admin.rpc('gf_contratacao_admin_arquivar_registro',{
    p_campanha_id:evento.id,p_origem:origem,
    p_referencia_id:referencia,p_arquivar:arquivar,p_usuario_id:userId
  })
  if(error)return jsonResponse(req,{error:error.message||'Este registro não pode ser arquivado.'},409)
  return jsonResponse(req,data||{ok:true,arquivado:arquivar})
}

async function actionCentralSalvarAcompanhamento(req:Request,admin:any,userId:string,body:any,slug:string){
  const evento=await getCampaign(admin,slug)
  const origem=String(body?.origem||'')
  const referencia=String(body?.referencia_id||'')
  const situacao=String(body?.situacao||'')
  const notas=String(body?.observacoes||'')
  const data=body?.proximo_contato_em==null||body.proximo_contato_em===''?null:String(body.proximo_contato_em)
  if(!/^[0-9a-f-]{36}$/i.test(referencia)||!['online','formulario'].includes(origem)
     ||!['nao_iniciado','contatar','aguardando_resposta','concluido','nao_precisa'].includes(situacao)
     ||notas.length>3000||(data!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(data)))
    return jsonResponse(req,{error:'Verifique a situação, a data e as observações de acompanhamento.'},400)
  const {data:resultado,error}=await admin.rpc('gf_contratacao_admin_salvar_acompanhamento',{
    p_campanha_id:evento.id,p_origem:origem,p_referencia_id:referencia,
    p_situacao:situacao,p_proximo_contato_em:data,p_observacoes:notas,
    p_registrar_contato:body?.registrar_contato===true,p_usuario_id:userId,
  })
  if(error)return jsonResponse(req,{error:error.message||'Não foi possível salvar o acompanhamento.'},400)
  return jsonResponse(req,resultado||{ok:true})
}

async function actionCentralRegistrarPagamento(req:Request,admin:any,userId:string,body:any,slug:string){
  const evento=await getCampaign(admin,slug)
  const id=String(body?.resposta_id||'')
  const situacao=String(body?.situacao||'')
  const valor=Number(body?.valor_recebido_centavos)
  const metodo=String(body?.metodo||'')
  const referencia=String(body?.referencia||'').trim()
  const observacao=String(body?.observacao||'').trim()
  if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(valor)||valor<0||valor>100000000
    ||!['nao_conferido','pendente','parcial','pago_manual','cancelado'].includes(situacao)
    ||referencia.length>180||observacao.length>1200)
    return jsonResponse(req,{error:'Verifique os dados de conferência do pagamento.'},400)
  // Pagamentos dos pedidos nativos não podem ser alterados nesta ação:
  // apenas respostas históricas do Google Forms podem ter conferência manual.
  const {data:resultado,error}=await admin.rpc('gf_contratacao_admin_registrar_pagamento_externo',{
    p_campanha_id:evento.id,p_resposta_id:id,p_situacao:situacao,
    p_valor_recebido_centavos:valor,p_metodo:metodo,
    p_referencia:referencia,p_observacao:observacao,
    p_conferencia_confirmada:body?.conferencia_confirmada===true,p_usuario_id:userId,
  })
  if(error)return jsonResponse(req,{error:error.message||'Não foi possível conferir o pagamento.'},400)
  return jsonResponse(req,resultado||{ok:true})
}

/** A cada escola/evento corresponde um modelo independente. Sem HTML arbitrário. */
function normalizeFormularioModelo(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Modelo de formulário inválido.')
  const appearance = value.aparencia || {}
  const color = String(appearance.cor || '#4B0416')
  const bg = String(appearance.fundo || '#F1EDF1')
  const hex = /^#[0-9a-f]{6}$/i
  if (!hex.test(color) || !hex.test(bg)) throw new Error('Informe cores no formato hexadecimal #RRGGBB.')
  const lightness = (value:string) => {
    const p = [1,3,5].map(i => parseInt(value.slice(i,i+2),16)/255)
      .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
    return p[0]*.2126+p[1]*.7152+p[2]*.0722
  }
  if (lightness(color) > .18 || lightness(bg) < .78)
    throw new Error('Escolha uma cor principal escura e um fundo claro para manter a leitura acessível.')
  const titulo = String(appearance.titulo || '').trim()
  const introducao = String(appearance.introducao || '').trim()
  if (titulo.length>90 || introducao.length>700) throw new Error('Título ou texto de abertura longo demais.')
  const items = value.perguntas
  if (!Array.isArray(items) || items.length>30) throw new Error('O formulário aceita até 30 perguntas extras.')
  const types = new Set(['texto','paragrafo','numero','email','telefone','data','unica','multipla','lista','sim_nao'])
  const seen = new Map<string,any>()
  const questions = items.map((item:any,index:number)=>{
    const id=String(item?.id||'')
    const titulo=String(item?.titulo||'').trim()
    const ajuda=String(item?.ajuda||'').trim()
    const tipo=String(item?.tipo||'')
    const obrigatoria=item?.obrigatoria===true
    if(!/^q_[a-z0-9]{8,40}$/.test(id)||seen.has(id))
      throw new Error('Existe uma pergunta com identificador inválido ou repetido.')
    if(!types.has(tipo) || titulo.length<3 || titulo.length>180 || ajuda.length>350)
      throw new Error('Revise o título, a descrição e o tipo de cada pergunta.')
    const raw=Array.isArray(item?.opcoes)?item.opcoes:[]
    const opcoes=['unica','multipla','lista'].includes(tipo)?raw.map((x:unknown)=>String(x).trim()):[]
    if(opcoes.length>12 || (['unica','multipla','lista'].includes(tipo)&&opcoes.length<2) ||
       opcoes.some((v:string)=>!v || v.length>100) ||
       new Set(opcoes.map((v:string)=>v.toLowerCase())).size!==opcoes.length)
      throw new Error('Perguntas de escolha precisam de 2 a 12 alternativas únicas.')
    let condicao=null
    if(item.condicao && item.condicao.pergunta_id){
      const parent=seen.get(String(item.condicao.pergunta_id))
      const chosen=String(item.condicao.valor||'')
      if(!parent || !['unica','lista','sim_nao'].includes(parent.tipo) ||
       !(parent.tipo==='sim_nao'?['Sim','Não']:parent.opcoes).includes(chosen))
        throw new Error('Uma condição só pode depender de uma pergunta anterior de escolha única.')
      condicao={pergunta_id:parent.id,valor:chosen}
    }
    const normalized={id,titulo,ajuda,tipo,obrigatoria,opcoes,condicao,ordem:index}
    seen.set(id,normalized)
    return normalized
  })
  const modelo={aparencia:{cor:color.toUpperCase(),fundo:bg.toUpperCase(),titulo,introducao},perguntas:questions}
  if(JSON.stringify(modelo).length>28000)throw new Error('O formulário ultrapassou o tamanho permitido.')
  return modelo
}
async function actionFormularioSalvar(req:Request,admin:any,userId:string,body:any,slug:string){
  const evento=await getCampaign(admin,slug)
  if(evento.status==='publicado')
    return jsonResponse(req,{error:'Pause a campanha antes de editar as perguntas.'},409)
  const modelo=normalizeFormularioModelo(body?.modelo)
  const expected=Number(body?.versao)
  if(!Number.isInteger(expected)||expected<1)
    return jsonResponse(req,{error:'Atualize o editor antes de salvar novamente.'},400)
  const {data,error}=await admin.rpc('gf_contratacao_admin_salvar_formulario',{
    p_slug:slug,p_modelo:modelo,p_versao_esperada:expected,p_usuario_id:userId
  })
  if(error) return jsonResponse(req,{error:error.message || 'Não foi possível salvar as perguntas.'},409)
  return jsonResponse(req,{ok:true,versao:data?.versao,modelo})
}
