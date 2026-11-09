import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {chromium} from 'playwright'

const root=path.resolve('dist')
for(const file of [
 'contratar/fada-natal/index.html',
 'contratar/fada-natal/fada.css',
 'contratar/fada-natal/fada.js',
]){
 assert.ok(fs.existsSync(path.join(root,file)),file+' deve estar na distribuição.')
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'}
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url||'/', 'http://localhost').pathname
 if(/^\/contratar\/natal-fada-acucarada-2026\/?$/.test(pathname))pathname='/contratar/fada-natal/index.html'
 let file=path.resolve(root,'.'+pathname)
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html')
 if(!fs.existsSync(file)){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
const slots=[
 {id:'11111111-1111-4111-8111-111111111111',dia:'2026-12-12',inicio:'14:00',duracao_minutos:20,capacidade:1,ocupados:0,disponiveis:1,ativo:true},
 {id:'22222222-2222-4222-8222-222222222222',dia:'2026-12-12',inicio:'14:20',duracao_minutos:20,capacidade:1,ocupados:1,disponiveis:0,ativo:true},
 {id:'33333333-3333-4333-8333-333333333333',dia:'2026-12-13',inicio:'15:00',duracao_minutos:20,capacidade:1,ocupados:0,disponiveis:1,ativo:true}
]
const submissions=[]
async function newPage(available=true){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1})
 const errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/functions/v1/contratacao-publica',async route=>{
  const body=JSON.parse(route.request().postData()||'{}')
  assert.equal(body.campaign_slug,'natal-fada-acucarada-2026')
  if(body.action==='natal_horarios'){
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({disponivel:available,horarios:available?slots:[]})})
   return
  }
  if(body.action==='natal_inscrever'){
   submissions.push(body)
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,codigo:'abcd1234',valor_centavos:body.alunos.length===1?8000:body.alunos.length===2?14500:body.alunos.length===3?21500:28500,ja_pago_declarado:body.pagamento==='ja_paguei'})})
   return
  }
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Ação não permitida'})})
 })
 await page.goto(origin+'/contratar/natal-fada-acucarada-2026/',{waitUntil:'networkidle'})
 return {page,errors}
}
try{
 const {page,errors}=await newPage()
 await page.waitForSelector('#gf-fada-form:not([hidden])')
 assert.match(await page.title(),/Natal/)
 assert.equal(await page.locator('#gf-total').textContent(),'R$ 80,00')
 assert.equal(await page.locator('#gf-slots button').count(),2)
 assert.equal(await page.locator('#gf-slots button').nth(1).isDisabled(),true)
 // Responsividade em vários tamanhos, inclusive mães/pais idosos com fonte ampliada.
 for(const width of [320,360,390,430,768,1440]){
   await page.setViewportSize({width,height:850})
   const metrics=await page.evaluate(()=>({
    inner:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
    inputHeight:document.getElementById('gf-responsavel').getBoundingClientRect().height
   }))
   assert.ok(metrics.scroll<=metrics.inner+1,'Layout com rolagem horizontal: '+JSON.stringify({width,...metrics}))
   assert.ok(metrics.inputHeight>=48,'Campo de formulário pequeno: '+JSON.stringify(metrics))
 }
 await page.setViewportSize({width:390,height:844})
 await page.locator('input[name="pagamento"][value="ja_paguei"]').check()
 assert.equal(await page.locator('#gf-paid-details').isVisible(),true)
 await page.locator('#gf-paid-method').selectOption('pix')
 await page.locator('#gf-paid-date').fill('2026-11-09')
 await page.locator('[data-count="2"]').click()
 assert.match((await page.locator('#gf-total').textContent()).replace(/\s/g,''),/R\$145,00/)
 await page.locator('#gf-aluno-0').fill('Bailarina Primeira')
 await page.locator('#gf-aluno-1').fill('Bailarina Segunda')
 await page.locator('#gf-turma-0').fill('Turma infantil')
 await page.locator('#gf-slots button').first().click()
 await page.locator('#gf-responsavel').fill('Responsável Teste')
 await page.locator('#gf-whatsapp').fill('(16) 99999-8888')
 await page.locator('#gf-family-options input').first().check()
 await page.locator('#gf-consent').check()
 await page.locator('#gf-submit').click()
 await page.waitForSelector('#gf-success:not([hidden])')
 assert.equal(submissions.length,1)
 assert.equal(submissions[0].action,'natal_inscrever')
 assert.equal(submissions[0].pagamento,'ja_paguei')
 assert.equal(submissions[0].horario_id,slots[0].id)
 assert.equal(submissions[0].alunos.length,2)
 assert.equal(submissions[0].company_website,'')
 assert.match(await page.locator('#gf-success-message').textContent(),/Não realize outro pagamento/)
 assert.deepEqual(errors,[], 'Erros de JS no formulário de Natal: '+errors.join(', '))
 await page.close()

 const second=await newPage()
 await second.page.locator('input[name="pagamento"][value="a_pagar"]').check()
 assert.equal(await second.page.locator('#gf-paid-details').isVisible(),false)
 await second.page.locator('[data-count="4"]').click()
 assert.match((await second.page.locator('#gf-total').textContent()).replace(/\s/g,''),/R\$285,00/)
 for(let i=0;i<4;i++)await second.page.locator('#gf-aluno-'+i).fill('Aluno Teste '+(i+1))
 await second.page.locator('[data-day="2026-12-13"]').click()
 await second.page.locator('#gf-slots button').first().click()
 await second.page.locator('#gf-responsavel').fill('Responsável Segunda')
 await second.page.locator('#gf-whatsapp').fill('(16) 98888-7777')
 await second.page.locator('#gf-consent').check()
 await second.page.locator('#gf-submit').click()
 await second.page.waitForSelector('#gf-success:not([hidden])')
 assert.equal(submissions.length,2)
 assert.equal(submissions[1].pagamento,'a_pagar')
 assert.equal(submissions[1].alunos.length,4)
 assert.equal(submissions[1].horario_id,slots[2].id)
 assert.match(await second.page.locator('#gf-success-message').textContent(),/orientações de pagamento/)
 assert.deepEqual(second.errors,[])
 await second.page.close()

 const closed=await newPage(false)
 assert.equal(await closed.page.locator('#gf-fada-form').isVisible(),false)
 assert.equal(await closed.page.locator('#gf-closed').isVisible(),true)
 assert.deepEqual(closed.errors,[])
 await closed.page.close()
 console.log('Fada Açucarada: formulário, preços familiares, já pago, horários e responsividade aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>server.close(resolve))
}
