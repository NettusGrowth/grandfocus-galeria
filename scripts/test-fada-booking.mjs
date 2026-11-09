import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {chromium} from 'playwright'

const root=path.resolve('dist')
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'}
const server=http.createServer((request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url||'/', 'http://127.0.0.1').pathname)
 const route=/^\/contratar\/natal-fada-acucarada-2026\/?$/.test(pathname)
  ?'/contratar/entre-estacoes/index.html':pathname
 const file=path.resolve(root,'.'+route+(route.endsWith('/')?'index.html':''))
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){
  response.writeHead(404);response.end('Not found');return
 }
 response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(response)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
let captured=[],actions=[]
const fakeSlots=[
 {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dia:'2026-12-12',inicio:'10:00',ativo:true,disponiveis:1,capacidade:1},
 {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',dia:'2026-12-12',inicio:'10:30',ativo:true,disponiveis:0,capacidade:1},
 {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',dia:'2026-12-13',inicio:'14:00',ativo:true,disponiveis:1,capacidade:1},
]
async function createPage(){
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/functions/v1/contratacao-publica',async route=>{
  const request=JSON.parse(route.request().postData()||'{}')
  actions.push(request.action)
  if(request.action==='natal_horarios'){
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({disponivel:true,modo_agendamento:'horario_marcado',horarios:fakeSlots})})
  }
  if(request.action==='natal_inscrever'){
   captured.push(request)
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,codigo:'A1B2C3D4',valor_centavos:request.alunos.length===2?14500:28500,
     ja_pago_declarado:request.pagamento==='ja_paguei'})})
  }
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Ação não esperada.'})})
 })
 await page.goto(origin+'/contratar/natal-fada-acucarada-2026/',{waitUntil:'networkidle'})
 await page.waitForSelector('#gf-fada-form')
 return {page,errors}
}
try{
 const {page,errors}=await createPage()
 assert.equal(await page.locator('#contract-form').isVisible(),false)
 assert.match(await page.locator('.gf-fada-intro h2').textContent(),/Fotográfico de Natal/)
 assert.equal(await page.locator('.gf-fada-slot input').count(),2)
 assert.equal(await page.locator('.gf-fada-slot[data-available="false"] input').isDisabled(),true)
 await page.locator('input[name="fada_pagamento"][value="ja_paguei"]').check()
 assert.equal(await page.locator('#gf-fada-paid-details').isVisible(),true)
 await page.locator('#gf-fada-count').selectOption('2')
 assert.equal(await page.locator('.gf-fada-student').count(),2)
 assert.match(await page.locator('#gf-fada-total').textContent(),/145,00/)
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844})
  const metrics=await page.evaluate(()=>({
   width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
   submitHeight:document.querySelector('#gf-fada-submit').getBoundingClientRect().height,
  }))
  assert.ok(metrics.scrollWidth<=metrics.width+1,'Rolagem horizontal no formulário: '+JSON.stringify(metrics))
  assert.ok(metrics.submitHeight>=48,'Botão de inscrição precisa ser fácil de tocar.')
 }
 await page.setViewportSize({width:390,height:844})
 const names=page.locator('.gf-fada-student [data-nome]')
 await names.nth(0).fill('Bailarina de Teste A')
 await names.nth(1).fill('Bailarina de Teste B')
 await page.locator('#gf-fada-name').fill('Responsável de Teste')
 await page.locator('#gf-fada-phone').fill('(16) 99999-9999')
 await page.locator('#gf-fada-method').selectOption('pix')
 await page.locator('input[name="fada_horario"]').first().check()
 await page.locator('#gf-fada-consent').check()
 await page.locator('#gf-fada-submit').click()
 await page.waitForSelector('#gf-fada-success:not([hidden])')
 assert.match(await page.locator('#gf-fada-success').textContent(),/Não pague novamente/)
 assert.equal(captured.length,1)
 assert.equal(captured[0].horario_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
 assert.equal(captured[0].pagamento,'ja_paguei')
 assert.equal(captured[0].alunos.length,2)
 assert.equal(captured[0].meio_pagamento,'pix')
 assert.equal(errors.length,0,'Erros JS: '+errors.join(', '))
 await page.close()

 const other=await createPage()
 const page2=other.page
 await page2.locator('input[name="fada_pagamento"][value="a_pagar"]').check()
 assert.equal(await page2.locator('#gf-fada-paid-details').isVisible(),false)
 await page2.locator('#gf-fada-count').selectOption('4')
 assert.match(await page2.locator('#gf-fada-total').textContent(),/285,00/)
 const studentNames=page2.locator('.gf-fada-student [data-nome]')
 for(let i=0;i<4;i++)await studentNames.nth(i).fill('Bailarina Natal '+(i+1))
 await page2.locator('#gf-fada-name').fill('Outro Responsável de Teste')
 await page2.locator('#gf-fada-phone').fill('(16) 98888-8888')
 await page2.locator('.gf-fada-day[data-day="2026-12-13"]').click()
 await page2.locator('input[name="fada_horario"]').first().check()
 await page2.locator('#gf-fada-consent').check()
 await page2.locator('#gf-fada-submit').click()
 await page2.waitForSelector('#gf-fada-success:not([hidden])')
 assert.equal(captured[1].alunos.length,4)
 assert.equal(captured[1].pagamento,'a_pagar')
 assert.equal(captured[1].horario_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 assert.match(await page2.locator('#gf-fada-success').textContent(),/Nenhuma cobrança/)
 assert.equal(other.errors.length,0,'Erro JS: '+other.errors.join(', '))
 await page2.close()
 assert.ok(!actions.includes('contratar'),'O formulário natalino jamais pode criar checkout.')
 console.log('Fada Natal: duas formas de pagamento, preços familiares, horários e layout móvel aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>server.close(resolve))
}
