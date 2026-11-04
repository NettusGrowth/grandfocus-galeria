import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const exists = (path) => assert.ok(fs.existsSync(path), 'Arquivo obrigatório ausente: ' + path)

const migration = read('supabase/sql/080_contratacao_experiencias.sql')
const dynamicMigration = read('supabase/sql/083_contratacao_gerenciador_dinamico.sql')
const publicApi = read('supabase/functions/contratacao-publica/index.ts')
const sharedContracting = read('supabase/functions/_shared/contratacao.ts')
const webhook = read('supabase/functions/contratacao-webhook/index.ts')
const adminApi = read('supabase/functions/contratacao-admin/index.ts')
const build = read('scripts/build-gallery.cjs')
const publicPage = read('contratar/entre-estacoes/index.html')
const adminPage = read('contratar/entre-estacoes/admin/index.html')
const managerPage = read('contratar/admin/index.html')
const managerScript = read('contratar/admin/manager.js')
const galleryAdminPage = read('index.html')
const vercelConfig = read('vercel.json')
const workflow = read('.github/workflows/edge-functions-check.yml')
const publicScript = read('contratar/entre-estacoes/app.js')
const adminScript = read('contratar/entre-estacoes/admin/admin.js')
const adminUi = adminScript
const e2eScript = read('scripts/e2e-contratacao.mjs')
const supabaseConfig = read('supabase/config.toml')
const reservationTests = read('scripts/test-fixtures/contratacao-tests.sql')

assert.ok(fs.existsSync('assets/grand-focus-assinatura-ouro.png'), 'A assinatura oficial da Grand Focus precisa existir nos assets.')
assert.ok(publicPage.includes('package-overview-list'), 'A página deve apresentar as experiências antes da escolha.')
assert.ok(publicScript.includes('function renderPackageOverview'), 'A página deve montar a apresentação das experiências a partir dos dados do banco.')
assert.ok(adminPage.includes('grand-focus-assinatura-ouro.png'), 'A administração deve usar a assinatura oficial da marca.')
assert.ok(managerPage.includes('id="new-campaign-form"') && managerPage.includes('id="school-select"'), 'O gerenciador deve criar evento e contratação no mesmo formulário.')
assert.ok(managerPage.includes('grand-focus-assinatura-ouro.png'), 'O gerenciador deve usar a assinatura oficial da marca.')
assert.ok(managerScript.includes("adminRequest('criar_campanha'") && managerScript.includes('grandfocus:contratacao-event-created'), 'O gerenciador deve criar a campanha e sinalizar a galeria para atualizar os eventos.')
assert.ok(galleryAdminPage.includes('data-tab="contratacoes"') && galleryAdminPage.includes('src="/contratar/admin/"'), 'O gerenciador deve estar integrado ao menu administrativo da galeria.')
assert.ok(vercelConfig.includes('/contratar/:slug/admin') && vercelConfig.includes('/contratar/:slug/'), 'As rotas públicas e administrativas precisam aceitar slugs dinâmicos.')

for (const path of [
  'contratar/entre-estacoes/index.html',
  'contratar/entre-estacoes/styles.css',
  'contratar/entre-estacoes/app.js',
  'contratar/entre-estacoes/admin/index.html',
  'contratar/entre-estacoes/admin/admin.js',
  'contratar/admin/index.html',
  'contratar/admin/manager.js',
  'supabase/sql/083_contratacao_gerenciador_dinamico.sql',
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
assert.ok(migration.includes('least(\n      now() + make_interval(mins => v_evento.reserva_minutos),\n      v_evento.vendas_encerram_em'), 'A reserva temporária não pode ultrapassar o encerramento das vendas.')
assert.ok(reservationTests.includes('A reserva temporária ultrapassou o encerramento das vendas.'), 'O PostgreSQL precisa testar o limite temporal da reserva.')
assert.ok(migration.includes("v_evento.status = 'encerrado'") && migration.includes('não pode ser reaberta'), 'Uma campanha encerrada não pode voltar a ser publicada.')
assert.ok(migration.includes('gf_contratacao_admin_alterar_status') && adminApi.includes('gf_contratacao_admin_alterar_status'), 'O status precisa mudar por RPC transacional e impedir reabertura depois de encerrar.')
assert.ok(reservationTests.includes('A segunda vaga deveria ser reservada') && reservationTests.includes('capacidade informada é menor'), 'O PostgreSQL precisa testar a proteção contra redução da capacidade.')
assert.ok(publicApi.includes("CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS") && publicApi.includes("!== 'true'"), 'Checkout real precisa permanecer bloqueado por padrão.')
assert.ok(adminApi.includes("pagamentos_reais_ativados: Deno.env.get('CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS') === 'true'"), 'O painel deve mostrar o estado real do bloqueio de pagamentos.')
assert.ok(publicApi.includes('provider_message') && publicApi.includes('checkout_host_ok'), 'Falhas de checkout precisam registrar diagnóstico seguro da resposta do provedor.')
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
assert.ok(adminPage.includes('id="campaign-name"') && adminPage.includes('id="add-package-button"'), 'O editor precisa permitir nome próprio e experiências dinâmicas.')
assert.ok(adminScript.includes('createPackageCode') && adminScript.includes('inclui_miniensaio') && adminScript.includes('inclui_palco'), 'O editor deve configurar experiências diferentes e seus itens incluídos.')
assert.ok(dynamicMigration.includes('gf_contratacao_admin_criar_campanha') && dynamicMigration.includes('campanha_criada_com_evento'), 'A migration deve criar o evento da galeria e a contratação em uma transação.')
assert.ok(dynamicMigration.includes('on conflict (evento_contratacao_id,codigo) do update'), 'A migration deve salvar experiências configuráveis.')
assert.ok(dynamicMigration.includes('v_campanha_tem_mini') && dynamicMigration.includes('if v_tem_mini and v_evento.capacidade_miniensaios is not null'), 'Campanhas sem miniensaio não devem exigir horários ou capacidade de miniensaio.')
assert.ok(!dynamicMigration.includes('or v_evento.fornecedor_endereco is null') && dynamicMigration.includes('v_evento.prazo_entrega_dias is not null'), 'A migration deve preservar endereço do fornecedor e prazo de entrega opcionais.')
assert.ok(adminApi.includes('listar_campanhas') && adminApi.includes('listar_escolas') && adminApi.includes('criar_campanha'), 'A API administrativa deve listar e criar campanhas.')
assert.ok(adminApi.includes(".eq('evento_contratacao_id', evento.id)"), 'Detalhes e ações de pedidos devem ficar limitados à campanha selecionada.')
assert.ok(publicApi.includes('campaign_slug') && publicApi.includes('PUBLIC_ORIGIN + \'/contratar/\' + campaignSlug'), 'A API pública deve resolver a campanha pelo slug da URL.')
assert.ok(!publicApi.includes("const CAMPAIGN_SLUG = 'entre-estacoes'"), 'A API pública não pode permanecer presa a uma campanha única.')
assert.ok(e2eScript.includes('managerPage') && e2eScript.includes('createdCampaign') && e2eScript.includes('campaign_slug'), 'O teste de navegador deve validar criação do evento/contratação e slug dinâmico.')
assert.ok(build.includes('contractingManagerScript'), 'O build precisa verificar a página do gerenciador.')
assert.ok(workflow.includes('supabase/sql/081_contratacao_sem_limite_e_prazo_opcional.sql') && workflow.includes('supabase/sql/082_contratacao_endereco_fornecedor_opcional.sql') && workflow.includes('supabase/sql/083_contratacao_gerenciador_dinamico.sql'), 'O CI deve aplicar todas as migrations na ordem antes dos testes de banco.')
assert.ok(reservationTests.includes('somente-palco') && reservationTests.includes('reserva_status') && reservationTests.includes('gf_contratacao_admin_criar_campanha'), 'Os testes SQL devem validar a criação conjunta e a campanha sem miniensaio.')
assert.ok(adminPage.includes('noindex,nofollow'), 'O painel administrativo não deve ser indexado por mecanismos de busca.')
assert.ok(adminScript.includes('Encerrar definitivamente a campanha') && adminScript.includes('não poderá ser desfeita'), 'O painel precisa avisar que encerrar é definitivo.')
assert.ok(!publicScript.includes('INFINITEPAY_API_KEY'), 'API Key não pode aparecer no JavaScript público.')
assert.ok(!adminScript.includes('INFINITEPAY_API_KEY'), 'API Key não pode aparecer no painel público.')
assert.ok(e2eScript.includes('CHECKOUT MOCK OK'), 'O teste de navegador precisa simular o checkout sem cobrança real.')
assert.ok(e2eScript.includes("call.action === 'publicar'"), 'O teste de navegador precisa validar a publicação simulada no painel.')
assert.ok(e2eScript.includes('mock-admin-user-jwt'), 'O teste de navegador precisa validar o cabeçalho de sessão do administrador.')
assert.ok(workflow.includes('node scripts/e2e-contratacao.mjs'), 'O CI precisa executar os testes de navegador.')

console.log('Contratação Grand Focus: verificações estruturais aprovadas.')
