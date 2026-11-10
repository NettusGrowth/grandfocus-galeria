import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {chromium} from 'playwright'
const root=path.resolve('dist')
for(const p of ['contratar/gente-que-danca/index.html','contratar/gente-que-danca/gente.js',
'contratar/gente-que-danca/gente.css','contratar/gente-que-danca/termos.html',
'contratar/gente-que-danca/privacidade.html'])
 assert.ok(fs.existsSync(path.join(root,p)),p+' não foi copiado na build')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const server=http.createServer((req,res)=>{
 let p=new URL(req.url||'/', 'http://localhost').pathname
 if(/^\/contratar\/gente-que-danca-2026\/?$/.test(p))p='/contratar/gente-que-danca/index.html'
 let file=path.resolve(root,'.'+p)
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 if(!fs.existsSync(file)){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
const submissions=[]
async function pageFor(open=true){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/functions/v1/contratacao-publica',async route=>{
  const body=JSON.parse(route.request().postData()||'{}')
  assert.equal(body.campaign_slug,'gente-que-danca-2026')
  if(body.action==='gente_status'){
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({disponivel:open})})
    return
  }
  if(body.action==='gente_inscrever'){
    submissions.push(body)
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({ok:true,codigo:'gente123',valor_centavos:body.alunos.length*15000})})
    return
  }
  throw new Error('Ação indevida da Gente: '+body.action)
 })
 await page.goto(origin+'/contratar/gente-que-danca-2026/',{waitUntil:'networkidle'})
 return {page,errors}
}
try{
 const first=await pageFor()
 assert.equal(await first.page.locator('#gente-form').isVisible(),true)
 assert.match(await first.page.locator('.price').textContent(),/150,00/)
 assert.match(await first.page.locator('.facts').textContent(),/15 de dezembro/)
 assert.equal(await first.page.locator('#total').textContent(),'R$ 150,00')
 for(const width of [320,360,390,430,768,1440]){
  await first.page.setViewportSize({width,height:820})
  const v=await first.page.evaluate(()=>({client:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth}))
  assert.ok(v.scroll<=v.client+1,'Formulário Gente com rolagem horizontal: '+JSON.stringify({width,...v}))
 }
 await first.page.setViewportSize({width:390,height:844})
 await first.page.locator('#submit').click()
 await first.page.waitForSelector('.question.invalid')
 assert.equal(await first.page.locator('#name').evaluate(x=>x===document.activeElement),true)
 await first.page.locator('#name').fill('Responsável Exemplo')
 await first.page.locator('#whatsapp').fill('(16) 99999-9999')
 await first.page.locator('#student-0').fill('Bailarina Exemplo')
 await first.page.locator('input[name="preferencia"][value="pix"]').check()
 await first.page.locator('#responsibility').check()
 await first.page.locator('#accept').check()
 await first.page.locator('#submit').click()
 await first.page.waitForSelector('#success:not([hidden])')
 assert.equal(submissions.length,1)
 assert.equal(submissions[0].alunos.length,1)
 assert.equal(submissions[0].preferencia,'pix')
 assert.equal(submissions[0].horario_id,undefined)
 assert.equal(submissions[0].aceite,true)
 assert.equal(submissions[0].company_website,'')
 assert.deepEqual(first.errors,[])
 await first.page.close()
 const second=await pageFor()
 await second.page.locator('[data-count="4"]').click()
 assert.match((await second.page.locator('#total').textContent()).replace(/\s/g,''),/R\$600,00/)
 await second.page.locator('#name').fill('Responsável Segunda')
 await second.page.locator('#whatsapp').fill('(16) 98888-7777')
 for(let i=0;i<4;i++)await second.page.locator('#student-'+i).fill('Bailarina Número '+(i+1))
 await second.page.locator('input[name="preferencia"][value="credito"]').check()
 await second.page.locator('#responsibility').check()
 await second.page.locator('#accept').check()
 await second.page.locator('#submit').click()
 await second.page.waitForSelector('#success:not([hidden])')
 assert.equal(submissions.length,2)
 assert.equal(submissions[1].alunos.length,4)
 assert.equal(submissions[1].preferencia,'credito')
 assert.deepEqual(second.errors,[])
 await second.page.close()
 const closed=await pageFor(false)
 assert.equal(await closed.page.locator('#closed').isVisible(),true)
 assert.equal(await closed.page.locator('#gente-form').isVisible(),false)
 assert.deepEqual(closed.errors,[])
 await closed.page.close()
 console.log('Gente que Dança: formulário móvel, R$150/600, validação e inscrição sem checkout aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>server.close(resolve))
}
