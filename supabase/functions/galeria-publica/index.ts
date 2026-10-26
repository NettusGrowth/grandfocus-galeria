// Edge Function pública (sem login) — só existe pra suportar o "link
// privado" de evento/ensaio (Bloco 4). Precisa rodar com a SERVICE ROLE
// KEY (Supabase injeta automaticamente como env var quando a função é
// deployada — nunca é colocada no client) porque só ela consegue tanto
// ler os dados via galeria_publica_dados() sem estar logada quanto
// GERAR URL assinada de Storage — nenhuma das duas coisas é possível
// com uma RPC SQL pura nem com o anon key.
//
// Deploy (pelo dashboard do Supabase, sem precisar de CLI):
// Project → Edge Functions → Deploy a new function → nome "galeria-publica"
// → cole este arquivo inteiro → Deploy. Pronto, já fica acessível em
// https://<project-ref>.supabase.co/functions/v1/galeria-publica
//
// Chamado do app via fetch POST { token, senha } — ver _carregarGaleriaPublica()
// no index.html.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signR2Object } from '../_shared/r2.ts'

const BUCKET = 'fotos-grandfocus'
const R2_GALLERY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i

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
  const token = (body?.token || '').trim()
  const senha = body?.senha || null
  if (!token) return json({ error: 'Token ausente.' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: linhas, error } = await admin.rpc('galeria_publica_dados', { p_token: token, p_senha: senha })
  if (error) {
    // detalhe só no log do projeto (Edge Functions → Logs) — pro
    // visitante sempre é a mensagem genérica, mas isso é o que permite
    // diferenciar "token nunca existiu" de "expirou de verdade" na hora
    // de investigar uma reclamação de link quebrado.
    console.error('galeria-publica: RPC falhou', { token, message: error.message })
    return json({ error: error.message.includes('Senha') ? 'Senha incorreta.' : 'Link inválido ou expirado.' }, 401)
  }
  if (!linhas?.length) {
    console.error('galeria-publica: token não bateu com nenhum evento', { token })
    return json({ error: 'Link inválido ou expirado.' }, 401)
  }

  // left join no SQL: evento sem foto nenhuma ainda vem como 1 linha com
  // foto_id null — não é erro, só significa "álbum vazio por enquanto".
  const primeira = linhas[0]
  const linhasComFoto = linhas.filter((l: any) => l.foto_id)

  let capaUrl = null
  if (primeira?.capa_url) capaUrl = await assinarR2ComSeguranca(primeira.capa_url, admin)

  const fotos = await Promise.all(linhasComFoto.map(async (l: any) => {
    const previewPath = l.thumb_path || l.storage_path
    const [url, urlOriginal] = await Promise.all([
      assinarR2ComSeguranca(previewPath, admin),
      assinarR2ComSeguranca(l.storage_path, admin),
    ])
    return { id: l.foto_id, url, urlOriginal }
  }))

  return json({
    evento: primeira ? { nome: primeira.evento_nome, data: primeira.evento_data, capaUrl, capaPos: primeira.capa_pos || null } : null,
    fotos: fotos.filter(f => f.url),
  })
})

async function assinarR2ComSeguranca(key: string, admin: any): Promise<string | null> {
  try {
    // Só os objetos de foto/miniatura UUID-raiz foram migrados nesta fase.
    // Capas de evento e demais assets permanecem no bucket privado do Supabase.
    if (R2_GALLERY_KEY.test(key)) return await signR2Object(key, 3600)
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(key, 3600)
    if (error) throw error
    return data?.signedUrl || null
  } catch (e) {
    console.error('galeria-publica: falha ao assinar objeto', { key, message: String(e) })
    return null
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
