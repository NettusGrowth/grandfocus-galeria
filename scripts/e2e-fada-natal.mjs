import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {chromium} from 'playwright'

const root=path.resolve('dist')
for(const file of [
 'contratar/fada-natal/index.html','contratar/fada-natal/fada.css',
 'contratar/fada-natal/fada.js','contratar/fada-natal/termos.html',
 'contratar/fada-natal/privacidade.html'
])assert.ok(fs.existsSync(path.join(root,file)),file+' precisa estar na distribuição.')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url||'/', 'http://localhost').pathname
 if(/^\/contratar\/natal-fada-acucarada-2026\/?$/.test(pathname))
  pathname='/contratar/fada-natal/index.html'
 let file=path.resolve(root,'.'+pathname)
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html')
 if(!fs.existsSync(file)){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
const slots=[
 {id:'11111111-1111-4111-8111-111111111111',dia:'2026-12-12',inicio:'08:00',disponiveis:1,ativo:true},
 {id:'22222222-2222-4222-8222-222222222222',dia:'2026-12-12',inicio:'08:15',disponiveis:1,ativo:true},
 {id:'33333333-3333-4333-8333-333333333333',dia:'2026-12-12',inicio:'08:30',disponiveis:1,ativo:true},
 {id:'44444444-4444-4444-8444-444444444444',dia:'2026-12-12',inicio:'14:00',disponiveis:1,ativo:true},
 {id:'55555555-5555-4555-8555-555555555555',dia:'2026-12-12',inicio:'14:15',disponiveis:1,ativo:true},
 {id:'66666666-6666-4666-8666-666666666666',dia:'2026-12-13',inicio:'09:00',disponiveis:1,ativo:true},
 {id:'77777777-7777-4777-8777-777777777777',dia:'2026-12-13',inicio:'09:15',disponiveis:1,ativo:true}
]
const calls=[]
async function newPage(available=true,conflict=false){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/functions/v1/contratacao-publica',async route=>{
  const body=JSON.parse(route.request().postData()||'{}');calls.push(body)
  assert.equal(body.campaign_slug,'natal-fada-acucarada-2026')
  if(body.action==='natal_horarios'){
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({disponivel:available,horarios:available?slots:[]})});return
  }
  if(body.action==='natal_inscrever'){
   if(conflict){
    await route.fulfill({status:409,contentType:'application/json',
     body:JSON.stringify({error:'Esse horário não está mais disponível.'})});return
   }
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,codigo:'abcd1234',
     valor_centavos:({1:8000,2:14500,3:21500,4:28500})[body.alunos.length],
     ja_pago_declarado:body.pagamento==='ja_paguei'})});return
  }
  throw new Error('A interface tentou uma ação antiga: '+body.action)
 })
 await page.goto(origin+'/contratar/natal-fada-acucarada-2026/',{waitUntil:'networkidle'})
 return {page,errors}
}
try{
 const first=await newPage()
 const page=first.page
 await page.waitForSelector('#gf-fada-form:not([hidden])')
 assert.match(await page.title(),/Natal/)
 assert.equal(await page.locator('#gf-hold').count(),0,'O cronômetro foi removido')
 assert.equal(await page.locator('#gf-family-options').count(),0,'Sem pergunta sobre toda a família')
 assert.equal(await page.locator('#gf-note').count(),0,'Sem campo opcional de observações')
 assert.equal(await page.locator('#gf-email').count(),0,'Sem e-mail opcional')
 assert.match(await page.locator('#gf-students-heading').textContent(),/da sua família/)
 assert.match(await page.locator('#gf-students-heading + p').textContent(),/não a turma inteira/)
 assert.equal(await page.locator('#gf-total').textContent(),'R$ 80,00')
 for(const width of [320,360,390,430,768,1440]){
  await page.setViewportSize({width,height:850})
  const m=await page.evaluate(()=>({
   inner:document.documentElement.clientWidth,
   scroll:document.documentElement.scrollWidth,
   height:document.getElementById('gf-responsavel').getBoundingClientRect().height
  }))
  assert.ok(m.scroll<=m.inner+1,'Overflow horizontal: '+JSON.stringify({width,...m}))
  assert.ok(m.height>=47,'Campo pequeno: '+JSON.stringify(m))
 }
 await page.setViewportSize({width:390,height:844})
 await page.locator('[data-count="2"]').click()
 await page.waitForFunction(()=>document.querySelector('[data-count="2"]')?.getAttribute('aria-pressed')==='true')
 assert.match((await page.locator('#gf-total').textContent()).replace(/\s/g,''),/R\$145,00/)
 await page.locator('#gf-aluno-0').fill('Bailarina Primeira')
 await page.locator('#gf-aluno-1').fill('Bailarina Segunda')
 await page.locator('#gf-slots button').first().click()
 assert.equal(calls.filter(c=>c.action==='natal_inscrever').length,0,'Não envia antes do clique em confirmar')
 assert.equal(calls.filter(c=>c.action==='natal_seguranca_horario').length,0,'Não pré-reserva ao clicar no horário')
 await page.locator('#gf-slots button').nth(1).click()
 assert.match(await page.locator('#gf-recap').textContent(),/08:15/)
 await page.locator('#gf-slots button').first().click()
 assert.match(await page.locator('#gf-recap').textContent(),/08:00/)
 await page.locator('#gf-responsavel').fill('Responsável Teste')
 await page.locator('#gf-whatsapp').fill('(16) 99999-8888')
 await page.locator('input[name="pagamento"][value="ja_paguei"]').check()
 await page.locator('#gf-consent').check()
 await page.locator('#gf-submit').click()
 await page.waitForSelector('#gf-success:not([hidden])')
 const submissions=calls.filter(c=>c.action==='natal_inscrever')
 assert.equal(submissions.length,1)
 assert.equal(submissions[0].horario_id,slots[0].id)
 assert.equal(submissions[0].pagamento,'ja_paguei')
 assert.equal(submissions[0].alunos.length,2)
 assert.equal(submissions[0].familia,'')
 assert.equal(submissions[0].observacao,'')
 assert.equal(submissions[0].email,'')
 assert.match(await page.locator('#gf-success-message').textContent(),/Não pague novamente/)
 assert.deepEqual(first.errors,[])
 await page.close()

 const second=await newPage()
 await second.page.locator('[data-count="4"]').click()
 await second.page.waitForFunction(()=>document.querySelector('[data-count="4"]')?.getAttribute('aria-pressed')==='true')
 assert.match((await second.page.locator('#gf-total').textContent()).replace(/\s/g,''),/R\$285,00/)
 for(let i=0;i<4;i++)await second.page.locator('#gf-aluno-'+i).fill('Aluno Teste '+(i+1))
 await second.page.locator('[data-day="2026-12-13"]').click()
 await second.page.waitForFunction(()=>document.querySelector('[data-day="2026-12-13"]')?.getAttribute('aria-pressed')==='true')
 assert.equal(await second.page.locator('[data-period="afternoon"]').isVisible(),false)
 await second.page.locator('#gf-slots button').first().click()
 await second.page.locator('#gf-responsavel').fill('Responsável Segunda')
 await second.page.locator('#gf-whatsapp').fill('(16) 98888-7777')
 await second.page.locator('input[name="pagamento"][value="a_pagar"]').check()
 await second.page.locator('#gf-consent').check()
 await second.page.locator('#gf-submit').click()
 await second.page.waitForSelector('#gf-success:not([hidden])')
 const all=calls.filter(c=>c.action==='natal_inscrever')
 assert.equal(all.length,2)
 assert.equal(all[1].horario_id,slots[5].id)
 assert.equal(all[1].alunos.length,4)
 assert.match(await second.page.locator('#gf-success-message').textContent(),/instruções de pagamento/)
 assert.deepEqual(second.errors,[])
 await second.page.close()

 const unavailable=await newPage(false)
 assert.equal(await unavailable.page.locator('#gf-fada-form').isVisible(),false)
 assert.equal(await unavailable.page.locator('#gf-closed').isVisible(),true)
 await unavailable.page.close()

 const racing=await newPage(true,true)
 await racing.page.locator('#gf-aluno-0').fill('Aluna Exemplo')
 await racing.page.locator('#gf-slots button').first().click()
 await racing.page.locator('#gf-responsavel').fill('Responsável Exemplo')
 await racing.page.locator('#gf-whatsapp').fill('(16) 99999-6666')
 await racing.page.locator('input[name="pagamento"][value="a_pagar"]').check()
 await racing.page.locator('#gf-consent').check()
 await racing.page.locator('#gf-submit').click()
 await racing.page.waitForSelector('#gf-error:not([hidden])')
 assert.equal(await racing.page.locator('#gf-responsavel').inputValue(),'Responsável Exemplo')
 assert.equal(await racing.page.locator('#gf-success').isVisible(),false)
 assert.deepEqual(racing.errors,[])
 await racing.page.close()
 console.log('Fada: formulário compacto, troca de horário sem hold, 2/4 alunos, conflito e mobile aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>server.close(resolve))
}
