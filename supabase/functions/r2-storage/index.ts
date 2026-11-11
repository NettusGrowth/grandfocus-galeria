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
const AUXILIARY_KEY = new RegExp('^(?:config/hero-bg-[0-9]+\\.webp|perfis/' + UUID + '/(?:foto\\.[a-z0-9]+|capa\\.[a-z0-9]+|[a-z0-9_-]+\\.webp)|escolas/' + UUID + '/(?:capa\\.[a-z0-9]+|logo\\.[a-z0-9]+|comunidade-capa\\.[a-z0-9]+)|alunos/' + UUID + '/foto\\.[a-z0-9]+|eventos-capa/' + UUID + '/capa\\.(?:jpg|jpeg|png|webp)|posts/' + UUID + '/midia-[0-9]+\\.[a-z0-9]+)$', 'i')

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
    (GALLERY_KEY.test(value) || SELECTION_KEY.test(value) || AUXILIARY_KEY.test(value))
}

function adminRole(role: unknown) {
  return role === 'admin' || role === 'super_admin'
}

function setFromIds(data: unknown): Set<string> {
  if (!Array.isArray(data)) return new Set<string>()
  return new Set(data.map((item: any) => typeof item === 'string' ? item : item?.id)
    .filter((value: unknown): value is string => typeof value === 'string')
    .map(value => value.toLowerCase()))
}

async function visibleIdSet(userDb: any, rpcName: string): Promise<Set<string> | null> {
  const { data, error } = await userDb.rpc(rpcName)
  if (error || !Array.isArray(data)) {
    console.error('r2-storage: falha na checagem de visibilidade', { rpcName, message: error?.message })
    return null
  }
  return setFromIds(data)
}

async function canReadObjectKey(
  key: string,
  isAdmin: boolean,
  visiblePaths: Set<string>,
  visibleIds: Record<string, Set<string> | null>,
  activeHeroPath: string | null,
): Promise<boolean> {
  if (isAdmin) return true
  if (GALLERY_KEY.test(key)) return visiblePaths.has(key)
  if (SELECTION_KEY.test(key)) return false
  if (key.startsWith('perfis/')) return true
  if (key.startsWith('config/hero-bg-')) return activeHeroPath === key
  const match = key.match(new RegExp('^(escolas|alunos|eventos-capa|posts)/(' + UUID + ')/', 'i'))
  if (!match) return false
  const prefix = match[1].toLowerCase()
  const id = match[2].toLowerCase()
  const ids = visibleIds[prefix === 'eventos-capa' ? 'eventos' : prefix]
  return !!ids && ids.has(id)
}

async function canUploadObjectKey(
  key: string,
  userDb: any,
  role: unknown,
  authUserId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true

  const profileMatch = key.match(new RegExp('^perfis/(' + UUID + ')/(?:foto\\.[a-z0-9]+|capa\\.[a-z0-9]+|[a-z0-9_-]+\\.webp)$', 'i'))
  if (profileMatch) {
    const targetUserId = profileMatch[1].toLowerCase()
    if (targetUserId === authUserId.toLowerCase()) return true
    if (role !== 'proprietario' && role !== 'diretor') return false

    // Existing profiles must be visible under the caller's RLS session.
    // Some account-creation screens upload the first avatar before inserting
    // the profile row, so a missing profile may stage only a brand-new key.
    const { data, error } = await userDb.from('perfis')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (error) {
      console.error('r2-storage: falha ao validar perfil de destino', error.message)
      return false
    }
    if (data) return true
    try {
      return !(await r2ObjectExists(key))
    } catch (existsError) {
      console.error('r2-storage: falha ao validar destino de perfil inexistente', String(existsError))
      return false
    }
  }

  const schoolMatch = key.match(new RegExp('^escolas/(' + UUID + ')/(?:capa\\.[a-z0-9]+|logo\\.[a-z0-9]+|comunidade-capa\\.[a-z0-9]+)$', 'i'))
  if (schoolMatch) {
    if (role !== 'proprietario' && role !== 'diretor') return false
    const targetSchoolId = schoolMatch[1].toLowerCase()
    const { data, error } = await userDb.rpc('escolas_visiveis')
    if (error || !Array.isArray(data)) {
      console.error('r2-storage: falha ao validar escola para upload', error?.message)
      return false
    }
    return data.some((item: any) => {
      const id = typeof item === 'string'
        ? item
        : (item?.id ?? item?.escolas_visiveis ?? item?.escola_id)
      return typeof id === 'string' && id.toLowerCase() === targetSchoolId
    })
  }

  const postMatch = key.match(new RegExp('^posts/(' + UUID + ')/midia-[0-9]+\\.[a-z0-9]+$', 'i'))
  if (postMatch) {
    if (role !== 'proprietario' && role !== 'diretor' && role !== 'professor') return false

    if (role === 'professor') {
      const { data: permission, error: permissionError } = await userDb.from('permissoes_extra')
        .select('user_id')
        .eq('user_id', authUserId)
        .eq('chave', 'postar_comunidade')
        .eq('valor', true)
        .maybeSingle()
      if (permissionError) {
        console.error('r2-storage: falha ao verificar permissão de publicação', permissionError.message)
        return false
      }
      if (!permission) return false
    }

    // Media may only be attached to a post authored by the caller. The row
    // must already exist, preventing uploads to arbitrary post IDs.
    const { data: post, error: postError } = await userDb.from('posts')
      .select('id')
      .eq('id', postMatch[1])
      .eq('autor_user_id', authUserId)
      .maybeSingle()
    if (postError) {
      console.error('r2-storage: falha ao validar publicação de destino', postError.message)
      return false
    }
    return !!post
  }

  // Student portraits, event covers, hero backgrounds, and selection files
  // remain restricted to admins until their write policies explicitly allow
  // another role. Read access is checked separately by canReadObjectKey.
  return false
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
    const visibleIds: Record<string, Set<string> | null> = {}
    let activeHeroPath: string | null = null
    if (!isAdmin) {
      if (keys.some((key: string) => GALLERY_KEY.test(key))) {
        // A antiga RPC devolvia >1.000 caminhos como linhas separadas.
        // O PostgREST truncava essa lista sem erro e todas as imagens
        // fora das primeiras 1.000 recebiam url:null (capas vazias).
        // Esta RPC só valida o lote pedido e devolve UMA linha text[],
        // preservando a ACL de fotos_visiveis() no banco.
        const galleryKeys = [...new Set(keys.filter((key: string) => GALLERY_KEY.test(key)))]
        const { data, error } = await userDb.rpc('storage_paths_visiveis_lote', { p_paths: galleryKeys })
        if (error || !Array.isArray(data)) {
          console.error('r2-storage: falha ao validar lote de fotos visíveis', error?.message)
          return json({ error: 'Não foi possível validar o acesso às fotos.' }, 403)
        }
        visiblePaths = new Set(data.filter((path: unknown): path is string => typeof path === 'string'))
      }
      const rpcByPrefix: Record<string, string> = { escolas: 'escolas_visiveis', alunos: 'alunos_visiveis', eventos: 'eventos_visiveis', posts: 'posts_visiveis' }
      for (const prefix of ['escolas', 'alunos', 'eventos-capa', 'posts']) {
        if (!keys.some((key: string) => key.startsWith(prefix + '/'))) continue
        const idKey = prefix === 'eventos-capa' ? 'eventos' : prefix
        visibleIds[idKey] = await visibleIdSet(userDb, rpcByPrefix[idKey])
        if (!visibleIds[idKey]) return json({ error: 'Não foi possível validar a visibilidade dos arquivos.' }, 403)
      }
      if (keys.some((key: string) => key.startsWith('config/hero-bg-'))) {
        const { data, error } = await userDb.from('app_config').select('valor').eq('chave', 'hero_bg_path').maybeSingle()
        if (error) return json({ error: 'Não foi possível validar a configuração da imagem de fundo.' }, 403)
        activeHeroPath = typeof data?.valor === 'string' ? data.valor : null
      }
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
      const authorized = await canReadObjectKey(key, isAdmin, visiblePaths, visibleIds, activeHeroPath)
      if (!authorized) return { key, url: null }
      try {
        let url: string | null = null
        try {
          if (GALLERY_KEY.test(key)) {
            // Todos os 2.425 pares foto/miniatura foram confirmados
            // existentes no R2. Evita 80 HEADs concorrentes para cada
            // pedido da grade; assinatura local é suficiente.
            url = await signR2Object(key, expiresIn, keys.length === 1 ? downloadName : null)
          } else if (await r2ObjectExists(key)) {
            // Recursos auxiliares têm histórico de migração parcial:
            // manter verificação e fallback para essas chaves.
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
    const key = body?.key
    const contentType = body?.content_type
    if (!validKey(key)) return json({ error: 'Caminho de destino inválido.' }, 400)
    if (
      typeof contentType !== 'string' ||
      contentType.length > 150 ||
      contentType.includes('\r') || contentType.includes('\n') ||
      !(contentType.startsWith('image/') || contentType === 'application/octet-stream' || contentType === 'application/pdf' || (key.startsWith('posts/') && contentType.startsWith('video/')))
    ) {
      return json({ error: 'Tipo de arquivo inválido.' }, 400)
    }
    const canUpload = await canUploadObjectKey(key, userDb, role, authUser.id, isAdmin)
    if (!canUpload) return json({ error: 'Sua conta não tem permissão para enviar este tipo de arquivo.' }, 403)
    if (!isAdmin && key.startsWith('posts/')) {
      try {
        if (await r2ObjectExists(key)) return json({ error: 'Este arquivo de publicação já existe e sua função não permite substituí-lo.' }, 403)
      } catch (error) {
        console.error('r2-storage: falha ao verificar o destino antes do upload', String(error))
        return json({ error: 'Não foi possível validar o destino de upload.' }, 503)
      }
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
