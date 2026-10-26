// Authenticated storage adapter for gallery objects migrated to Cloudflare R2.
// Only the main gallery photos and selection-photo objects are handled here.
// Other small assets continue to use the existing Supabase Storage policies.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signR2Object, signR2Upload, deleteR2Objects, r2ObjectExists } from '../_shared/r2.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const GALLERY_KEY = new RegExp('^' + UUID + '/[^/]+$', 'i')
const SELECTION_KEY = new RegExp('^selecoes/' + UUID + '/[^/]+$', 'i')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith('/') &&
    !value.split('/').some((part) => part === '.' || part === '..') &&
    (GALLERY_KEY.test(value) || SELECTION_KEY.test(value))
}

function adminRole(role: unknown) {
  return role === 'admin' || role === 'super_admin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido.' }, 400) }

  const authHeader = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+\S+/i.test(authHeader)) {
    return json({ error: 'Sessão necessária.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    console.error('r2-storage: configuração Supabase ausente')
    return json({ error: 'Serviço temporariamente indisponível.' }, 500)
  }

  // This client carries the caller's JWT, so role and visibility checks run
  // under the same identity as the old Storage RLS policies.
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Pass the bearer token explicitly: this client has persistSession:false
  // and intentionally has no browser/local session to fall back to.
  const accessToken = authHeader.replace(/^Bearer\s+/i, '')
  // Validate the token directly with Supabase Auth REST, avoiding ambiguity
  // in Auth SDK session resolution for tokens already accepted by the gateway.
  let authUser: any = null
  try {
    const authResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    })
    if (!authResp.ok) {
      const detail = (await authResp.text()).slice(0, 240)
      console.error('r2-storage: bearer validation failed', { status: authResp.status, detail })
      return json({ error: 'Sessão inválida ou expirada.' }, 401)
    }
    authUser = await authResp.json()
  } catch (error) {
    console.error('r2-storage: bearer validation unavailable', String(error))
    return json({ error: 'Não foi possível validar sua sessão agora.' }, 503)
  }
  if (!authUser?.id) return json({ error: 'Sessão inválida ou expirada.' }, 401)

  const { data: perfis, error: perfilError } = await userDb.rpc('meu_perfil')
  if (perfilError) {
    console.error('r2-storage: falha ao verificar perfil', perfilError.message)
    return json({ error: 'Não foi possível validar as permissões.' }, 403)
  }
  const role = Array.isArray(perfis) ? perfis[0]?.role : (perfis as any)?.role
  const isAdmin = adminRole(role)
  const action = body?.action

  if (action === 'sign') {
    const keys = body?.keys
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 80) {
      return json({ error: 'Envie de 1 a 80 caminhos por lote.' }, 400)
    }
    if (keys.some((key: unknown) => !validKey(key))) {
      return json({ error: 'Um ou mais caminhos de imagem são inválidos.' }, 400)
    }

    let visiblePaths = new Set<string>()
    if (!isAdmin) {
      const { data, error } = await userDb.rpc('storage_paths_visiveis')
      if (error || !Array.isArray(data)) {
        console.error('r2-storage: falha ao validar fotos visíveis', error?.message)
        return json({ error: 'Não foi possível validar o acesso às fotos.' }, 403)
      }
      visiblePaths = new Set(data.filter((path: unknown): path is string => typeof path === 'string'))
    }

    const expiresInRaw = Number(body?.expires_in)
    const expiresIn = Number.isFinite(expiresInRaw)
      ? Math.min(86400, Math.max(60, Math.floor(expiresInRaw)))
      : 300
    const downloadName = typeof body?.download_name === 'string'
      ? body.download_name.replaceAll('\r', '').replaceAll('\n', '').replaceAll('"', '').replaceAll('\\', '').slice(0, 180)
      : null

    const urls = await Promise.all(keys.map(async (key: string) => {
      // Selection originals/previews remain admin-only in the management UI.
      const authorized = isAdmin || (GALLERY_KEY.test(key) && visiblePaths.has(key))
      if (!authorized) return { key, url: null }
      try {
        let url: string | null = null
        try {
          if (await r2ObjectExists(key)) {
            url = await signR2Object(key, expiresIn, keys.length === 1 ? downloadName : null)
          }
        } catch (r2Error) {
          console.warn('r2-storage: R2 lookup failed; trying Supabase fallback', { key, message: String(r2Error) })
        }
        if (!url) {
          const options = keys.length === 1 && downloadName ? { download: downloadName } : undefined
          const { data, error } = await userDb.storage.from('fotos-grandfocus').createSignedUrl(key, expiresIn, options)
          if (error) throw error
          url = data?.signedUrl || null
        }
        return { key, url }
      } catch (error) {
        console.error('r2-storage: falha ao assinar objeto', { key, message: String(error) })
        return { key, url: null }
      }
    }))
    return json({ urls })
  }

  if (action === 'upload-url') {
    if (!isAdmin) return json({ error: 'Somente administradores podem enviar fotos.' }, 403)
    const key = body?.key
    const contentType = body?.content_type
    if (!validKey(key)) return json({ error: 'Caminho de destino inválido.' }, 400)
    if (
      typeof contentType !== 'string' ||
      contentType.length > 150 ||
      (contentType.includes('\r') || contentType.includes('\n')) ||
      !(contentType.startsWith('image/') || contentType === 'application/octet-stream')
    ) {
      return json({ error: 'Tipo de arquivo inválido.' }, 400)
    }
    try {
      const uploadUrl = await signR2Upload(key, contentType, 300)
      return json({ upload_url: uploadUrl, key })
    } catch (error) {
      console.error('r2-storage: falha ao gerar URL de upload', String(error))
      return json({ error: 'Não foi possível preparar o envio da foto.' }, 500)
    }
  }

  if (action === 'delete') {
    if (!isAdmin) return json({ error: 'Somente administradores podem apagar fotos.' }, 403)
    const keys = body?.keys
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) {
      return json({ error: 'Envie de 1 a 100 caminhos por lote.' }, 400)
    }
    if (keys.some((key: unknown) => !validKey(key))) {
      return json({ error: 'Um ou mais caminhos para apagar são inválidos.' }, 400)
    }
    try {
      await deleteR2Objects([...new Set(keys as string[])])
      return json({ deleted: [...new Set(keys as string[])].length })
    } catch (error) {
      console.error('r2-storage: falha ao apagar objetos', String(error))
      return json({ error: 'Não foi possível apagar um ou mais objetos.' }, 500)
    }
  }

  return json({ error: 'Ação desconhecida.' }, 400)
})
