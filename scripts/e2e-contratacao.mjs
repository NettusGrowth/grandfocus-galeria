import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve('dist')
assert.ok(fs.existsSync(path.join(root,'contratar/entre-estacoes/index.html')), 'Página pública não foi gerada no build.')
assert.ok(fs.existsSync(path.join(root,'contratar/entre-estacoes/admin/index.html')), 'Painel administrativo não foi gerado no build.')

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' }
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname)
  if (pathname === '/__mock-checkout') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' })
    res.end('<!doctype html><html><body><h1>CHECKOUT MOCK OK</h1></body></html>')
    return
  }
  let file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
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
    { id:'33333333-3333-4333-8333-333333333333', codigo:'completo', nome:'Pacote completo', descricao:['Miniensaio e fotos de palco'], preco_centavos:15900, inclui_miniensaio:true, inclui_palco:true, minimo_fotos_por_coreografia:10 }
  ]
}

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/functions/v1/contratacao-publica', async route => {
    publicApiCalls += 1
    const body = JSON.parse(route.request().postData() || '{}')
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
  await page.goto(origin + '/contratar/entre-estacoes/', { waitUntil:'networkidle' })
  await page.waitForSelector('#contract-form:not(.hidden)')
  assert.match(await page.locator('h1').first().textContent(), /Entre Estações/)
  assert.match(await page.locator('#event-meta').textContent(), /Teatro de Teste/)

  // Form validation must stop an incomplete request before calling the API.
  await page.locator('#submit-order').click()
  assert.match(await page.locator('#form-message').textContent(), /Preencha/)
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
  assert.match((await page.locator('#order-total').textContent()).replace(/\s/g,''), /198,00/)

  await page.locator('#responsavel-nome').fill('Responsável de Teste')
  await page.locator('#responsavel-whatsapp').fill('(34) 99999-9999')
  await page.locator('#responsavel-email').fill('responsavel@example.com')
  await page.locator('#responsavel-legal').check()
  await page.locator('#terms-accepted').check()
  await page.locator('#privacy-acknowledged').check()

  const widths = await page.evaluate(() => ({ viewport:document.documentElement.clientWidth, content:document.documentElement.scrollWidth }))
  assert.ok(widths.content <= widths.viewport + 1, 'A página mobile apresenta rolagem horizontal inesperada: ' + JSON.stringify(widths))

  await page.locator('#submit-order').click()
  await page.waitForURL(url => url.origin === origin && url.pathname === '/__mock-checkout', { timeout:10000 })
  assert.match(await page.locator('h1').textContent(), /CHECKOUT MOCK OK/)
  assert.ok(submitted, 'A contratação simulada não foi enviada.')
  assert.equal(submitted.responsavel.nome, 'Responsável de Teste')
  assert.equal(submitted.participantes.length, 2)
  assert.equal(submitted.participantes[0].pacote_id, '11111111-1111-4111-8111-111111111111')
  assert.equal(submitted.participantes[1].coreografias[0].nome, 'Valsa das Estações')
  assert.equal(submitted.aceite.ciente_privacidade, true)
  assert.equal(submitted.company_website, '')
  assert.match(submitted.access_token, /^[a-f0-9]{64}$/)
  assert.match(submitted.idempotency_key, /^[a-f0-9-]{36}$/)
  assert.equal(publicApiCalls, 2, 'O fluxo esperado deve carregar os dados e enviar um único pedido.')
  assert.deepEqual(pageErrors, [], 'A página pública lançou erros JavaScript: ' + pageErrors.join('; '))
  await page.close()

  // Admin route must render its login gate without exposing the panel to an anonymous visitor.
  const adminPage = await browser.newPage({ viewport:{ width:1280, height:900 } })
  const adminErrors = []
  adminPage.on('pageerror', error => adminErrors.push(error.message))
  await adminPage.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({
    status:200,
    contentType:'application/javascript',
    headers:{ 'access-control-allow-origin':'*' },
    body:`export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null}),signInWithPassword:async()=>({error:new Error('mock')})}}}`
  }))
  await adminPage.goto(origin + '/contratar/entre-estacoes/admin/', { waitUntil:'networkidle' })
  await adminPage.waitForSelector('#login-card:not(.hidden)')
  assert.equal(await adminPage.locator('#admin-area').evaluate(el => el.classList.contains('hidden')), true)
  assert.equal(await adminPage.locator('#login-email').count(), 1)
  assert.deepEqual(adminErrors, [], 'O painel administrativo lançou erros JavaScript: ' + adminErrors.join('; '))
  await adminPage.close()

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

  console.log('Contratação Grand Focus E2E: formulário, resumo, consentimentos, checkout mock, mobile, campanha fechada e acesso admin aprovados.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
