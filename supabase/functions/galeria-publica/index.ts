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
  const token = (body?.token || '').trim()
  const senha = body?.senha || null
  if (!token) return json({ error: 'Token ausente.' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: linhas, error } = await admin.rpc('galeria_publica_dados', { p_token: token, p_senha: senha })
  if (error) return json({ error: error.message.includes('Senha') ? 'Senha incorreta.' : 'Link inválido ou expirado.' }, 401)
  if (!linhas?.length) return json({ error: 'Link inválido ou expirado.' }, 401)

  // left join no SQL: evento sem foto nenhuma ainda vem como 1 linha com
  // foto_id null — não é erro, só significa "álbum vazio por enquanto".
  const primeira = linhas[0]
  const linhasComFoto = linhas.filter((l: any) => l.foto_id)

  let capaUrl = null
  if (primeira?.capa_url) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(primeira.capa_url, 3600)
    capaUrl = data?.signedUrl || null
  }

  const fotos = await Promise.all(linhasComFoto.map(async (l: any) => {
    const previewPath = l.thumb_path || l.storage_path
    const [preview, original] = await Promise.all([
      admin.storage.from(BUCKET).createSignedUrl(previewPath, 3600),
      admin.storage.from(BUCKET).createSignedUrl(l.storage_path, 3600),
    ])
    return { id: l.foto_id, url: preview.data?.signedUrl || null, urlOriginal: original.data?.signedUrl || null }
  }))

  return json({
    evento: primeira ? { nome: primeira.evento_nome, data: primeira.evento_data, capaUrl } : null,
    fotos: fotos.filter(f => f.url),
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
