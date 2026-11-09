import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve('dist')
assert.ok(fs.existsSync(path.join(root,'contratar/entre-estacoes/index.html')), 'Página pública não foi gerada no build.')
assert.ok(fs.existsSync(path.join(root,'contratar/entre-estacoes/admin/index.html')), 'Painel administrativo não foi gerado no build.')
assert.ok(fs.existsSync(path.join(root,'contratar/admin/index.html')), 'Gerenciador de contratações não foi gerado no build.')

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' }
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname)
  if (pathname === '/__mock-checkout') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' })
    res.end('<!doctype html><html><body><h1>CHECKOUT MOCK OK</h1></body></html>')
    return
  }
  let routedPath = pathname
  if (pathname === '/contratar/admin' || pathname === '/contratar/admin/') {
    routedPath = '/contratar/admin/'
  } else if (/^\/contratar\/[^/]+\/admin\/?$/.test(pathname)) {
    routedPath = '/contratar/entre-estacoes/admin/'
  } else if (/^\/contratar\/[^/]+\/?$/.test(pathname)) {
    routedPath = '/contratar/entre-estacoes/'
  }
  let file = path.resolve(root, '.' + (routedPath.endsWith('/') ? routedPath + 'index.html' : routedPath))
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end('Forbidden'); return }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const address = server.address()
const origin = 'http://127.0.0.1:' + address.port
const browser = await chromium.launch({ headless: true })

let submitted = null
let publicApiCalls = 0
const publicCampaignSlugs = []
const campaign = {
  disponivel: true,
  evento: {
    slug:'entre-estacoes', nome_publico:'Entre Estações', escola_nome:'Studio Entrepliés',
    data_evento:'2026-11-07', local:'Teatro de Teste',
    miniensaio_inicio:'2026-11-07T20:30:00.000Z', miniensaio_fim:'2026-11-07T21:45:00.000Z',
    duracao_minutos:5, prazo_entrega_dias:20, whatsapp_atendimento:'34999999999',
    termos_versao:'1.0', termos_conteudo:'Termos de teste para validar a contratação, as condições de entrega, os valores e as responsabilidades das partes.',
    privacidade_url:'https://example.com/privacidade', privacidade_versao:'1.0',
    privacidade_conteudo:'Política de privacidade de teste com informações sobre finalidade, base legal, dados coletados, armazenamento, compartilhamento, direitos dos titulares e canal de contato.',
    fornecedor_nome:'Grand Focus Fotografia', fornecedor_documento:'12345678901',
    fornecedor_endereco:'Rua de Teste, 100, Centro', fornecedor_email:'teste@grandfocus.com.br',
    autorizacao_imagem_conteudo:null, autorizacao_imagem_versao:null
  },
  pacotes: [
    { id:'11111111-1111-4111-8111-111111111111', codigo:'miniensaio', nome:'Miniensaio no teatro', descricao:['3 fotos individuais','2 fotos com familiares','5 fotos digitais tratadas'], preco_centavos:11900, inclui_miniensaio:true, inclui_palco:false, minimo_fotos_por_coreografia:0 },
    { id:'22222222-2222-4222-8222-222222222222', codigo:'palco', nome:'Fotos de palco', descricao:['Mínimo de 10 fotos por coreografia'], preco_centavos:7900, inclui_miniensaio:false, inclui_palco:true, minimo_fotos_por_coreografia:10 },
    { id:'33333333-3333-4333-8333-333333333333', codigo:'completo', nome:'Experiência completa', descricao:['Miniensaio e fotos de palco'], preco_centavos:15900, inclui_miniensaio:true, inclui_palco:true, minimo_fotos_por_coreografia:10 }
  ]
}

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/functions/v1/contratacao-publica', async route => {
    publicApiCalls += 1
    const body = JSON.parse(route.request().postData() || '{}')
    publicCampaignSlugs.push(body.campaign_slug)
    if (body.action === 'dados') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(campaign) })
      return
    }
    if (body.action === 'contratar') {
      submitted = body
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
        checkout_url:origin + '/__mock-checkout', order_nsu:'test-order-123', valor_total_centavos:19800
      }) })
      return
    }
    await route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'Ação inesperada no teste.' }) })
  })
  await page.goto(origin + '/contratar/teste-publico/', { waitUntil:'networkidle' })
  await page.waitForSelector('#contract-form:not(.hidden)')
  assert.match(await page.locator('h1').first().textContent(), /Entre Estações/)
  assert.match(await page.locator('#event-meta').textContent(), /Teatro de Teste/)

  
  // Check reflow at elderly-friendly text sizes and device widths (WCAG 2.2 Reflow).
  const auditResponsiveLayout = async (stage) => {
    const sizes = [
      { width:320, height:568 }, { width:360, height:700 },
      { width:390, height:844 }, { width:430, height:932 },
      { width:768, height:1024 }, { width:1024, height:768 },
      { width:1440, height:900 },
    ]
    for (const viewport of sizes) {
      await page.setViewportSize(viewport)
      const metrics = await page.evaluate(() => {
        const root = document.documentElement
        const next = document.getElementById('form-next')
        const reader = document.getElementById('gf-font-toggle')
        const sampleInput = document.getElementById('responsavel-nome')
        const help = document.getElementById('gf-help-link')
        const overflow = Array.from(document.querySelectorAll('body *'))
          .filter(node => {
            const style = getComputedStyle(node)
            const bounds = node.getBoundingClientRect()
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              bounds.width > 0 && bounds.right > innerWidth + 2
          })
          .slice(0,6)
          .map(node => node.id || node.className || node.tagName)
        return {
          viewport: root.clientWidth,
          scrollWidth: root.scrollWidth,
          inputFontSize: parseFloat(getComputedStyle(sampleInput).fontSize),
          nextHeight: next.getBoundingClientRect().height,
          readerHeight: reader.getBoundingClientRect().height,
          helpHeight: help.getBoundingClientRect().height,
          helpVisible: getComputedStyle(help).display !== 'none',
          overflow,
        }
      })
      assert.ok(metrics.scrollWidth <= metrics.viewport + 1,
        stage + ' com largura ' + viewport.width + 'px apresenta rolagem horizontal: ' + JSON.stringify(metrics))
      assert.ok(metrics.inputFontSize >= 16,
        stage + ' com largura ' + viewport.width + 'px usa texto pequeno em campo: ' + JSON.stringify(metrics))
      assert.ok(metrics.nextHeight >= 48,
        stage + ' com largura ' + viewport.width + 'px apresenta botão pequeno: ' + JSON.stringify(metrics))
      assert.ok(metrics.readerHeight >= 48 && (!metrics.helpVisible || metrics.helpHeight >= 48),
        stage + ' com largura ' + viewport.width + 'px apresenta controle de ajuda pequeno: ' + JSON.stringify(metrics))
    }
    await page.setViewportSize({ width:390, height:844 })
  }
  assert.equal(await page.locator('#gf-help-link').isVisible(), true)
  assert.match(await page.locator('#gf-help-link').getAttribute('href'), /wa.me\/5534999999999/)
  await auditResponsiveLayout('apresentação')
  await page.locator('#gf-font-toggle').click()
  assert.equal(await page.locator('#gf-font-toggle').getAttribute('aria-pressed'), 'true')
  assert.ok((await page.locator('.hero-copy').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 19)
  await auditResponsiveLayout('texto ampliado')
  await page.locator('#gf-font-toggle').click()
  assert.equal(await page.locator('#gf-font-toggle').getAttribute('aria-pressed'), 'false')


  // The Google Forms-style questionnaire starts at page 1 and keeps future fields hidden.
  assert.match(await page.locator('#form-step-count').textContent(), /Página 1 de 4/)
  assert.equal(await page.locator('[data-form-step="2"]').isVisible(), false)
  assert.equal(await page.locator('#submit-order').isVisible(), false)
  await page.locator('#form-next').click()
  assert.match(await page.locator('#form-step-count').textContent(), /Página 2 de 4/)

  // Form validation must stop an incomplete request before calling the API.
  await page.locator('#form-next').click()
  assert.match(await page.locator('#form-message').textContent(), /Preencha/)
  assert.equal(await page.locator('[data-name]').nth(0).getAttribute('aria-invalid'), 'true')
  assert.equal(await page.locator('[data-name]').nth(0).evaluate(el => document.activeElement === el), true)
  assert.equal(submitted, null, 'O formulário incompleto não deve enviar uma contratação.')

  // One mini-session participant plus one stage-only participant.
  await page.locator('[data-name]').nth(0).fill('Bailarina Um')
  await page.locator('[data-class]').nth(0).fill('Intermediário')
  await page.locator('[data-package]').nth(0).selectOption('11111111-1111-4111-8111-111111111111')
  await page.locator('#add-participant').click()
  await page.locator('[data-name]').nth(1).fill('Bailarina Dois')
  await page.locator('[data-class]').nth(1).fill('Avançado')
  await page.locator('[data-package]').nth(1).selectOption('22222222-2222-4222-8222-222222222222')
  await page.locator('[data-coreo-list] input[type="text"]').fill('Valsa das Estações')
  await auditResponsiveLayout('bailarinas e coreografias')
  await page.locator('#form-next').click()
  assert.match(await page.locator('#form-step-count').textContent(), /Página 3 de 4/)
  assert.match((await page.locator('#order-total').textContent()).replace(/\s/g,''), /198,00/)
  await page.locator('#form-next').click()
  assert.equal(await page.locator('#responsavel-nome').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.locator('#responsavel-nome').evaluate(el => document.activeElement === el), true)

  await page.locator('#responsavel-nome').fill('Responsável de Teste')
  await page.locator('#responsavel-whatsapp').fill('(34) 99999-9999')
  await page.locator('#responsavel-email').fill('responsavel@example.com')
  await auditResponsiveLayout('responsável')
  await page.locator('#form-next').click()
  assert.match(await page.locator('#form-step-count').textContent(), /Página 4 de 4/)
  assert.equal(await page.locator('#submit-order').isVisible(), true)
  await page.locator('#responsavel-legal').check()
  await page.locator('#terms-accepted').check()

  // A privacy acknowledgement is mandatory and independent from the contract terms.
  await page.locator('#submit-order').click()
  assert.match(await page.locator('#form-message').textContent(), /política de privacidade/)
  assert.equal(await page.locator('#privacy-acknowledged').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.locator('#privacy-acknowledged').evaluate(el => document.activeElement === el), true)
  assert.equal(submitted, null, 'O pedido não pode ser enviado sem ciência da política de privacidade.')
  await page.locator('#privacy-acknowledged').check()
  await auditResponsiveLayout('termos e revisão')

  const widths = await page.evaluate(() => ({ viewport:document.documentElement.clientWidth, content:document.documentElement.scrollWidth }))
  assert.ok(widths.content <= widths.viewport + 1, 'A página mobile apresenta rolagem horizontal inesperada: ' + JSON.stringify(widths))

  await page.locator('#submit-order').click()
  await page.waitForURL(url => url.origin === origin && url.pathname === '/__mock-checkout', { timeout:10000 })
  assert.match(await page.locator('h1').textContent(), /CHECKOUT MOCK OK/)
  assert.ok(submitted, 'A contratação simulada não foi enviada.')
  assert.equal(submitted.responsavel.nome, 'Responsável de Teste')
  assert.equal(submitted.participantes.length, 2)
  assert.equal(submitted.participantes[0].nome, 'Bailarina Um')
  assert.equal(submitted.participantes[1].nome, 'Bailarina Dois')
  assert.equal(submitted.participantes[0].pacote_id, '11111111-1111-4111-8111-111111111111')
  assert.equal(submitted.participantes[1].coreografias[0].nome, 'Valsa das Estações')
  assert.equal(submitted.aceite.ciente_privacidade, true)
  assert.equal(submitted.company_website, '')
  assert.equal(submitted.campaign_slug, 'teste-publico')
  assert.deepEqual(publicCampaignSlugs, ['teste-publico','teste-publico'])
  assert.match(submitted.access_token, /^[a-f0-9]{64}$/)
  assert.match(submitted.idempotency_key, /^[a-f0-9-]{36}$/)
  assert.equal(publicApiCalls, 2, 'O fluxo esperado deve carregar os dados e enviar um único pedido.')
  assert.deepEqual(pageErrors, [], 'A página pública lançou erros JavaScript: ' + pageErrors.join('; '))
  await page.close()

  // Admin preview requires an authorized session, including on an unpublished campaign.
  const forbiddenPreview = await browser.newPage()
  await forbiddenPreview.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({
    status:200, contentType:'application/javascript', headers:{ 'access-control-allow-origin':'*' },
    body:'export function createClient(){return {auth:{getSession:async()=>({data:{session:null}})}}}'
  }))
  await forbiddenPreview.goto(origin + '/contratar/entre-estacoes/?preview=1', { waitUntil:'networkidle' })
  await forbiddenPreview.waitForSelector('#closed-state:not(.hidden)')
  assert.match(await forbiddenPreview.locator('#closed-message').textContent(), /administrador/)
  assert.equal(await forbiddenPreview.locator('#contract-form').isVisible(), false)
  await forbiddenPreview.close()

  const previewPage = await browser.newPage({ viewport:{ width:390, height:844 } })
  let previewPublicRequests = 0
  let previewAdminRequests = 0
  await previewPage.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({
    status:200, contentType:'application/javascript', headers:{ 'access-control-allow-origin':'*' },
    body:'export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"mock-admin-user-jwt"}}})}}}'
  }))
  await previewPage.route('**/functions/v1/contratacao-publica', route => {
    previewPublicRequests += 1
    return route.fulfill({ status:403, contentType:'application/json', body:JSON.stringify({ error:'Pagamento indisponível.' }) })
  })
  await previewPage.route('**/functions/v1/contratacao-admin', route => {
    previewAdminRequests += 1
    const headers = route.request().headers()
    const payload = JSON.parse(route.request().postData() || '{}')
    assert.equal(headers.authorization, 'Bearer mock-admin-user-jwt')
    assert.equal(payload.action, 'config')
    assert.equal(payload.slug, 'entre-estacoes')
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
      evento:campaign.evento, pacotes:campaign.pacotes.map(pkg => ({ ...pkg, ativo:true })),
    }) })
  })
  await previewPage.goto(origin + '/contratar/entre-estacoes/?preview=1', { waitUntil:'networkidle' })
  await previewPage.waitForSelector('#admin-preview-banner:not(.hidden)')
  assert.equal(await previewPage.locator('#contract-form').isVisible(), true)
  assert.equal(await previewPage.locator('#submit-order').isDisabled(), true)
  assert.equal(previewPublicRequests, 0, 'A prévia jamais pode consultar a API de contratação pública.')
  assert.equal(previewAdminRequests, 1, 'A prévia deve carregar dados apenas pela API privada autenticada.')
  await previewPage.close()

  // Admin must hide protected data from anonymous visitors and complete an authenticated mock workflow.
  const adminPage = await browser.newPage({ viewport:{ width:1280, height:900 } })
  const adminErrors = []
  const adminCalls = []
  const adminSession = { access_token:'mock-admin-user-jwt' }
  const adminEvent = {
    id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug:'entre-estacoes', nome_publico:'Entre Estações',
    escola_nome:'Studio Entrepliés', status:'rascunho', data_evento:'2026-11-07', local:'Teatro de Teste',
    miniensaio_inicio:'2026-11-07T20:30:00.000Z', miniensaio_fim:'2026-11-07T21:45:00.000Z',
    duracao_minutos:5, capacidade_miniensaios:15, vendas_encerram_em:'2026-11-06T23:00:00.000Z',
    reserva_minutos:15, prazo_entrega_dias:20, whatsapp_atendimento:'34999999999',
    fornecedor_nome:'Grand Focus Fotografia', fornecedor_documento:'11222333000181',
    fornecedor_endereco:'Rua de Teste, 100, Centro', fornecedor_email:'teste@grandfocus.com.br',
    privacidade_url:'https://example.com/privacidade', privacidade_versao:'1.0',
    privacidade_conteudo:'Política de privacidade simulada com finalidade, base legal, dados coletados, armazenamento, compartilhamento, direitos dos titulares e contato para solicitações.',
    termos_versao:'1.0',
    termos_conteudo:'Termos simulados com informações sobre os pacotes, valores, responsabilidades, entrega das fotografias e condições da contratação.',
    autorizacao_imagem_versao:null, autorizacao_imagem_conteudo:null
  }
  const adminPackages = [
    { id:'11111111-1111-4111-8111-111111111111', codigo:'miniensaio', nome:'Miniensaio no teatro', descricao:['3 fotos individuais','2 fotos com familiares'], preco_centavos:11900, inclui_miniensaio:true, inclui_palco:false, minimo_fotos_por_coreografia:0, ativo:true, ordem:1 },
    { id:'22222222-2222-4222-8222-222222222222', codigo:'palco', nome:'Fotos de palco', descricao:['Mínimo de 10 fotos por coreografia'], preco_centavos:7900, inclui_miniensaio:false, inclui_palco:true, minimo_fotos_por_coreografia:10, ativo:true, ordem:2 },
    { id:'33333333-3333-4333-8333-333333333333', codigo:'completo', nome:'Experiência completa', descricao:['Miniensaio e fotos de palco'], preco_centavos:15900, inclui_miniensaio:true, inclui_palco:true, minimo_fotos_por_coreografia:10, ativo:true, ordem:3 }
  ]
  const adminIntegration = { pagamentos_reais_ativados:false, api_key_configurada:true, infinite_tag_configurada:true, webhook_token_configurado:true }
  adminPage.on('pageerror', error => adminErrors.push(error.message))
  await adminPage.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({
    status:200,
    contentType:'application/javascript',
    headers:{ 'access-control-allow-origin':'*' },
    body:'export function createClient(){let session=null;return {auth:{getSession:async()=>({data:{session}}),signOut:async()=>{session=null;return {error:null}},signInWithPassword:async()=>{session={access_token:"mock-admin-user-jwt"};return {error:null,data:{session}}}}}}'
  }))
  await adminPage.route('**/functions/v1/contratacao-admin', async route => {
    const body = JSON.parse(route.request().postData() || '{}')
    const headers = route.request().headers()
    adminCalls.push({ action:body.action, body, authorization:headers.authorization, apikey:headers.apikey })
    if (!/^Bearer mock-admin-user-jwt$/i.test(headers.authorization || '') || !headers.apikey?.startsWith('sb_publishable_')) {
      await route.fulfill({ status:401, contentType:'application/json', body:JSON.stringify({ error:'Cabeçalhos de sessão inválidos no teste.' }) })
      return
    }
    if (body.action === 'config') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ evento:adminEvent, pacotes:adminPackages, integracao:adminIntegration }) })
      return
    }
    if (body.action === 'pedidos') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ pedidos:[] }) })
      return
    }
    if (body.action === 'salvar') {
      Object.assign(adminEvent, body.evento)
      for (const item of body.pacotes || []) {
        const pkg = adminPackages.find(value => value.codigo === item.codigo)
        if (pkg) { pkg.preco_centavos=item.preco_centavos; pkg.ativo=item.ativo }
      }
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ evento:adminEvent, pacotes:adminPackages, integracao:adminIntegration }) })
      return
    }
    if (body.action === 'publicar') {
      adminEvent.status='publicado'
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, resultado:{status:'publicado'}, evento:adminEvent }) })
      return
    }
    if (body.action === 'encerrar') {
      adminEvent.status='encerrado'
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'encerrado' }) })
      return
    }
    if (body.action === 'pausar' && adminEvent.status === 'encerrado') {
      await route.fulfill({ status:409, contentType:'application/json', body:JSON.stringify({ error:'Campanha encerrada não pode ser reaberta nem pausada.' }) })
      return
    }
    await route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'Ação administrativa inesperada no teste.' }) })
  })
  await adminPage.goto(origin + '/contratar/entre-estacoes/admin/', { waitUntil:'networkidle' })
  await adminPage.waitForSelector('#login-card:not(.hidden)')
  assert.ok(await adminPage.locator('meta[name="robots"]').getAttribute('content') === 'noindex,nofollow')
  assert.equal(await adminPage.locator('#admin-area').evaluate(el => el.classList.contains('hidden')), true)
  assert.equal(await adminPage.locator('#login-email').count(), 1)
  await adminPage.locator('#login-email').fill('admin@example.com')
  await adminPage.locator('#login-password').fill('not-a-real-password')
  await adminPage.locator('#login-button').click()
  await adminPage.waitForSelector('#admin-area:not(.hidden)')
  assert.match(await adminPage.locator('#integration-status').textContent(), /Pagamentos reais desativados/)
  assert.match(await adminPage.locator('#integration-status').textContent(), /Token do webhook configurado/)
  assert.equal(await adminPage.locator('#orders-body').textContent().then(text => /Nenhum pedido/.test(text)), true)
  await adminPage.locator('#save-button').click()
  await adminPage.waitForFunction(() => document.getElementById('admin-message')?.textContent.includes('Configuração salva'))
  const saveCall = adminCalls.find(call => call.action === 'salvar')
  assert.ok(saveCall, 'O painel administrativo não enviou a configuração.')
  assert.equal(saveCall.body.evento.privacidade_versao, '1.0')
  assert.equal(saveCall.body.evento.termos_versao, '1.0')
  assert.equal(saveCall.body.pacotes.length, 3)
  assert.equal(saveCall.body.pacotes[0].preco_centavos, 11900)
  assert.ok(saveCall.authorization.toLowerCase().includes('mock-admin-user-jwt'))
  assert.ok(saveCall.apikey.startsWith('sb_publishable_'))
  adminPage.on('dialog', dialog => dialog.accept())
  await adminPage.locator('#publish-button').click()
  await adminPage.waitForFunction(() => document.getElementById('admin-message')?.textContent.includes('Campanha publicada'))
  assert.equal(adminEvent.status, 'publicado')
  assert.match(await adminPage.locator('#campaign-status').textContent(), /publicado/)
  assert.ok(adminCalls.some(call => call.action === 'publicar'), 'O painel não chamou a ação de publicação simulada.')
  await adminPage.locator('#close-button').click()
  await adminPage.waitForFunction(() => document.getElementById('admin-message')?.textContent.includes('Status atualizado para encerrado'))
  assert.equal(adminEvent.status, 'encerrado')
  await adminPage.locator('#pause-button').click()
  await adminPage.waitForFunction(() => document.getElementById('admin-message')?.textContent.includes('não pode ser reaberta'))
  assert.equal(adminEvent.status, 'encerrado')
  assert.deepEqual(adminErrors, [], 'O painel administrativo lançou erros JavaScript: ' + adminErrors.join('; '))
  await adminPage.close()

  // O gerenciador cria o evento da galeria e a contratação em uma única ação autenticada.
  const managerPage = await browser.newPage({ viewport:{ width:1280, height:900 } })
  const managerErrors = []
  let createdCampaign = null
  managerPage.on('pageerror', error => managerErrors.push(error.message))
  await managerPage.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({
    status:200,
    contentType:'application/javascript',
    headers:{ 'access-control-allow-origin':'*' },
    body:'export function createClient(){let session=JSON.parse(localStorage.getItem("mock-admin-session")||"null");return {auth:{getSession:async()=>({data:{session}}),signOut:async()=>{session=null;localStorage.removeItem("mock-admin-session");return {error:null}},signInWithPassword:async()=>{session={access_token:"mock-admin-user-jwt"};localStorage.setItem("mock-admin-session",JSON.stringify(session));return {error:null,data:{session}}}}}}'
  }))
  await managerPage.route('**/functions/v1/contratacao-admin', async route => {
    const body = JSON.parse(route.request().postData() || '{}')
    const headers = route.request().headers()
    if (!/^Bearer mock-admin-user-jwt$/i.test(headers.authorization || '') || !headers.apikey?.startsWith('sb_publishable_')) {
      await route.fulfill({ status:401, contentType:'application/json', body:JSON.stringify({ error:'Cabeçalhos de sessão inválidos no teste.' }) })
      return
    }
    if (body.action === 'listar_escolas') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ escolas:[{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nome:'Escola Teste', cidade:'Uberaba' }] }) })
      return
    }
    if (body.action === 'listar_campanhas') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ campanhas:[{ slug:'entre-estacoes', nome_publico:'Entre Estações', evento_nome:'Entre Estações', escola_nome:'Studio Entrepliés', status:'publicado', data_evento:'2026-11-07', quantidade_pedidos:1, public_url:'https://galeria.grandfocus.com.br/contratar/entre-estacoes/' }] }) })
      return
    }
    if (body.action === 'criar_campanha') {
      createdCampaign = body
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, campanha:{ slug:body.slug } }) })
      return
    }
    if (body.action === 'config') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ evento:adminEvent, pacotes:adminPackages, integracao:adminIntegration }) })
      return
    }
    if (body.action === 'pedidos') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ pedidos:[] }) })
      return
    }
    await route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'Ação inesperada no gerenciador.' }) })
  })
  await managerPage.goto(origin + '/contratar/admin/', { waitUntil:'networkidle' })
  await managerPage.locator('#login-email').fill('admin@example.com')
  await managerPage.locator('#login-password').fill('not-a-real-password')
  await managerPage.locator('#login-button').click()
  await managerPage.waitForSelector('#manager-area:not(.hidden)')
  await managerPage.locator('#show-create-button').click()
  await managerPage.locator('#event-name').fill('Espetáculo de Teste')
  await managerPage.locator('#event-date').fill('2026-12-12')
  await managerPage.locator('#school-select').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(await managerPage.locator('#campaign-slug').inputValue(), 'espetaculo-de-teste')
  await managerPage.locator('#create-campaign-button').click()
  await managerPage.waitForURL(url => url.pathname === '/contratar/espetaculo-de-teste/admin/', { timeout:10000 })
  await managerPage.waitForTimeout(800)
  const editorState = await managerPage.evaluate(() => ({
    storedSession: localStorage.getItem('mock-admin-session'),
    adminAreaVisible: !document.getElementById('admin-area')?.classList.contains('hidden'),
    loginMessage: document.getElementById('login-message')?.textContent || '',
    loginCardVisible: !document.getElementById('login-card')?.classList.contains('hidden'),
  }))
  if (!editorState.adminAreaVisible) {
    throw new Error('O editor dinâmico não autenticou. Diagnóstico ' + JSON.stringify({ editorState, managerErrors }))
  }
  assert.equal(createdCampaign.evento_nome, 'Espetáculo de Teste')
  assert.equal(createdCampaign.data_evento, '2026-12-12')
  assert.equal(createdCampaign.escola_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(createdCampaign.slug, 'espetaculo-de-teste')
  assert.deepEqual(managerErrors, [], 'O gerenciador de contratações lançou erros JavaScript: ' + managerErrors.join('; '))
  await managerPage.close()
  // When the payment kill switch is off, the public page must remain closed.
  const closedPage = await browser.newPage({ viewport:{ width:390, height:844 } })
  await closedPage.route('**/functions/v1/contratacao-publica', async route => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.action !== 'dados') {
      await route.fulfill({ status:409, contentType:'application/json', body:JSON.stringify({ error:'A campanha está fechada.' }) })
      return
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
      disponivel:false,
      mensagem:'Esta experiência está em preparação. As contratações serão liberadas após a configuração e autorização dos pagamentos.'
    }) })
  })
  await closedPage.goto(origin + '/contratar/entre-estacoes/', { waitUntil:'networkidle' })
  await closedPage.waitForSelector('#closed-state:not(.hidden)')
  assert.equal(await closedPage.locator('#contract-form').evaluate(el => el.classList.contains('hidden')), true)
  assert.match(await closedPage.locator('#closed-message').textContent(), /em preparação/)
  await closedPage.close()

  console.log('Contratação Grand Focus E2E: formulário, checkout mock, mobile, campanha fechada, sessão admin, configuração, publicação simulada e segurança dos cabeçalhos aprovados.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
