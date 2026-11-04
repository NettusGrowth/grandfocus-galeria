import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const exists = (path) => assert.ok(fs.existsSync(path), 'Arquivo obrigatório ausente: ' + path)

const migration = read('supabase/sql/080_contratacao_experiencias.sql')
const publicApi = read('supabase/functions/contratacao-publica/index.ts')
const sharedContracting = read('supabase/functions/_shared/contratacao.ts')
const webhook = read('supabase/functions/contratacao-webhook/index.ts')
const adminApi = read('supabase/functions/contratacao-admin/index.ts')
const build = read('scripts/build-gallery.cjs')
const publicPage = read('contratar/entre-estacoes/index.html')
const adminPage = read('contratar/entre-estacoes/admin/index.html')
const publicScript = read('contratar/entre-estacoes/app.js')
const adminScript = read('contratar/entre-estacoes/admin/admin.js')
const adminUi = adminScript
const e2eScript = read('scripts/e2e-contratacao.mjs')
const workflow = read('.github/workflows/edge-functions-check.yml')
const supabaseConfig = read('supabase/config.toml')
const reservationTests = read('scripts/test-fixtures/contratacao-tests.sql')

for (const path of [
  'contratar/entre-estacoes/index.html',
  'contratar/entre-estacoes/styles.css',
  'contratar/entre-estacoes/app.js',
  'contratar/entre-estacoes/admin/index.html',
  'contratar/entre-estacoes/admin/admin.js',
  'supabase/functions/_shared/contratacao.ts',
  'supabase/functions/contratacao-publica/index.ts',
  'supabase/functions/contratacao-webhook/index.ts',
  'supabase/functions/contratacao-admin/index.ts',
]) exists(path)

assert.ok(migration.includes("c8ea425b-a082-40ae-9a27-79db870f5075"), 'Migration deve apontar para o evento Entre Estações confirmado.')
assert.ok(!migration.includes("c8ea425b-a082-40ae-9a27-79db8705f075"), 'Migration contém o UUID antigo incorreto.')
for (const price of ['11900','7900','15900']) {
  assert.ok(migration.includes(price), 'Preço inicial ausente na migration: ' + price)
}
for (const rpc of [
  'gf_contratacao_criar_reserva',
  'gf_contratacao_registrar_checkout',
  'gf_contratacao_confirmar_pagamento',
  'gf_contratacao_marcar_conciliacao',
  'gf_contratacao_admin_publicar',
  'gf_contratacao_admin_alterar_status',
  'gf_contratacao_admin_salvar_config',
  'gf_contratacao_registrar_tentativa',
]) assert.ok(migration.includes(rpc), 'RPC obrigatória ausente: ' + rpc)

assert.ok(migration.includes('enable row level security'), 'Tabelas precisam de RLS.')
assert.ok(migration.includes('from public, anon, authenticated'), 'Tabelas privadas precisam revogar acesso público.')
assert.ok(migration.includes('privacidade_sha256'), 'O aceite deve preservar a versão da política de privacidade.')
assert.ok(migration.includes('duracao_minutos * v_evento.capacidade_miniensaios'), 'A capacidade precisa caber no período de miniensaio.')
assert.ok(migration.includes('v_vagas_ocupadas > v_evento.capacidade_miniensaios'), 'A publicação não pode reduzir a capacidade abaixo das vagas já ocupadas.')
assert.ok(migration.includes("v_evento.status = 'encerrado'") && migration.includes('não pode ser reaberta'), 'Uma campanha encerrada não pode voltar a ser publicada.')
assert.ok(migration.includes('gf_contratacao_admin_alterar_status') && adminApi.includes('gf_contratacao_admin_alterar_status'), 'O status precisa mudar por RPC transacional e impedir reabertura depois de encerrar.')
assert.ok(reservationTests.includes('A segunda vaga deveria ser reservada') && reservationTests.includes('capacidade informada é menor'), 'O PostgreSQL precisa testar a proteção contra redução da capacidade.')
assert.ok(publicApi.includes("CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS") && publicApi.includes("!== 'true'"), 'Checkout real precisa permanecer bloqueado por padrão.')
assert.ok(publicApi.includes('single_payment: true'), 'Checkout deve aceitar somente um pagamento.')
assert.ok(publicApi.includes('valid_until:'), 'Checkout precisa ter validade.')
assert.ok(publicApi.includes('X-Api-Key'), 'A criação do link precisa usar a API Key no servidor.')
assert.ok(read('supabase/functions/_shared/infinitepay_checkout.ts').includes("parsed.hostname === 'checkout.infinitepay.com.br'"), 'A validação precisa aceitar o host oficial retornado pelo Checkout Integrado.')
assert.ok(read('supabase/functions/_shared/infinitepay_checkout_test.ts').includes('Deno.test'), 'A allowlist do checkout precisa de testes unitários.')
assert.ok(publicApi.includes('gf_contratacao_registrar_tentativa'), 'A contratação precisa aplicar limites de tentativas.')
assert.ok(sharedContracting.includes('resolveSupabaseAdminKey'), 'A função deve priorizar o secret key moderno e manter fallback para service_role.')
assert.ok(sharedContracting.includes('createSupabaseAdminFetch'), 'Chaves secret modernas precisam ser enviadas sem Bearer de API key.')
assert.ok(read('supabase/functions/_shared/contratacao_admin_key_test.ts').includes('Deno.test'), 'A resolução de chaves administrativas precisa de testes unitários.')
assert.ok(publicApi.includes('customer:'), 'O checkout deve receber os dados do responsável para pré-preenchimento.')
assert.ok(publicApi.includes('company_website'), 'O endpoint deve validar o campo honeypot.')
assert.ok(webhook.includes('gf_contratacao_confirmar_pagamento'), 'Webhook deve confirmar o pagamento via RPC própria.')
assert.ok(webhook.includes('infinitePayCheck'), 'Webhook deve consultar payment_check.')
assert.ok(publicApi.includes("events: ['paid','settled']"), 'Webhook automático deve assinar somente eventos que confirmam pagamento.')
assert.ok(!publicApi.includes("events: ['paid','settled','refunded','canceled','payment_failed']"), 'Webhook não pode inscrever eventos sem discriminador de tipo no payload publicado.')
assert.ok(webhook.includes("eventType === 'refunded'"), 'Estornos notificados devem seguir fluxo de conciliação manual.')
assert.ok(adminApi.includes("evento_provedor', 'refunded'"), 'A conciliação automática deve parar diante de uma notificação de estorno.')
assert.ok(migration.includes("não corresponde à resposta validada da InfinitePay"), 'A RPC de pagamento precisa conferir os valores contra payment_check.')
assert.ok(webhook.includes('normalizeInfinitePayEventType'), 'Webhook deve normalizar eventos do corpo e dos cabeçalhos.')
assert.ok(webhook.includes('constantTimeTokenMatch'), 'Webhook deve exigir um token secreto antes de acessar o banco.')
assert.ok(publicApi.includes('getContratacaoWebhookToken()') && sharedContracting.includes('CONTRATACAO_WEBHOOK_TOKEN'), 'Checkout só pode ser criado quando o token do webhook estiver configurado no helper servidor.')
assert.ok(webhook.includes('shouldRetryInfinitePayPaymentCheck'), 'Webhook deve aplicar política de tentativas em pagamentos sem confirmação.')
assert.ok(read('supabase/functions/_shared/infinitepay_webhook_test.ts').includes('Deno.test'), 'A política do webhook deve ter testes unitários.')
assert.ok(webhook.includes('payment_check_nao_validou_identificadores'), 'Webhook não pode alterar pedidos com notificações não validadas.')
assert.ok(webhook.includes("eventType === 'canceled' || eventType === 'payment_failed'"), 'Cancelamentos e falhas precisam ser tratados após payment_check.')
assert.ok(supabaseConfig.includes('[functions.contratacao-publica]\nverify_jwt = false'), 'A API pública precisa aceitar chamadas com a chave pública sem JWT.')
assert.ok(supabaseConfig.includes('[functions.contratacao-webhook]\nverify_jwt = false'), 'O webhook usa token próprio e não pode exigir JWT Supabase.')
assert.ok(supabaseConfig.includes('[functions.contratacao-admin]\nverify_jwt = true'), 'O painel administrativo precisa manter verificação JWT.')
assert.ok(adminApi.includes("['admin', 'super_admin']"), 'Admin API precisa validar o perfil.')
assert.ok(adminApi.includes('getContratacaoWebhookToken()'), 'A publicação precisa exigir o segredo do webhook.')
assert.ok(adminUi.includes('webhook_token_configurado'), 'O painel precisa mostrar o estado do token do webhook.')
assert.ok(adminApi.includes('gf_contratacao_admin_salvar_config'), 'A configuração administrativa deve ser salva atomicamente.')
assert.ok(!adminApi.includes('acesso_publico_hash'), 'O painel não deve expor hashes privados do pedido.')
assert.ok(build.includes("copyTree(contractingPages"), 'Build precisa copiar a rota de contratação.')
assert.ok(publicPage.includes('./app.js'), 'Página pública precisa carregar seu script isolado.')
assert.ok(publicPage.includes('privacy-acknowledged'), 'A ciência da política de privacidade deve ser separada do aceite dos termos.')
assert.ok(publicPage.includes('company-website'), 'O formulário deve conter o campo honeypot.')
assert.ok(adminPage.includes('./admin.js'), 'Painel precisa carregar seu script isolado.')
assert.ok(!publicScript.includes('INFINITEPAY_API_KEY'), 'API Key não pode aparecer no JavaScript público.')
assert.ok(!adminScript.includes('INFINITEPAY_API_KEY'), 'API Key não pode aparecer no painel público.')
assert.ok(e2eScript.includes('CHECKOUT MOCK OK'), 'O teste de navegador precisa simular o checkout sem cobrança real.')
assert.ok(e2eScript.includes("call.action === 'publicar'"), 'O teste de navegador precisa validar a publicação simulada no painel.')
assert.ok(e2eScript.includes('mock-admin-user-jwt'), 'O teste de navegador precisa validar o cabeçalho de sessão do administrador.')
assert.ok(workflow.includes('node scripts/e2e-contratacao.mjs'), 'O CI precisa executar os testes de navegador.')

console.log('Contratação Grand Focus: verificações estruturais aprovadas.')
