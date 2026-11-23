'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const built = fs.readFileSync('dist/index.html','utf8')
const before = fs.readFileSync('index.html','utf8')
const start = built.indexOf('// Download em lote da pasta de seleção:')
const end = built.indexOf('function _renderSelecaoFotosGrid() {', start)
assert.ok(start > 0 && end > start, 'Bulk download handler missing from generated HTML')
assert.equal(built.split('function _selecaoBaixarTodasOriginais()').length-1,1,'Bulk handler duplicated')
assert.equal(built.split('onclick="event.stopPropagation();_selecaoBaixarTodasOriginais()"').length-1,1,'Bulk button duplicated')
assert.ok(!before.includes('_selecaoBaixarTodasOriginais'), 'Original HTML must not be modified')
assert.ok(built.includes('function _selecaoBaixarOriginal('), 'Individual original-photo download must remain')
assert.ok(built.includes('  _selecaoMontarDownloadsAdmin(g, grid)'), 'Individual download controls must remain')
assert.ok(built.includes('meuPerfil?.role === \'super_admin\''), 'Bulk button must be role gated')
const helper = built.slice(start,end)
const galleryId='11111111-1111-4111-8111-111111111111'
const path1='selecoes/'+galleryId+'/alta-a.jpg'
const path2='selecoes/'+galleryId+'/alta-b.jpg'
const path3='selecoes/'+galleryId+'/alta-c.jpg'

function fresh(role='super_admin', options={}) {
 const g={id:galleryId,status:'ativo',titulo:'Teste',cliente_nome:'Cliente Teste',cliente_whatsapp:null,
   qtd_incluida:5,preco_extra:45,expira_em:null,pedido:null,
   fotos:(options.paths??[path1,path2,path3]).map((path,i)=>({
      id:'photo-'+i,storage_path_alta:path,storage_path:'leve-'+i+'.jpg'
   }))}
 const calls={downloads:[],logs:[],toasts:[]}
 let resolvePending
 const blocker=new Promise(resolve=>{resolvePending=resolve})
 const ctx={
   meuPerfil:{role},_selecaoDetalheAtual:g,_baixandoPrivado:!!options.alreadyBusy,
   _selLoteModoAtivo:!!options.batchMode,_selOrdemModoAtivo:!!options.orderMode,
   _galUploadAtivo:()=>!!options.uploading,console:{error(){}},
   _baixarFotosPrivadoNativo:async(paths,name)=>{
      calls.downloads.push({paths:[...paths],name})
      if(options.delay)await blocker
      if(options.error)throw new Error('Simulated failure')
   },
   registrarAuditoria:async(...args)=>{calls.logs.push(args)},
   toast:v=>calls.toasts.push(v),
 }
 vm.runInNewContext(helper+'\nglobalThis._downloadAll=_selecaoBaixarTodasOriginais;',ctx,{timeout:1000})
 return {ctx,g,calls,resolvePending}
}
let checks=0
function okay(c,m){assert.ok(c,m);checks++}
function eq(a,b,m){assert.deepEqual(a,b,m);checks++}
async function run() {
 for (const role of ['admin','responsavel','professor','diretor','proprietario']) {
   const t=fresh(role)
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,0,'No bulk download for '+role)
   eq(t.calls.logs.length,0,'No audit of bulk download for '+role)
 }
 {
   const t=fresh()
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,1,'Exactly one batch initiated')
   eq(t.calls.downloads[0].paths,[path1,path2,path3],'All originals in visible order')
   eq(t.calls.downloads[0].name,null,'No generic photo download audit label')
   eq(t.calls.logs.length,1,'Administrative audit on batch')
   eq(t.calls.logs[0][1],'selecao_galerias','Audit targets the selection gallery')
   okay(t.calls.logs[0][3].includes('3 fotos'),'Audit contains count')
 }
 {
   const t=fresh('super_admin',{paths:[path1,null,path3]})
   await t.ctx._downloadAll()
   eq(t.calls.downloads[0].paths,[path1,path3],'Missing original is skipped')
   okay(t.calls.toasts.some(v=>v.includes('1 foto(s) sem arquivo original')),'Missing originals explained')
 }
 {
   const t=fresh('super_admin',{paths:[null,null]})
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,0,'Zero originals => no download')
 }
 {
   const t=fresh('super_admin',{paths:[]})
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,0,'Empty gallery => no download')
 }
 for(const options of [{batchMode:true},{orderMode:true},{uploading:true},{alreadyBusy:true}]) {
   const t=fresh('super_admin',options)
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,0,'Busy/organizing state blocks download')
 }
 {
   const t=fresh('super_admin',{delay:true})
   const first=t.ctx._downloadAll()
   const second=t.ctx._downloadAll()
   await second
   eq(t.calls.downloads.length,1,'Repeated click does not launch another batch')
   t.resolvePending()
   await first
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,2,'User can retry after first batch ends')
 }
 {
   const t=fresh('super_admin',{error:true})
   await t.ctx._downloadAll()
   eq(t.calls.logs.length,0,'Failed bulk operation not audited as requested')
   okay(t.calls.toasts.some(v=>v.includes('Não foi possível concluir')),'Failure shown')
   await t.ctx._downloadAll()
   eq(t.calls.downloads.length,2,'Error releases reentrancy lock')
 }
 // Evaluate the real renderer for button visibility, not just text matching.
 const renderStart=built.indexOf('function renderSelecaoDetalhe() {')
 const renderEnd=built.indexOf('// ── seleção em lote pra marcar',renderStart)
 okay(renderStart>0&&renderEnd>renderStart,'Actual detail renderer available')
 const renderer=built.slice(renderStart,renderEnd)
 function render(role,options={}) {
   const t=fresh(role,options)
   const wrap={innerHTML:''}
   t.ctx.document={getElementById(id){return id==='selecao-detalhe-wrap'?wrap:null}}
   Object.assign(t.ctx,{
     _selecaoStatusInfo:()=>({cls:'ok',label:'Ativo'}),
     fmtBRL:n=>'R$'+n, fmtData:n=>n, esc:x=>String(x),
     _selecaoPedidoHubHTML:()=>'', _selecaoDownloadsResumoHTML:()=>'',_selLoteMarcadas:new Set(),
     _selOrdemSalvando:false,_dispositivoTocavel:()=>false,
     _ligarDropzone:()=>{},_renderSelecaoFotosGrid:()=>{},_renderSelecaoPedidoFotosGrid:()=>{}
   })
   vm.runInNewContext(renderer+'\nrenderSelecaoDetalhe()',t.ctx,{timeout:1000})
   return wrap.innerHTML
 }
 okay(render('super_admin').includes('Baixar todas (3)'), 'Super Admin can see one-click bulk button')
 okay(!render('admin').includes('Baixar todas ('), 'Admin cannot see bulk button')
 okay(!render('responsavel').includes('Baixar todas ('), 'Client cannot see bulk button')
 okay(!render('super_admin',{batchMode:true}).includes('Baixar todas ('), 'Bulk button hidden while selecting')
 okay(!render('super_admin',{orderMode:true}).includes('Baixar todas ('), 'Bulk button hidden while ordering')
 okay(!render('super_admin',{paths:[null]}).includes('Baixar todas ('), 'Bulk button hidden without original files')
 okay(render('super_admin',{paths:[path1,null]}).includes('Baixar todas (1)'), 'Button shows available originals only')
 console.log('PASS seleção Super Admin: '+checks+' bulk-download checks, original file paths, RBAC, visible UI, error and reentrancy.')
}
run().catch(e=>{console.error(e);process.exitCode=1})
