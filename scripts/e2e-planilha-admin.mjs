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
    respostas:[r],
    horarios:r.horario_id?[{id:r.horario_id,dia:'2026-12-15',inicio:'18:00:00',duracao_minutos:15}]:[],
    pedidos:[],acompanhamentos:[]})
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
  if(body.action==='gente_atualizar_agendamento'){
   assert.equal(body.resposta_id,r.id)
   assert.equal(body.status,'confirmado')
   assert.equal(r.pagamento_situacao,'pago_manual')
   assert.ok(r.valor_recebido_centavos>=r.valor_informado_centavos)
   r.agendamento_status='confirmado'
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,status:'confirmado'})})
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
 // Gente: um horário somente pode ser confirmado após pagamento integral.
 Object.assign(r,{horario_id:'66666666-6666-4666-8666-666666666666',
  agendamento_status:'solicitado',pagamento_situacao:'pago_manual',
  valor_recebido_centavos:27000})
 await page.locator('#refresh').click()
 await page.waitForFunction(()=>document.querySelector('.action-confirm-schedule:not(:disabled)'))
 await page.locator('.action-confirm-schedule').click()
 await page.waitForFunction(()=>document.querySelector('.schedule-confirmado'))
 assert.equal(r.agendamento_status,'confirmado')
 assert.equal(await page.locator('.action-confirm-schedule').count(),0)
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844})
  const dimensions=await page.evaluate(()=>({
   client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
  }))
  assert.ok(dimensions.scroll<=dimensions.client+1,
   'A planilha não deve transbordar a página: '+JSON.stringify({width,...dimensions}))
 }

 // A mesma planilha deve mostrar dia, horário efetivo e situação da agenda.
 // Dois alunos usam trinta minutos consecutivos; o backend não altera reservas.
 const fadaPage=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true})
 const fadaErrors=[]
 fadaPage.on('pageerror',error=>fadaErrors.push(error.message))
 fadaPage.on('dialog',dialog=>dialog.accept())
 await fadaPage.route('https://esm.sh/**',route=>route.fulfill({
  status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},
  body:"export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fake-admin-token'}}})}}}"
 }))
 const saturdayId='22222222-2222-4222-8222-222222222222'
 const sundayId='33333333-3333-4333-8333-333333333333'
 const fadaRows=[
  {...r,id:'44444444-4444-4444-8444-444444444444',
   responsavel_nome:'Família Sábado',horario_id:saturdayId,
   valor_informado_centavos:27000,valor_recebido_centavos:0,pagamento_situacao:'pendente',
   agendamento_status:'solicitado',
   alunos_inscritos:[{nome:'Irmã Um'},{nome:'Irmã Dois'}],
   bailarina_nome:'Irmã Um, Irmã Dois'},
  {...r,id:'55555555-5555-4555-8555-555555555555',
   responsavel_nome:'Família Domingo',horario_id:sundayId,
   pagamento_situacao:'pago_manual',valor_informado_centavos:15000,valor_recebido_centavos:15000,
   agendamento_status:'confirmado',
   alunos_inscritos:[{nome:'Bailarina Domingo'}],
   bailarina_nome:'Bailarina Domingo',respondido_em:'2026-11-10T15:00:00Z'}
 ]
 const fadaSlots=[
  {id:saturdayId,dia:'2026-12-12',inicio:'10:00:00',duracao_minutos:15},
  {id:sundayId,dia:'2026-12-13',inicio:'09:30:00',duracao_minutos:15}
 ]
 let fadaConfirmAttempts=0
 await fadaPage.route('**/functions/v1/contratacao-admin',async route=>{
  const body=JSON.parse(route.request().postData()||'{}')
  assert.equal(body.slug,'natal-fada-acucarada-2026')
  if(body.action==='central_listar')return route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({campanha:{nome:'Fada Açucarada',planilha_colunas:[]},
    respostas:fadaRows,horarios:fadaSlots,pedidos:[],acompanhamentos:[]})})
  if(body.action==='central_registrar_pagamento'){
   assert.equal(body.situacao,'pago_manual')
   assert.equal(body.valor_recebido_centavos,27000)
   assert.equal(body.conferencia_confirmada,true)
   fadaRows[0].pagamento_situacao='pago_manual'
   fadaRows[0].valor_recebido_centavos=27000
   return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  }
  if(body.action==='natal_atualizar_agendamento'){
   assert.equal(body.resposta_id,fadaRows[0].id)
   assert.equal(body.status,'confirmado')
   assert.equal(fadaRows[0].pagamento_situacao,'pago_manual')
   fadaConfirmAttempts++
   // Testar uma resposta 409: o botão não pode fingir que confirmou.
   if(fadaConfirmAttempts===1)return route.fulfill({status:409,contentType:'application/json',
    body:JSON.stringify({error:'Conflito de horário. Atualize a agenda.'})})
   fadaRows[0].agendamento_status='confirmado'
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,status:'confirmado'})})
  }
  throw Error('Ação inesperada na Fada: '+body.action)
 })
 await fadaPage.goto(origin+'/contratar/planilha/?campanha=natal-fada-acucarada-2026',
  {waitUntil:'networkidle'})
 await fadaPage.waitForFunction(()=>document.querySelector('#count')?.textContent==='2 registro(s)')
 assert.match(await fadaPage.locator('#sheet-head').textContent(),/Dia do ensaio/)
 assert.match(await fadaPage.locator('#sheet-head').textContent(),/Horário do ensaio/)
 assert.match(await fadaPage.locator('#sheet-head').textContent(),/Situação da reserva/)
 assert.match(await fadaPage.locator('#rows').textContent(),/10:00 – 10:30/)
 assert.match(await fadaPage.locator('#rows').textContent(),/09:30 – 09:45/)
 assert.match(await fadaPage.locator('#rows').textContent(),/Solicitado/)
 assert.match(await fadaPage.locator('#rows').textContent(),/Confirmado/)
 assert.equal(await fadaPage.locator('#schedule-date-field').isVisible(),true)
 await fadaPage.locator('#sort-order').selectOption('schedule')
 assert.match(await fadaPage.locator('#rows tr').first().textContent(),/Família Sábado/)
 await fadaPage.locator('#schedule-date-filter').selectOption('2026-12-13')
 assert.equal(await fadaPage.locator('#count').textContent(),'1 registro(s)')
 assert.match(await fadaPage.locator('#rows').textContent(),/Família Domingo/)
 await fadaPage.locator('#schedule-date-filter').selectOption('')
 const [download]=await Promise.all([
  fadaPage.waitForEvent('download'),
  fadaPage.locator('#export').click()
 ])
 const csv=fs.readFileSync(await download.path(),'utf8')
 // O exportador protege as células com aspas no CSV.
 const csvValues=csv.replaceAll('"','')
 assert.match(csvValues,/Dia do ensaio;Horário do ensaio;Situação da reserva/)
 assert.ok(csvValues.includes('12/12/2026;10:00 – 10:30;Solicitado'),'CSV com horário da família de sábado')
 assert.ok(csvValues.includes('13/12/2026;09:30 – 09:45;Confirmado'),'CSV com horário confirmado de domingo')
 // Pagamento pendente não pode liberar a confirmação.
 const fadaConfirm=fadaPage.locator('.action-confirm-schedule')
 assert.equal(await fadaConfirm.count(),1)
 assert.equal(await fadaConfirm.isDisabled(),true)
 assert.match(await fadaConfirm.getAttribute('title'),/pagamento integral/)
 await fadaPage.getByRole('button',{name:'R$ Conferir'}).first().click()
 await fadaPage.locator('#pay-status').selectOption('pago_manual')
 await fadaPage.locator('#pay-amount').fill('270,00')
 await fadaPage.locator('#pay-method').selectOption('pix')
 await fadaPage.locator('#pay-verified').check()
 await fadaPage.locator('#pay-save').click()
 await fadaPage.waitForFunction(()=>document.querySelector('.action-confirm-schedule:not(:disabled)'))
 assert.equal(fadaRows[0].agendamento_status,'solicitado','Pagamento não confirma horário automaticamente')
 await fadaPage.locator('.action-confirm-schedule').click()
 await fadaPage.waitForFunction(()=>document.querySelector('#error')?.hidden===false)
 assert.match(await fadaPage.locator('#error').textContent(),/Conflito de horário/)
 assert.equal(fadaRows[0].agendamento_status,'solicitado')
 assert.equal(await fadaPage.locator('.action-confirm-schedule').isEnabled(),true)
 await fadaPage.locator('.action-confirm-schedule').click()
 await fadaPage.waitForFunction(()=>document.querySelectorAll('.schedule-confirmado').length===2)
 assert.equal(fadaRows[0].agendamento_status,'confirmado')
 assert.equal(await fadaPage.locator('.action-confirm-schedule').count(),0)
 assert.equal(fadaRows[0].valor_recebido_centavos,27000,'Confirmação não altera pagamento')
 for(const width of [320,390,768]){
  await fadaPage.setViewportSize({width,height:844})
  const d=await fadaPage.evaluate(()=>({
   w:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
  }))
  assert.ok(d.scroll<=d.w+1,'Sem overflow na agenda: '+JSON.stringify(d))
 }
 assert.deepEqual(fadaErrors,[],'Sem exceções JS na campanha Fada')
 await fadaPage.close()
 assert.deepEqual(errors,[],'Sem exceções JS')
 for(const action of ['central_listar','planilha_configurar_colunas','planilha_editar_resposta','central_registrar_pagamento','central_arquivar','gente_atualizar_agendamento'])
  assert.ok(history.includes(action),'Ação não testada: '+action)
 console.log('Planilha: editar, cores, colunas, pagamento/reversão, remoção, restauração, 320–1440px aprovados.')
}finally{
 await browser.close()
 await new Promise(resolve=>srv.close(resolve))
}
