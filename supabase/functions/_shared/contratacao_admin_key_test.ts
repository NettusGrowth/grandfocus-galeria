import { strict as assert } from 'node:assert'
import { resolveSupabaseAdminKey } from './contratacao.ts'

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
