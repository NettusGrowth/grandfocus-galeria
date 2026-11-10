import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {chromium} from 'playwright'

const root=path.resolve('dist')
const files=['contratar/gente-que-danca/index.html','contratar/gente-que-danca/gente.js',
 'contratar/gente-que-danca/gente.css','contratar/gente-que-danca/termos.html',
 'contratar/gente-que-danca/privacidade.html']
for(const file of files)assert.ok(fs.existsSync(path.join(root,file)),file+' ausente da build')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const server=http.createServer((req,res)=>{
 let p=new URL(req.url||'/', 'http://localhost').pathname
 if(/^\/contratar\/gente-que-danca-2026\/?$/.test(p))p='/contratar/gente-que-danca/index.html'
 const file=path.resolve(root,'.'+p)
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 if(!fs.existsSync(file)){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
const saved=[]
let conflict=false
function mockSlots(quantity){
 const values=[]
 for(let minutes=18*60;minutes<22*60;minutes+=15){
  if(minutes>=20*60&&minutes<21*60)continue // buffer antigos de produção
  const end=minutes+quantity*15
  if(end>22*60||(minutes<20*60&&end>20*60))continue
  const fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')
  values.push({
   id:'00000000-0000-4000-8000-'+String(minutes).padStart(12,'0'),
   inicio:fmt(minutes),fim:fmt(end),
   dia:'2026-12-15',duracao_minutos:quantity*15
  })
 }
 return values
}
async function pageFor(open=true){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1})
 const errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/functions/v1/contratacao-publica',async route=>{
  const body=JSON.parse(route.request().postData()||'{}')
  assert.equal(body.campaign_slug,'gente-que-danca-2026')
  if(body.action==='gente_horarios'){
   const quantity=body.quantidade
   assert.ok(Number.isInteger(quantity)&&quantity>=1&&quantity<=4)
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({disponivel:open,horarios:open?mockSlots(quantity):[]})})
   return
  }
  if(body.action==='gente_inscrever'){
   saved.push(body)
   if(conflict){
    await route.fulfill({status:409,contentType:'application/json',
     body:JSON.stringify({error:'Esse horário acabou de ser reservado. Selecione outro disponível.'})})
    return
   }
   const q=body.alunos.length
   const start=mockSlots(q).find(x=>x.id===body.horario_id)
   assert.ok(start,'O início deve ser realmente disponível')
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,codigo:'gente123',
     valor_centavos:15000+(q-1)*12000,inicio:start.inicio,fim:start.fim})})
   return
  }
  throw Error('Endpoint inesperado: '+body.action)
 })
 await page.goto(origin+'/contratar/gente-que-danca-2026/',{waitUntil:'networkidle'})
 return {page,errors}
}
try{
 const first=await pageFor()
 const page=first.page
 assert.equal(await page.locator('#gente-form').isVisible(),true)
 assert.match(await page.locator('#count-label').textContent(),/bailarinos/)
 assert.match(await page.locator('.gf-discount').textContent(),/30/)
 assert.match(await page.locator('.facts').textContent(),/22h/)
 for(const width of [320,360,390,430,768,1440]){
  await page.setViewportSize({width,height:850})
  const r=await page.evaluate(()=>{
   const name=document.querySelector('#name').getBoundingClientRect()
   const phone=document.querySelector('#whatsapp').getBoundingClientRect()
   return {client:document.documentElement.clientWidth,
     scroll:document.documentElement.scrollWidth,nameWidth:name.width,phoneWidth:phone.width}
  })
  assert.ok(r.scroll<=r.client+1,'Overflow: '+JSON.stringify({width,...r}))
  assert.ok(Math.abs(r.nameWidth-r.phoneWidth)<3,'Nome menor que telefone: '+JSON.stringify({width,...r}))
 }
 await page.setViewportSize({width:390,height:844})
 await page.locator('#submit').click()
 await page.waitForSelector('.question.invalid')
 assert.equal(await page.locator('#name').evaluate(e=>document.activeElement===e),true)
 await page.locator('#name').fill('Responsável Teste')
 await page.locator('#whatsapp').fill('(16) 99999-8888')
 await page.locator('#student-0').fill('Bailarina Primeira')
 await page.locator('#submit').click()
 await page.waitForFunction(()=>document.querySelector('#gente-schedule-question')?.classList.contains('invalid'))
 assert.equal(await page.locator('#gente-schedule-question').isVisible(),true)
 await page.locator('#gente-times .time-option').first().click()
 assert.equal(await page.locator('#gente-times .time-option[aria-pressed="true"]').count(),1)
 assert.equal(saved.length,0,'Clicar no horário não pode criar reserva')
 await page.locator('input[name="preferencia"][value="pix"]').check()
 await page.locator('#responsibility').check()
 await page.locator('#accept').check()
 await page.locator('#submit').click()
 await page.waitForSelector('#success:not([hidden])')
 assert.equal(saved.length,1)
 assert.equal(saved[0].preferencia,'pix')
 assert.equal(saved[0].horario_id,mockSlots(1)[0].id)
 assert.equal(saved[0].alunos.length,1)
 assert.match(await page.locator('#schedule-success-detail').textContent(),/18:00 às 18:15/)
 assert.deepEqual(first.errors,[])
 await page.close()
 const second=await pageFor()
 const p2=second.page
 for(const [n,amount] of [[2,270],[3,390],[4,510]]){
  await p2.locator('[data-count="'+n+'"]').click()
  await p2.waitForFunction(n=>document.querySelector('#students')?.querySelectorAll('input').length===n,n)
  const displayed=(await p2.locator('#total').textContent()).replace(/\s/g,'')
  assert.ok(displayed.includes('R$'+amount+',00'),'Preço incorreto para '+n+': '+displayed)
 }
 await p2.locator('#name').fill('Responsável Segunda')
 await p2.locator('#whatsapp').fill('(16) 98888-7777')
 for(let i=0;i<4;i++)await p2.locator('#student-'+i).fill('Bailarina '+(i+1))
 await p2.locator('.times-more').click()
 await p2.locator('#gente-times .time-option').last().click()
 assert.match(await p2.locator('#gente-schedule-hint').textContent(),/21:00 às 22:00/)
 await p2.locator('input[name="preferencia"][value="credito"]').check()
 await p2.locator('#responsibility').check()
 await p2.locator('#accept').check()
 await p2.locator('#submit').click()
 await p2.waitForSelector('#success:not([hidden])')
 assert.equal(saved.length,2)
 assert.equal(saved[1].alunos.length,4)
 assert.equal(saved[1].preferencia,'credito')
 assert.equal(saved[1].horario_id,mockSlots(4).at(-1).id)
 assert.deepEqual(second.errors,[])
 await p2.close()
 const closed=await pageFor(false)
 assert.equal(await closed.page.locator('#closed').isVisible(),true)
 assert.equal(await closed.page.locator('#gente-form').isVisible(),false)
 assert.deepEqual(closed.errors,[])
 await closed.page.close()
 conflict=true
 const third=await pageFor(true)
 await third.page.locator('#name').fill('Responsável Conflito')
 await third.page.locator('#whatsapp').fill('(16) 98888-7771')
 await third.page.locator('#student-0').fill('Bailarina Terceira')
 await third.page.locator('#gente-times .time-option').first().click()
 await third.page.locator('input[name="preferencia"][value="pix"]').check()
 await third.page.locator('#responsibility').check()
 await third.page.locator('#accept').check()
 await third.page.locator('#submit').click()
 await third.page.waitForSelector('#form-error:not([hidden])')
 assert.equal(await third.page.locator('#name').inputValue(),'Responsável Conflito')
 assert.deepEqual(third.errors,[])
 await third.page.close()
 console.log('Gente: preços 150/270/390/510, foco em erros, horários, 21–22, 409, responsivo aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>server.close(resolve))
}
