import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const PUBLIC_ORIGIN = 'https://galeria.grandfocus.com.br'
export const PUBLIC_CAMPAIGN_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-pagina'

export function resolveSupabaseAdminKey(secretKeysJson: string | undefined, legacyServiceRoleKey: string | undefined): string {
  try {
    const keys = JSON.parse(secretKeysJson || '{}') as Record<string, unknown>
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid Supabase secret key map.')
    const preferred = typeof keys.default === 'string' ? keys.default.trim() : ''
    if (preferred) return preferred
    const fallbackSecret = Object.values(keys).find(
      (value) => typeof value === 'string' && value.trim(),
    )
    if (typeof fallbackSecret === 'string') return fallbackSecret.trim()
  } catch {
    // A chave legada continua disponível durante a transição da plataforma.
  }
  return legacyServiceRoleKey?.trim() || ''
}

/**
 * Supabase secret keys are API keys, not JWTs. supabase-js may copy its key
 * into Authorization: Bearer by default; the API gateway can reject that
 * header as an invalid JWT. Keep the key in apikey and remove only that
 * exact default bearer value. A real user JWT (used by auth.getUser(token))
 * must pass through unchanged.
 */
export function createSupabaseAdminFetch(
  apiKey: string,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  if (!apiKey.startsWith('sb_secret_')) return baseFetch

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value))

    if (headers.get('authorization') === 'Bearer ' + apiKey) {
      headers.delete('authorization')
    }

    return baseFetch(input, { ...init, headers })
  }
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  // Prefer the modern sb_secret key; use service_role only as a compatibility fallback.
  const key = resolveSupabaseAdminKey(
    Deno.env.get('SUPABASE_SECRET_KEYS'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  )

  if (!url || !key) throw new Error('Configuração administrativa do Supabase ausente.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseAdminFetch(key) },
  })
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const configured = (Deno.env.get('CONTRATACAO_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowed = new Set([PUBLIC_ORIGIN, ...configured])
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function readJson(req: Request, maxBytes = 64 * 1024) {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('Corpo da solicitação muito grande.')
  return JSON.parse(raw)
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function getInfinitePayConfig(admin: any) {
  const apiKey = Deno.env.get('INFINITEPAY_API_KEY')?.trim() || ''
  let handle = (Deno.env.get('INFINITEPAY_HANDLE') || '').replace(/^\$/, '').trim()

  if (!handle) {
    const { data, error } = await admin.rpc('gf_contratacao_payment_config')
    if (error) throw new Error('Não foi possível consultar a configuração da InfinitePay.')
    // O fluxo de seleção existente também remove o prefixo visual "$" da InfiniteTag salva.
    handle = String(data?.handle || '').replace(/^\$/, '').trim()
  }

  if (!apiKey) throw new Error('A chave INFINITEPAY_API_KEY ainda não foi configurada nos secrets do Supabase.')
  if (!apiKey.startsWith('inchk_')) throw new Error('INFINITEPAY_API_KEY não tem o formato esperado para o Checkout Integrado.')
  if (!handle) throw new Error('A InfiniteTag ainda não está configurada. Confira a configuração existente da InfinitePay ou defina INFINITEPAY_HANDLE.')
  if (/[\s$]/.test(handle)) throw new Error('A InfiniteTag contém espaços ou símbolo $. Use a tag exata sem o prefixo $.')
  return { apiKey, handle }
}


export async function infinitePayCheck(
  apiKey: string,
  handle: string,
  orderNsu: string,
  transactionNsu: string,
  slug: string,
) {
  const response = await fetch('https://api.checkout.infinitepay.io/payment_check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      handle,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error('InfinitePay payment_check respondeu HTTP ' + response.status + '.')
  return data
}

export async function registrarWebhook(
  admin: any,
  values: {
    pedido_id?: string | null
    order_nsu?: string | null
    transaction_nsu?: string | null
    evento_provedor?: string | null
    payload?: unknown
    payment_check?: unknown
    resultado: string
  },
) {
  const { error } = await admin.from('gf_contratacao_webhook_eventos').insert({
    pedido_id: values.pedido_id || null,
    order_nsu: values.order_nsu || null,
    transaction_nsu: values.transaction_nsu || null,
    evento_provedor: values.evento_provedor || null,
    payload: values.payload ?? null,
    payment_check: values.payment_check ?? null,
    resultado: values.resultado,
  })
  if (error) console.error('contratacao: falha ao registrar evento de webhook', error.message)
}

export function captureMethodToLabel(method: unknown) {
  if (method === 'pix') return 'pix'
  if (method === 'credit_card') return 'cartao'
  return null
}

export function getContratacaoWebhookToken() {
  const token = Deno.env.get('CONTRATACAO_WEBHOOK_TOKEN')?.trim() || ''
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error('Configure CONTRATACAO_WEBHOOK_TOKEN como um segredo hexadecimal de 64 caracteres no Supabase.')
  }
  return token
}

