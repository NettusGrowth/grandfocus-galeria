'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const zip=require('@zip.js/zip.js')
const html=fs.readFileSync('dist/index.html','utf8')
const source=fs.readFileSync('index.html','utf8')
const begin=html.indexOf('// ZIP dos originais em Álbuns & Eventos')
const end=html.indexOf('function renderEventos() {',begin)
assert.ok(begin>0&&end>begin,'ZIP handler missing')
assert.equal(html.split('async function _albumBaixarOriginais(').length-1,1,'ZIP handler duplicated')
assert.ok(!source.includes('_albumZipEntradas('),'Original gallery source must remain untouched')
assert.ok(fs.existsSync('dist/assets/gf-zip-2.8.21.min.js'),'Zip library missing from static assets')
const helper=html.slice(begin,end)
const id='11111111-1111-4111-8111-111111111111'
const photos=[
 {id:'a',storage_path:id+'/a.jpg',subpasta:'Ato 1',nome_original:'DSC 001.JPG',criado_em:'2026-01-01',ordem:2},
 {id:'b',storage_path:id+'/b.jpg',subpasta:'Ato 2',nome_original:'DSC 002.JPG',criado_em:'2026-01-02',ordem:1},
 {id:'c',storage_path:id+'/c.jpg',subpasta:null,nome_original:'Familia.jpg',criado_em:'2026-01-03',ordem:3},
 {id:'d',storage_path:id+'/d.jpg',subpasta:'Ato 1',nome_original:'DSC 001.JPG',criado_em:'2026-01-04',ordem:1}
]
let checks=0
function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++}
function ok(a,msg){assert.ok(a,msg);checks++}
function mock(role='super_admin',opts={}){
 const calls={pick:[],sql:[],sign:[],fetch:[],audit:[],toast:[],progress:[],blob:[]}
 const chunks=[]
 let closed=false
 const stream=new WritableStream({write:chunk=>{chunks.push(Buffer.from(chunk))},close:()=>{closed=true}})
 const handle={createWritable:async()=>stream}
 const gallery={id,nome:'Entre Estações',tipo:'espetaculo',fotos:[{count:photos.length}]}
 const rowset=opts.rows??photos
 const anchor={href:'',download:'',style:{},click(){calls.blob.push({download:this.download})},remove(){}}
 const ctx={
  window:{zip,...(opts.noPicker?{}:{showSaveFilePicker:config=>{calls.pick.push(config);return Promise.resolve(handle)}})},
  document:{createElement:()=>anchor,head:{appendChild(){throw Error('Unexpected library download')}},body:{appendChild(){}}},
  store:{eventos:[gallery]},meuPerfil:{role},_baixandoPrivado:!!opts.busy,
  _galUploadAtivo:()=>!!opts.uploading,
  _galBuscarTodasAsLinhas:async q=>{q();if(opts.queryError)throw Error('Query error');if(opts.switchRole)ctx.meuPerfil.role='admin';return rowset},
  db:{from(name){calls.sql.push(['from',name]);return {
    select(x){calls.sql.push(['select',x]);return this},
    eq(k,v){calls.sql.push(['eq',k,v]);return this},
    order(k,o){calls.sql.push(['order',k,o]);return this}
  }}},
  _ehChaveR2Migrada:()=>true,
  _r2SignedUrl:async(key,ttl)=>{calls.sign.push({key,ttl});return 'https://example.invalid/'+key.split('/').pop()},
  fetch:async url=>{calls.fetch.push(url);if(opts.badFetch)throw Error('Simulated fetch failure');
    const data=Buffer.from('original-'+url.split('/').pop());return new Response(data,{headers:{'content-length':String(data.length)}})},
  _dlProgressMostrar:(title,detail,config)=>{calls.progress.push({title,detail})},
  registrarAuditoria:async(...args)=>{calls.audit.push(args)},
  toast:x=>{calls.toast.push(x)},console:{error(){},warn(){}},
  URL:{createObjectURL(blob){calls.blob.push({blob});return 'blob:mock'},revokeObjectURL(){}},
  setTimeout(){},AbortController,DOMException
 }
 vm.runInNewContext(helper+'\nglobalThis._test={download:_albumBaixarOriginais,entries:_albumZipEntradas,cancel:_albumZipCancelar}',ctx,{timeout:2000})
 return {ctx,calls,gallery,chunks,get closed(){return closed}}
}
async function entries(buffer){
 const reader=new zip.ZipReader(new zip.BlobReader(new Blob([buffer])))
 try{
  const list=await reader.getEntries()
  const out=[]
  for(const x of list)out.push([x.filename,await x.getData(new zip.TextWriter())])
  return out
 }finally{await reader.close()}
}
async function run(){
 for(const role of ['admin','responsavel','diretor','proprietario']){
  const t=mock(role)
  await t.ctx._test.download(id)
  eq(t.calls.pick.length,0,'Forbidden roles never access native file dialog')
  eq(t.calls.sql.length,0,'Forbidden roles never query photo list')
  eq(t.calls.fetch.length,0,'Forbidden roles never download original bytes')
 }
 {
  const t=mock()
  const promise=t.ctx._test.download(id)
  eq(t.calls.pick.length,1,'Native save picker called during original click')
  eq(t.calls.sql.length,0,'Native picker before network await')
  await promise
  ok(t.closed,'Streaming ZIP finalized')
  eq(t.calls.audit.length,1,'One admin audit')
  eq(t.calls.sign.length,4,'Four original URLs signed')
  eq(t.calls.fetch.length,4,'Four files fetched')
  const data=await entries(Buffer.concat(t.chunks))
  eq(data.map(x=>x[0]),[
    'Ato 1/DSC 001.jpg','Ato 1/DSC 001 (2).jpg',
    'Ato 2/DSC 002.jpg','Fotos soltas/Familia.jpg'
  ],'Folders and duplicate filenames retained')
  eq(data.map(x=>x[1]),['original-d.jpg','original-a.jpg','original-b.jpg','original-c.jpg'],'Original bytes inside ZIP')
  ok(t.calls.progress.some(x=>x.title.includes('ZIP concluído')),'Progress reports success')
 }
 {
  const t=mock()
  await t.ctx._test.download(id,'Ato 1')
  eq((await entries(Buffer.concat(t.chunks))).map(x=>x[0]),['Ato 1/DSC 001.jpg','Ato 1/DSC 001 (2).jpg'],'Selected act ZIP contains only that folder')
  ok(t.calls.pick[0].suggestedName.includes('Ato 1.zip'),'Filename identifies folder')
 }
 {
  const t=mock()
  await t.ctx._test.download(id,'')
  eq((await entries(Buffer.concat(t.chunks))).map(x=>x[0]),['Fotos soltas/Familia.jpg'],'Loose photos grouped')
 }
 {
  const t=mock('super_admin',{rows:[]})
  await t.ctx._test.download(id)
  eq(t.calls.fetch.length,0,'Empty event never fetches')
  ok(t.calls.toast.some(x=>x.includes('não possui fotos')),'Empty event explanation')
 }
 {
  const t=mock('super_admin',{badFetch:true})
  await t.ctx._test.download(id)
  eq(t.calls.fetch.length,3,'Failed requests retried 3 times')
  eq(t.calls.audit.length,0,'Failed ZIP never audited as success')
  ok(!t.calls.progress.some(x=>x.title.includes('ZIP concluído')),'Failed ZIP never marked complete')
 }
 for(const opt of [{queryError:true},{switchRole:true},{busy:true},{uploading:true}]){
  const t=mock('super_admin',opt)
  await t.ctx._test.download(id)
  eq(t.calls.fetch.length,0,'Failure/guard prevents fetch')
 }
 {
  const t=mock('super_admin',{noPicker:true})
  await t.ctx._test.download(id,'Ato 1')
  ok(t.calls.blob.some(x=>x.download?.endsWith('.zip')),'Small folders have Blob ZIP fallback')
 }
 {
  const many=Array.from({length:41},(_,i)=>({id:'p'+i,storage_path:id+'/'+i+'.jpg',subpasta:'Ato 1'}))
  const t=mock('super_admin',{noPicker:true,rows:many})
  await t.ctx._test.download(id)
  eq(t.calls.fetch.length,0,'No unsafe huge memory download without save picker')
  ok(t.calls.toast.some(x=>x.includes('Chrome ou Edge')),'Browser guidance')
 }
 {
  const lots=Array.from({length:3504},(_,i)=>({id:'p'+i,storage_path:id+'/'+i+'.jpg',subpasta:i%2?'Ato 1':'Ato 2',ordem:i}))
  const t=mock()
  const names=t.ctx._test.entries(lots,null)
  eq(names.length,3504,'All 3504 photos preserved')
  ok(names.every(x=>x.nome.startsWith('Ato 1/')||x.nome.startsWith('Ato 2/')),'Large archive folder groups')
 }
 {
  const t=mock()
  const list=t.ctx._test.entries([{id:'x',storage_path:id+'/evil.jpg',nome_original:'../../secret.JPG',subpasta:'../Bad'}],null)
  ok(!list[0].nome.split('/').includes('..'),'ZIP path traversal stripped')
 }
 for(const x of ['⬇ Baixar ZIP</button>','⬇ Baixar ZIP do evento</button>','⬇ Baixar ZIP da pasta</button>'])ok(html.includes(x),'ZIP button '+x)
 ok(html.includes("meuPerfil?.role === 'super_admin'"),'Role-guarded UI')
 ok(html.includes("meuPerfil?.role!=='super_admin'"),'Role-guarded ZIP function')
 console.log('PASS Álbuns & Eventos ZIP: '+checks+' checks; ZIP validated by re-reading entries, 3504-photo folder grouping and permissions.')
}
run().catch(error=>{console.error(error);process.exitCode=1})
