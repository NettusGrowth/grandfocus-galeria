'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const html=fs.readFileSync('dist/index.html','utf8')
const source=fs.readFileSync('index.html','utf8')
const begin=html.indexOf('// Download dos originais de Álbuns & Eventos')
const end=html.indexOf('function renderEventos() {',begin)
assert.ok(begin>0&&end>begin,'Download code missing')
assert.equal(html.split('async function _albumBaixarOriginais(').length-1,1,'Function duplicated')
assert.equal(html.split('⬇ Baixar todas do evento').length-1,1,'Event download button duplicated')
assert.equal(html.split('⬇ Baixar pasta').length-1,1,'Subfolder download button duplicated')
assert.equal(html.split('⬇ Baixar todas</button>').length-1,1,'Album-card download button duplicated')
assert.ok(!source.includes('async function _albumBaixarOriginais('),'Legacy source was unexpectedly changed')
assert.ok(html.includes('patchAlbumDownload')===false,'Builder patch source should not leak into public HTML')
assert.ok(html.includes("_galBuscarTodasAsLinhas(() => db.from('fotos')"),'Pagination must cover albums over 1,000 images')
assert.ok(html.includes("meuPerfil?.role === 'super_admin'"),'Visible buttons must be role gated')
assert.ok(html.includes("meuPerfil?.role !== 'super_admin'"),'Download function must be role gated')
const handler=html.slice(begin,end)
const id='11111111-1111-4111-8111-111111111111'
const photos=[
 {id:'a',storage_path:id+'/a.jpg',subpasta:'Ato 1'},
 {id:'b',storage_path:id+'/b.jpg',subpasta:'Ato 2'},
 {id:'c',storage_path:id+'/c.jpg',subpasta:null},
 {id:'d',storage_path:id+'/d.jpg',subpasta:'Ato 1'},
]
let total=0
function eq(actual,expected,description){assert.deepEqual(actual,expected,description);total++}
function yes(value,description){assert.ok(value,description);total++}
function setup(role='super_admin',options={}) {
 const event={id,nome:'Espetáculo de teste',tipo:'espetaculo',fotos:[{count:photos.length}]}
 const store={eventos:[event],fotos:options.fotos??photos.map(f=>({...f,evento_id:id}))}
 const calls={queries:[],download:[],toasts:[],confirm:[],audit:[]}
 let releaseDownload
 const hold=new Promise(resolve=>{releaseDownload=resolve})
 const query={
  select(columns){calls.queries.push(['select',columns]);return this},
  eq(field,value){calls.queries.push(['eq',field,value]);return this},
  order(field,value){calls.queries.push(['order',field,value]);return this}
 }
 const ctx={
   meuPerfil:{role},store,
   _baixandoPrivado:!!options.existingDownload,
   _galUploadAtivo:()=>!!options.uploading,
   _galBuscarTodasAsLinhas:async creator=>{
      creator()
      if(options.throwQuery)throw Error('Offline query failure')
      if(options.switchRole)ctx.meuPerfil.role='admin'
      return options.rows??photos
   },
   db:{from:t=>{calls.queries.push(['from',t]);return query}},
   confirmModal:async(message,opts)=>{calls.confirm.push({message,opts});return options.confirm!==false},
   toast:t=>{calls.toasts.push(t)},
   _baixarFotosPrivadoNativo:async(paths,name)=>{calls.download.push({paths:[...paths],name});if(options.wait)await hold},
   registrarAuditoria:async(...args)=>{calls.audit.push(args)},
   console:{error(){}},
 }
 vm.runInNewContext(handler+'\nglobalThis.downloadAlbum=_albumBaixarOriginais',ctx,{timeout:1000})
 return {ctx,calls,store,releaseDownload}
}

async function run() {
 for(const role of ['admin','responsavel','professor','diretor','proprietario']){
   const t=setup(role)
   await t.ctx.downloadAlbum(id)
   eq(t.calls.queries.length,0,role+' never queries/downloads')
   eq(t.calls.download.length,0,role+' cannot download')
 }
 {
   const t=setup()
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,1,'Whole event downloads once')
   eq(t.calls.download[0].paths,photos.map(f=>f.storage_path),'All four originals including subfolders')
   eq(t.calls.download[0].name,null,'Do not use regular gallery download label')
   eq(t.calls.queries[1],['select','id,storage_path,subpasta,criado_em'],'Queries only needed columns')
   yes(t.calls.queries.some(x=>x[0]==='eq'&&x[1]==='evento_id'&&x[2]===id),'Strict event ID scope')
   eq(t.calls.audit.length,1,'Admin audit per batch')
   yes(t.calls.audit[0][3].includes('4 original(is)'),'Audit count')
 }
 {
   const t=setup()
   await t.ctx.downloadAlbum(id,'Ato 1')
   eq(t.calls.download[0].paths,[id+'/a.jpg',id+'/d.jpg'],'Single act only')
 }
 {
   const t=setup()
   await t.ctx.downloadAlbum(id,'')
   eq(t.calls.download[0].paths,[id+'/c.jpg'],'Unfiled photos only')
 }
 {
   const t=setup()
   await t.ctx.downloadAlbum(id,'Ato inexistente')
   eq(t.calls.download.length,0,'Empty subfolder never downloads')
   yes(t.calls.toasts.length>0,'Empty subfolder feedback')
 }
 {
   const t=setup('super_admin',{rows:[...photos,{id:'x',storage_path:null,subpasta:'Ato 2'},{id:'y',storage_path:photos[0].storage_path,subpasta:'Ato 1'}]})
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download[0].paths,photos.map(f=>f.storage_path),'Missing/duplicate original paths handled')
 }
 {
   const lots=Array.from({length:3504},(_,i)=>({id:'photo'+i,storage_path:id+'/photo-'+i+'.jpg',subpasta:'Ato 1'}))
   const t=setup('super_admin',{rows:lots})
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,1,'Thousands of photos handled in one operation')
   eq(t.calls.download[0].paths.length,3504,'All 3504 paths kept, no 1000 cap')
   eq(t.calls.confirm.length,1,'Large download asks confirmation')
   yes(t.calls.confirm[0].message.includes('sem ZIP'),'Warn about separate downloads')
 }
 {
   const lots=Array.from({length:101},(_,i)=>({id:'photo'+i,storage_path:id+'/photo-'+i+'.jpg',subpasta:'Ato 1'}))
   const t=setup('super_admin',{rows:lots,confirm:false})
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,0,'Cancel does not download')
   eq(t.calls.audit.length,0,'Cancel does not audit')
 }
 for(const opt of [{existingDownload:true},{uploading:true}]){
   const t=setup('super_admin',opt)
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,0,'Do not overlap existing transfers')
 }
 {
   const t=setup('super_admin',{switchRole:true})
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,0,'Permission revoked during query prevents download')
 }
 {
   const t=setup('super_admin',{throwQuery:true})
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,0,'Errors do not trigger download')
   await t.ctx.downloadAlbum(id)
   eq(t.calls.toasts.length,2,'Errors release lock for retry')
 }
 {
   const t=setup('super_admin',{wait:true})
   const first=t.ctx.downloadAlbum(id)
   await Promise.resolve()
   const second=t.ctx.downloadAlbum(id)
   await second
   eq(t.calls.download.length,1,'Repeated click does not duplicate downloads')
   t.releaseDownload()
   await first
   await t.ctx.downloadAlbum(id)
   eq(t.calls.download.length,2,'Lock released after completion')
 }
 // Render actual card function for visibility and preventing click propagation.
 const cardStart=html.indexOf('function renderEventos() {')
 const cardEnd=html.indexOf('\nfunction fmtData(',cardStart)
 yes(cardStart>=0&&cardEnd>cardStart,'Event list renderer found')
 const cardSource=html.slice(cardStart,cardEnd)
 function cardFor(role,count=4){
   const t=setup(role)
   t.store.eventos[0].fotos=[{count}]
   const list={innerHTML:''}
   const c={...t.ctx,
     document:{getElementById:id=>id==='lista-eventos'?list:{value:'',innerHTML:''}},
     _popularFiltroEscolas:()=>{},_popularFiltroAnos:()=>{},_carregarImgCache:async()=>null,
     fmtData:()=>'',esc:t=>String(t),escJs:t=>String(t),nomeEscola:()=>'',ICON_LAPIS:'L',ICON_LIXEIRA:'X',}
   vm.runInNewContext(cardSource+'\nrenderEventos()',c,{timeout:1000})
   return list.innerHTML
 }
 yes(cardFor('super_admin').includes('⬇ Baixar todas'),'Superadmin sees card download button')
 yes(!cardFor('admin').includes('⬇ Baixar todas'),'Ordinary admin does not see card download')
 yes(!cardFor('responsavel').includes('⬇ Baixar todas'),'Client does not see card download')
 yes(!cardFor('super_admin',0).includes('⬇ Baixar todas'),'Empty event does not show download')
 yes(cardFor('super_admin').includes('event.stopPropagation();_albumBaixarOriginais'),'Card action does not open album')
 // Render actual subfolder UI, including collapsed folder group.
 const gridStart=html.indexOf('async function renderFotosEventoAdmin() {')
 const gridEnd=html.indexOf('function _eventoToggleSelecaoFoto(',gridStart)
 yes(gridStart>0&&gridEnd>gridStart,'Subfolder renderer found')
 const gridSource=html.slice(gridStart,gridEnd)
 async function groupFor(role) {
   const t=setup(role)
   const wrap={innerHTML:''}
   const c={...t.ctx,
     document:{getElementById:k=>k==='evt-fotos-por-subpasta'?wrap:null},
     _eventoAtual:t.store.eventos[0], _eventoFotoSelecao:new Set(),
     _eventoSubpastasConhecidas:new Set(['Ato 1','Ato 2']),
     _eventoSubpastasColapsadas:new Set(['Ato 1','Ato 2']),
     _eventoAtualizarBotaoOtimizar:()=>{},_eventoQuemPodeSerMarcado:()=>[],
     _contagemMarcacoesPorFoto:()=>new Map(),_ordenarGrupoFotos:f=>f,
     _renderGridFotosPaginado:()=>{},_atualizarToolbarEvento:()=>{},
     esc:t=>String(t),escJs:t=>String(t),ICON_LIXEIRA:'X',
   }
   await vm.runInNewContext(gridSource+'\nrenderFotosEventoAdmin()',c,{timeout:1000})
   return wrap.innerHTML
 }
 yes((await groupFor('super_admin')).includes('⬇ Baixar pasta'),'Superadmin sees folder button')
 yes(!(await groupFor('admin')).includes('⬇ Baixar pasta'),'Admin never sees folder button')
 yes(!(await groupFor('responsavel')).includes('⬇ Baixar pasta'),'Client never sees folder button')
 console.log('PASS Álbuns & Eventos: '+total+' tests; album card, event, subfolders, 3504-file case, access controls.')
}
run().catch(e=>{console.error(e);process.exitCode=1})
