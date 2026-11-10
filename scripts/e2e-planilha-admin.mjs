import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {chromium} from 'playwright'

const root=path.resolve('dist')
for(const file of ['contratar/planilha/index.html','contratar/planilha/planilha.js',
 'contratar/planilha/planilha.css','contratar/entre-estacoes/admin/premium.css']){
 assert.ok(fs.existsSync(path.join(root,file)),file+' não foi copiado na build')
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const srv=http.createServer((req,res)=>{
 const url=new URL(req.url||'/', 'http://localhost')
 let file=path.resolve(root,'.'+url.pathname)
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html')
 if(!fs.existsSync(file)){res.writeHead(404);res.end('Not found');return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true})
const origin='http://127.0.0.1:'+srv.address().port
const history=[]
const r={
 id:'11111111-1111-4111-8111-111111111111',
 origem:'formulario_site',respondido_em:'2026-11-10T13:35:00Z',
 responsavel_nome:'Responsável Original',responsavel_whatsapp:'16999998888',
 bailarina_nome:'Bailarina Primeira, Bailarina Segunda',
 alunos_inscritos:[{nome:'Bailarina Primeira',turma:''},{nome:'Bailarina Segunda',turma:''}],
 experiencia_original:'Gente que Dança',valor_informado_centavos:27000,
 valor_recebido_centavos:0,pagamento_situacao:'pendente',
 pagamento_preferido:'Pix',pagamento_metodo:null,pagamento_referencia:null,
 pagamento_observacao:null,agendamento_status:null,horario_id:null,arquivado_em:null,
 planilha_campos:{},planilha_cor:'sem',planilha_nota:''
}
let columns=[]
try{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 page.on('dialog',dialog=>dialog.accept())
 await page.route('https://esm.sh/**',route=>route.fulfill({
  status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},
  body:"export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fake-admin-token'}}})}}}"
 }))
 await page.route('**/functions/v1/contratacao-admin',async route=>{
  const body=JSON.parse(route.request().postData()||'{}')
  assert.equal(body.slug,'gente-que-danca-2026')
  history.push(body.action)
  if(body.action==='central_listar')return route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({campanha:{nome:'Gente que Dança',planilha_colunas:columns},
    respostas:[r],pedidos:[],acompanhamentos:[]})
  })
  if(body.action==='planilha_configurar_colunas'){
   columns=body.colunas
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,colunas:columns})})
  }
  if(body.action==='planilha_editar_resposta'){
   assert.equal(body.alunos.length,2)
   assert.equal(body.campos[columns[0].id],'Vestido rosa')
   assert.equal(r.valor_recebido_centavos,0)
   Object.assign(r,{
    responsavel_nome:body.nome,responsavel_whatsapp:body.whatsapp,
    bailarina_nome:body.alunos.map(x=>x.nome).join(', '),
    alunos_inscritos:body.alunos,
    planilha_cor:body.cor,planilha_nota:body.nota,planilha_campos:body.campos
   })
   return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  }
  if(body.action==='central_registrar_pagamento'){
   assert.equal(body.valor_recebido_centavos,body.situacao==='pago_manual'?27000:0)
   if(body.situacao==='pago_manual')assert.equal(body.conferencia_confirmada,true)
   Object.assign(r,{valor_recebido_centavos:body.valor_recebido_centavos,
     pagamento_situacao:body.situacao,pagamento_metodo:body.metodo,
     pagamento_referencia:body.referencia,pagamento_observacao:body.observacao})
   return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  }
  if(body.action==='central_arquivar'){
   assert.equal(body.referencia_id,r.id)
   assert.equal(r.valor_recebido_centavos,0,'Apenas respostas sem recebimento são removíveis')
   r.arquivado_em=body.arquivar?'2026-11-10T17:15:00Z':null
   return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  }
  throw Error('Ação inesperada: '+body.action)
 })
 await page.goto(origin+'/contratar/planilha/?campanha=gente-que-danca-2026',{waitUntil:'networkidle'})
 await page.waitForSelector('#rows tr')
 assert.equal(await page.locator('#count').textContent(),'1 registro(s)')
 assert.match(await page.locator('#campaign-name').textContent(),/Gente que Dança/)
 await page.locator('#columns').click()
 await page.locator('#add-column').click()
 await page.locator('#columns-list input').fill('Figurino')
 await page.locator('#columns-list select').selectOption('dourado')
 await page.locator('#columns-save').click()
 await page.waitForFunction(()=>!!document.querySelector('th.column-dourado'))
 assert.match(await page.locator('#sheet-head').textContent(),/Figurino/)
 await page.getByRole('button',{name:/Editar/}).first().click()
 await page.locator('#edit-name').fill('Responsável Corrigido')
 await page.locator('#edit-note').fill('Falar com a mãe amanhã.')
 await page.locator('#edit-color').selectOption('verde')
 await page.locator('#edit-extras textarea').fill('Vestido rosa')
 await page.locator('#edit-save').click()
 await page.waitForFunction(()=>document.querySelector('#rows tr')?.classList.contains('row-verde'))
 assert.match(await page.locator('#rows').textContent(),/Responsável Corrigido/)
 assert.match(await page.locator('#rows').textContent(),/Vestido rosa/)
 assert.match(await page.locator('#rows').textContent(),/Falar com a mãe amanhã/)
 assert.match(await page.locator('#rows').textContent(),/R\$\s*270,00/)
 await page.getByRole('button',{name:/R\$ Conferir/}).click()
 await page.locator('#pay-status').selectOption('pago_manual')
 await page.locator('#pay-amount').fill('270,00')
 await page.locator('#pay-method').selectOption('pix')
 await page.locator('#pay-verified').check()
 await page.locator('#pay-save').click()
 await page.waitForFunction(()=>document.querySelector('#rows')?.textContent?.includes('Pago'))
 assert.equal(r.valor_recebido_centavos,27000)
 await page.getByRole('button',{name:/R\$ Corrigir/}).click()
 await page.locator('#pay-status').selectOption('pendente')
 await page.locator('#pay-note').fill('Teste foi marcado como pago por engano.')
 await page.locator('#pay-save').click()
 await page.waitForFunction(()=>document.querySelector('#rows')?.textContent?.includes('Pendente'))
 assert.equal(r.valor_recebido_centavos,0)
 await page.getByRole('button',{name:'Remover'}).click()
 await page.waitForFunction(()=>!document.querySelector('#rows')?.textContent?.includes('Responsável Corrigido'))
 await page.locator('#status-filter').selectOption('arquivados')
 await page.getByRole('button',{name:/Restaurar/}).click()
 await page.waitForFunction(()=>document.querySelector('#count')?.textContent?.includes('0 registro'))
 await page.locator('#status-filter').selectOption('todas')
 await page.waitForFunction(()=>document.querySelector('#rows')?.textContent?.includes('Responsável Corrigido'))
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844})
  const dimensions=await page.evaluate(()=>({
   client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
  }))
  assert.ok(dimensions.scroll<=dimensions.client+1,
   'A planilha não deve transbordar a página: '+JSON.stringify({width,...dimensions}))
 }
 assert.deepEqual(errors,[],'Sem exceções JS')
 for(const action of ['central_listar','planilha_configurar_colunas','planilha_editar_resposta','central_registrar_pagamento','central_arquivar'])
  assert.ok(history.includes(action),'Ação não testada: '+action)
 console.log('Planilha: editar, cores, colunas, pagamento/reversão, remoção, restauração, 320–1440px aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>srv.close(resolve))
}
