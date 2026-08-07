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
  return json({ error: 'Ação desconhecida.' }, 400)
})

async function acaoDados(admin: any, token: string, senha: string | null) {
  const { data, error } = await admin.rpc('selecao_publica_dados', { p_token: token, p_senha: senha })
  if (error) return json({ error: mapErro(error.message) }, 401)

  const fotos = await Promise.all((data.fotos || []).map(async (f: any) => {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600)
    return { id: f.id, url: signed?.signedUrl || null }
  }))

  return json({ galeria: data.galeria, fotos: fotos.filter((f) => f.url), pedido: data.pedido, pix: data.pix })
}

async function acaoEnviar(admin: any, token: string, senha: string | null, fotoIds: string[], observacoes: string | null) {
  const { data, error } = await admin.rpc('selecao_registrar_pedido', {
    p_token: token, p_senha: senha, p_foto_ids: fotoIds, p_observacoes: observacoes,
  })
  if (error) return json({ error: mapErro(error.message) }, 401)
  return json({ pedido: data })
}

async function acaoDownload(admin: any, token: string, senha: string | null) {
  const { data, error } = await admin.rpc('selecao_download_liberado', { p_token: token, p_senha: senha })
  if (error) return json({ error: mapErro(error.message) }, 401)

  const fotos = await Promise.all((data.fotos || []).map(async (f: any) => {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(f.storage_path_alta, 3600)
    return { id: f.id, url: signed?.signedUrl || null }
  }))
  return json({ fotos: fotos.filter((f) => f.url) })
}

function mapErro(msg: string) {
  if (/senha/i.test(msg)) return 'Senha incorreta.'
  if (/liberado/i.test(msg)) return 'Ainda não liberado pelo estúdio.'
  if (/inválida/i.test(msg)) return msg
  return 'Link inválido ou expirado.'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
