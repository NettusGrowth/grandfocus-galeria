// Edge Function pública (sem login) — suporta o módulo "Seleção de
// Fotos & Extras" (Bloco 8). Mesmo motivo de existir da galeria-publica
// (Bloco 4): só a service role consegue ler os dados via RPC sem estar
// logada E gerar signed URL de Storage, e as fotos em ALTA resolução
// NUNCA podem ter uma policy pública de storage — a única forma de
// alguém receber a URL delas é por aqui, e só depois que o pedido
// estiver com status 'liberado' (checado dentro de
// selecao_download_liberado() no banco, não confiado ao client).
//
// Deploy (pelo dashboard do Supabase, sem precisar de CLI):
// Project → Edge Functions → Deploy a new function → nome
// "selecao-publica" → cole este arquivo inteiro → Deploy.
//
// Chamado do app via fetch POST { action, token, senha, ... } — ver
// _selecaoPublicaFetch() no index.html.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'fotos-grandfocus'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  let body
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido.' }, 400) }
  const action = body?.action || 'dados'
  const token = (body?.token || '').trim()
  const senha = body?.senha || null
  if (!token) return json({ error: 'Token ausente.' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  if (action === 'dados') return await acaoDados(admin, token, senha)
  if (action === 'enviar') return await acaoEnviar(admin, token, senha, body?.foto_ids || [], body?.observacoes || null)
  if (action === 'download') return await acaoDownload(admin, token, senha)
  if (action === 'criar_pagamento') return await acaoCriarPagamento(admin, token, senha, body?.redirect_url || null)
  return json({ error: 'Ação desconhecida.' }, 400)
})

async function acaoDados(admin: any, token: string, senha: string | null) {
  const { data, error } = await admin.rpc('selecao_publica_dados', { p_token: token, p_senha: senha })
  if (error) { console.error('selecao-publica[dados]: RPC falhou', { token, message: error.message }); return json({ error: mapErro(error.message) }, 401) }

  const fotos = await Promise.all((data.fotos || []).map(async (f: any) => {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600)
    return { id: f.id, url: signed?.signedUrl || null }
  }))

  return json({ galeria: data.galeria, fotos: fotos.filter((f) => f.url), pedido: data.pedido, pix: data.pix, pagamento_automatico: !!data.pagamento_automatico })
}

// gera um link de checkout InfinitePay pro pedido já registrado (o
// cliente precisa ter chamado 'enviar' antes) — nunca expõe o handle
// pro client, só usa ele aqui dentro pra falar com a API da InfinitePay.
// A liberação de verdade só acontece quando selecao-webhook reconfirmar
// o pagamento (payment_check) e chamar selecao_liberar_pedido_automatico
// — esse endpoint só CRIA o link, não libera nada sozinho.
async function acaoCriarPagamento(admin: any, token: string, senha: string | null, redirectUrl: string | null) {
  const { data, error } = await admin.rpc('selecao_publica_dados', { p_token: token, p_senha: senha })
  if (error) { console.error('selecao-publica[criar_pagamento]: RPC dados falhou', { token, message: error.message }); return json({ error: mapErro(error.message) }, 401) }
  if (!data.pagamento_automatico) return json({ error: 'Pagamento automático não configurado pelo estúdio ainda.' }, 400)
  if (!data.pedido || !data.pedido.valor_total || data.pedido.valor_total <= 0) return json({ error: 'Envie sua seleção primeiro — não há valor extra a pagar ainda.' }, 400)

  // usa o handle que já veio junto no mesmo RPC de dados acima — evita
  // uma segunda leitura separada na tabela (era o que estava mascarando
  // esse erro: aquela leitura falhava calada, sem log, e caía na mesma
  // mensagem de "não configurado" mesmo com o handle salvo certinho).
  const handle = (data.infinitepay_handle || '').replace(/^\$/, '').trim()
  if (!handle) { console.error('selecao-publica[criar_pagamento]: infinitepay_handle vazio apesar de pagamento_automatico=true', { token }); return json({ error: 'Pagamento automático não configurado pelo estúdio ainda.' }, 400) }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const resp = await fetch('https://api.checkout.infinitepay.io/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle,
      order_nsu: data.pedido.id,
      webhook_url: `${supabaseUrl}/functions/v1/selecao-webhook`,
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      items: [{ description: `Fotos extras — ${data.galeria.titulo}`, quantity: 1, price: Math.round(data.pedido.valor_total * 100) }],
    }),
  })
  const linkData = await resp.json().catch(() => ({}))
  const checkoutUrl = linkData?.url || linkData?.payment_url || linkData?.link
  if (!resp.ok || !checkoutUrl) {
    console.error('selecao-publica[criar_pagamento]: InfinitePay /links falhou', { token, status: resp.status, linkData })
    return json({ error: `Não foi possível gerar o link de pagamento agora (código ${resp.status}). Tente de novo em instantes, ou pague pelo PIX abaixo mesmo.` }, 502)
  }
  return json({ checkout_url: checkoutUrl })
}

async function acaoEnviar(admin: any, token: string, senha: string | null, fotoIds: string[], observacoes: string | null) {
  const { data, error } = await admin.rpc('selecao_registrar_pedido', {
    p_token: token, p_senha: senha, p_foto_ids: fotoIds, p_observacoes: observacoes,
  })
  if (error) { console.error('selecao-publica[enviar]: RPC falhou', { token, message: error.message }); return json({ error: mapErro(error.message) }, 401) }
  return json({ pedido: data })
}

async function acaoDownload(admin: any, token: string, senha: string | null) {
  const { data, error } = await admin.rpc('selecao_download_liberado', { p_token: token, p_senha: senha })
  if (error) { console.error('selecao-publica[download]: RPC falhou', { token, message: error.message }); return json({ error: mapErro(error.message) }, 401) }

  const assinar = (lista: any[]) => Promise.all((lista || []).map(async (f: any) => {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(f.storage_path_alta, 3600)
    return { id: f.id, url: signed?.signedUrl || null }
  }))
  const [fotos, bastidores] = await Promise.all([assinar(data.fotos), assinar(data.bastidores)])
  return json({ fotos: fotos.filter((f) => f.url), bastidores: bastidores.filter((f) => f.url) })
}

function mapErro(msg: string) {
  if (/senha/i.test(msg)) return 'Senha incorreta.'
  if (/expirou/i.test(msg)) return msg // já vem formatada com a data pelo RPC — repassa como está
  if (/liberado/i.test(msg)) return 'Ainda não liberado pelo estúdio.'
  if (/inválida/i.test(msg)) return msg
  return 'Link inválido ou expirado.'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
