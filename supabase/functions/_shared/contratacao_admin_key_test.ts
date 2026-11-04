import { strict as assert } from 'node:assert'
import { createSupabaseAdminFetch, resolveSupabaseAdminKey } from './contratacao.ts'

Deno.test('prioriza a chave secreta moderna default sobre a chave service_role legada', () => {
  assert.equal(resolveSupabaseAdminKey(
    JSON.stringify({ default: 'sb_secret_modern', alternate: 'sb_secret_other' }),
    'legacy-service-role',
  ), 'sb_secret_modern')
})

Deno.test('usa a primeira secret configurada se não houver a chave default', () => {
  assert.equal(resolveSupabaseAdminKey(
    JSON.stringify({ integration: 'sb_secret_integration' }),
    'legacy-service-role',
  ), 'sb_secret_integration')
})

Deno.test('usa service_role legado quando não existe secret moderno', () => {
  assert.equal(resolveSupabaseAdminKey('{}', 'legacy-service-role'), 'legacy-service-role')
  assert.equal(resolveSupabaseAdminKey(undefined, ' legacy-service-role '), 'legacy-service-role')
})

Deno.test('cai para service_role se o JSON de secrets estiver inválido', () => {
  assert.equal(resolveSupabaseAdminKey('{invalid', 'legacy-service-role'), 'legacy-service-role')
})

Deno.test('retorna vazio quando não existe nenhuma chave', () => {
  assert.equal(resolveSupabaseAdminKey('{}', undefined), '')
})

Deno.test('mantém sb_secret somente no apikey e remove seu Bearer automático', async () => {
  const captured: { headers?: Headers } = {}
  const fakeFetch: typeof fetch = async (_input, init) => {
    captured.headers = new Headers(init?.headers)
    return new Response('ok')
  }
  const secret = 'sb_secret_modern'
  const clientFetch = createSupabaseAdminFetch(secret, fakeFetch)
  await clientFetch('https://example.supabase.co/rest/v1/orders', {
    method: 'GET',
    headers: {
      apikey: secret,
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/json',
    },
  })
  assert.equal(captured.headers?.get('apikey'), secret)
  assert.equal(captured.headers?.get('authorization'), null)
  assert.equal(captured.headers?.get('content-type'), 'application/json')
})

Deno.test('preserva o JWT do usuário ao chamar auth.getUser com um cliente administrativo', async () => {
  const captured: { headers?: Headers } = {}
  const fakeFetch: typeof fetch = async (_input, init) => {
    captured.headers = new Headers(init?.headers)
    return new Response('ok')
  }
  const secret = 'sb_secret_modern'
  const userJwt = 'eyJhbGciOiJIUzI1NiJ9.user.session.signature'
  const clientFetch = createSupabaseAdminFetch(secret, fakeFetch)
  await clientFetch('https://example.supabase.co/auth/v1/user', {
    method: 'GET',
    headers: {
      apikey: secret,
      Authorization: 'Bearer ' + userJwt,
    },
  })
  assert.equal(captured.headers?.get('apikey'), secret)
  assert.equal(captured.headers?.get('authorization'), 'Bearer ' + userJwt)
})

Deno.test('mantém o transporte padrão para a chave service_role legada', () => {
  const fakeFetch: typeof fetch = async () => new Response('ok')
  assert.equal(createSupabaseAdminFetch('legacy-service-role', fakeFetch), fakeFetch)
})
