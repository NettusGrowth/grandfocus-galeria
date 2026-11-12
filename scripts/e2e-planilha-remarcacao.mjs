import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {chromium} from 'playwright'

const root=path.resolve('dist')
for(const file of ['contratar/planilha/index.html','contratar/planilha/planilha.js',
 'contratar/planilha/planilha.css']) assert.ok(fs.existsSync(path.join(root,file)),file)
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const srv=http.createServer((req,res)=>{
 const u=new URL(req.url||'/', 'http://localhost')
 let file=path.resolve(root,'.'+u.pathname)
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html')
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'})
 fs.createReadStream(file).pipe(res)
})
await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true})
const origin='http://127.0.0.1:'+srv.address().port
const records={
 'natal-fada-acucarada-2026':{
  id:'11111111-1111-4111-8111-111111111111',origem:'formulario_site',
  respondido_em:'2026-11-12T14:00:00Z',responsavel_nome:'Mãe da Bailarina',
  responsavel_whatsapp:'16999998888',bailarina_nome:'Criança Um, Criança Dois',
  alunos_inscritos:[{nome:'Criança Um'},{nome:'Criança Dois'}],
  experiencia_original:'Natal Fada Açucarada',valor_informado_centavos:14500,
  valor_recebido_centavos:14500,pagamento_situacao:'pago_manual',
  horario_id:'22222222-2222-4222-8222-222222222222',agendamento_status:'confirmado',
  planilha_cor:'sem',planilha_nota:'',planilha_campos:{},
 },
 'gente-que-danca-2026':{
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',origem:'formulario_site',
  respondido_em:'2026-11-12T14:00:00Z',responsavel_nome:'Mãe da Gente',
  responsavel_whatsapp:'16999998889',bailarina_nome:'Bailarina Um',
  alunos_inscritos:[{nome:'Bailarina Um'}],
  experiencia_original:'Gente que Dança',valor_informado_centavos:15000,
  valor_recebido_centavos:0,pagamento_situacao:'pendente',
  horario_id:'66666666-6666-4666-8666-666666666666',agendamento_status:'solicitado',
  planilha_cor:'sem',planilha_nota:'',planilha_campos:{},
 }
}
const slots={
 'natal-fada-acucarada-2026':[
  {id:'22222222-2222-4222-8222-222222222222',dia:'2026-12-12',inicio:'08:00',fim:'08:30',disponivel:true},
  {id:'33333333-3333-4333-8333-333333333333',dia:'2026-12-13',inicio:'09:00',fim:'09:30',disponivel:true},
  {id:'44444444-4444-4444-8444-444444444444',dia:'2026-12-13',inicio:'09:30',fim:'10:00',disponivel:false},
 ],
 'gente-que-danca-2026':[
  {id:'66666666-6666-4666-8666-666666666666',dia:'2026-12-15',inicio:'18:00',fim:'18:15',disponivel:true},
  {id:'77777777-7777-4777-8777-777777777777',dia:'2026-12-15',inicio:'18:15',fim:'18:30',disponivel:true},
  {id:'88888888-8888-4888-8888-888888888888',dia:'2026-12-15',inicio:'18:30',fim:'18:45',disponivel:false}
 ]
}
const history=[]
let conflictNext=false
async function openCampaign(slug){
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 page.on('dialog',d=>d.accept())
 await page.route('https://esm.sh/**',route=>route.fulfill({
  status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},
  body:"export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fake-admin-token'}}})}}}"
 }))
 await page.route('**/functions/v1/contratacao-admin',route=>{
  const b=JSON.parse(route.request().postData()||'{}')
  assert.equal(b.slug,slug)
  history.push({slug,action:b.action,body:b})
  const r=records[slug]
  const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(b.action==='central_listar')return ok({
   campanha:{nome:slug,planilha_colunas:[]},respostas:[r],pedidos:[],acompanhamentos:[],
   horarios:slots[slug].map(x=>({id:x.id,dia:x.dia,inicio:x.inicio+':00',duracao_minutos:15}))
  })
  if(b.action==='planilha_horarios_remarcacao')return ok({
   ok:true,quantidade:r.alunos_inscritos.length,horario_atual_id:r.horario_id,
   horarios:slots[slug].map(x=>({...x,atual:x.id===r.horario_id}))
  })
  if(b.action==='planilha_editar_resposta'){
   if(b.novo_horario_id){
    assert.equal(b.horario_anterior_id,r.horario_id)
    if(conflictNext){conflictNext=false;return ok({error:'O horário foi ocupado.'},409)}
    assert.ok(slots[slug].some(x=>x.id===b.novo_horario_id&&x.disponivel))
    r.horario_id=b.novo_horario_id
   }
   r.responsavel_nome=b.nome
   r.planilha_nota=b.nota
   return ok({ok:true})
  }
  throw new Error('Ação inesperada: '+b.action)
 })
 await page.goto(origin+'/contratar/planilha/?campanha='+slug,{waitUntil:'networkidle'})
 await page.waitForSelector('#rows tr')
 return {page,errors}
}
try{
 const {page:fada,errors:fadaErrors}=await openCampaign('natal-fada-acucarada-2026')
 await fada.getByRole('button',{name:/Editar/}).first().click()
 await fada.waitForFunction(()=>document.querySelector('#edit-schedule-day')?.options.length===2)
 assert.equal(await fada.locator('#edit-schedule').isVisible(),true)
 assert.equal(await fada.locator('#edit-schedule-day').inputValue(),'2026-12-12')
 await fada.locator('#edit-schedule-day').selectOption('2026-12-13')
 assert.equal(await fada.locator('#edit-schedule-time option[value="44444444-4444-4444-8444-444444444444"]').isDisabled(),true)
 await fada.locator('#edit-schedule-time').selectOption('33333333-3333-4333-8333-333333333333')
 await fada.locator('#edit-save').click()
 await fada.waitForFunction(()=>document.querySelector('#rows')?.textContent?.includes('13/12/2026'))
 assert.equal(records['natal-fada-acucarada-2026'].horario_id,
   '33333333-3333-4333-8333-333333333333')
 assert.equal(records['natal-fada-acucarada-2026'].agendamento_status,'confirmado')
 assert.equal(records['natal-fada-acucarada-2026'].valor_recebido_centavos,14500)
 // Conflito ao salvar: o servidor recusa e o modal permanece para nova tentativa.
 await fada.getByRole('button',{name:/Editar/}).first().click()
 await fada.waitForFunction(()=>document.querySelector('#edit-schedule-day')?.options.length===2)
 await fada.locator('#edit-schedule-day').selectOption('2026-12-12')
 await fada.locator('#edit-schedule-time').selectOption('22222222-2222-4222-8222-222222222222')
 conflictNext=true
 await fada.locator('#edit-save').click()
 await fada.waitForFunction(()=>document.querySelector('#edit-error')?.textContent?.includes('ocupado'))
 assert.equal(await fada.locator('#edit-dialog').evaluate(el=>el.open),true)
 assert.equal(records['natal-fada-acucarada-2026'].horario_id,'33333333-3333-4333-8333-333333333333')
 await fada.locator('#edit-cancel').click()
 for(const width of [320,390,768,1440]){
  await fada.setViewportSize({width,height:844})
  const x=await fada.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}))
  assert.ok(x.scroll<=x.client+1,'Layout vazou: '+JSON.stringify({width,...x}))
 }
 assert.deepEqual(fadaErrors,[])
 await fada.close()

 const {page:gente,errors:genteErrors}=await openCampaign('gente-que-danca-2026')
 await gente.getByRole('button',{name:/Editar/}).first().click()
 await gente.waitForFunction(()=>document.querySelector('#edit-schedule-time')?.options.length===4)
 assert.equal(await gente.locator('#edit-schedule-day option').count(),1)
 await gente.locator('#edit-schedule-time').selectOption('77777777-7777-4777-8777-777777777777')
 await gente.locator('#edit-save').click()
 await gente.waitForFunction(()=>document.querySelector('#rows')?.textContent?.includes('18:15'))
 assert.equal(records['gente-que-danca-2026'].valor_recebido_centavos,0)
 assert.equal(records['gente-que-danca-2026'].agendamento_status,'solicitado')
 assert.deepEqual(genteErrors,[])
 await gente.close()
 assert.equal(history.filter(h=>h.action==='planilha_editar_resposta'&&h.body.novo_horario_id).length,3)
 console.log('✓ Planilha: remarcação de data e hora Fada/Gente, bloqueio de conflitos, pagamento e confirmação preservados, responsivo.')
} finally {
 await browser.close()
 await new Promise(resolve=>srv.close(resolve))
}
