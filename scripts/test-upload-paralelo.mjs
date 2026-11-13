import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
const part=(a,b)=>{
 const i=html.indexOf(a),j=html.indexOf(b,i+a.length)
 assert.ok(i>=0&&j>i,'Uploader block not found: '+a)
 return html.slice(i,j)
}
const common=part('const GAL_UPLOAD_CONCORRENCIA=3;','// signed URL dura 300s no servidor')
const ensaio=part('async function uploadFotosEnsaio(files,subpasta,marcarPorFoto){','function _fotoItemEnsaioAdminHTML(')
const selecao=part('// Upload de seleção: mesmo limite de 3 em paralelo','async function _definirCapaSelecao(')
assert.match(html,/const GAL_UPLOAD_CONCORRENCIA=3/)
assert.match(html,/const GAL_PREVIEW_LOTE = 48/)
assert.match(html,/loading="lazy" decoding="async"/)
assert.match(html,/_previewUploadLiberarUrls\(\)/)
assert.match(common,/_galUploadRepetirFalhas/)
assert.match(common,/tentativasRegistro/)
assert.match(common,/beforeunload/)
assert.match(selecao,/ordem:ctx.ordemBase\+job.i/)

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const originalUploads=new Map()
let originalsConcurrent=0,maxOriginals=0
let thumbsConcurrent=0,maxThumbs=0
let failOriginal=true,failDbOnce=true,failTagOnce=true
const rows={fotos:[],foto_aluno:[],foto_pessoa:[],selecao_fotos:[],selecao_galerias:[]}
let nextId=0
const fakeDb={from(table){
 const conditions={}
 const b={
  eq(k,v){conditions[k]=v;return this},
  select(){return this},
  maybeSingle:async()=>({data:(rows[table]||[]).find(row=>Object.entries(conditions).every(([k,v])=>row[k]===v))||null,error:null}),
  then(resolve){return Promise.resolve({data:(rows[table]||[]).filter(row=>Object.entries(conditions).every(([k,v])=>row[k]===v)),error:null}).then(resolve)},
  insert(input){
   const values=Array.isArray(input)?input:[input]
   const saved=values.map(v=>({id:'row'+(++nextId),...v}))
   rows[table]||=[]
   rows[table].push(...saved)
   const failedPhoto=table==='fotos'&&failDbOnce&&String(saved[0].storage_path).includes('-34-')
   const failedTag=table==='foto_aluno'&&failTagOnce
   const failed=failedPhoto||failedTag
   if(failedPhoto)failDbOnce=false
   if(failedTag)failTagOnce=false
   return {
    then(resolve){return Promise.resolve({error:failed?new Error('Timeout after DB commit'):null}).then(resolve)},
    select(){return {single:async()=>({data:failed?null:saved[0],error:failed?new Error('Timeout after DB commit'):null})}}
   }
  },
  update(payload){return {eq:async(k,v)=>{
   const matched=(rows[table]||[]).find(row=>row[k]===v)
   if(matched)Object.assign(matched,payload)
   return {error:null}
  }}}
 }
 return b
}}
const elementMap=new Map()
function element(id){
 if(!elementMap.has(id)){
  let htmlSets=0,value=''
  const el={style:{},value:'',querySelector(){return null},classList:{toggle(){}},
   get innerHTML(){return value},
   set innerHTML(next){value=next;htmlSets++},
   get renderCount(){return htmlSets}}
  elementMap.set(id,el)
 }
 return elementMap.get(id)
}
const store={fotos:[],fotoAluno:[],fotoPessoa:[]}
const ev={id:'event-A',nome:'Festival',alunos_selecionados:[],pessoas_selecionadas:[]}
const ens={id:'ens-A',nome:'Retratos',alunos_selecionados:[],pessoas_selecionadas:[]}
const gal={id:'selection-A',fotos:[],capa_url:null}
let uiEventRenders=0,uiEnsaioRenders=0,uiSelectionRenders=0
let toastCount=0
const ctx=vm.createContext({
 Promise,Map,Set,Date,Array,Math,console:{...console,error(){}},
 window:{addEventListener(){}},
 document:{getElementById:element},
 store,db:fakeDb,
 setTimeout,clearTimeout,
 _r2Upload:async(path)=>{
  if(!path.includes('_thumb')&&!path.includes('/leve-')){
   originalsConcurrent++
   maxOriginals=Math.max(maxOriginals,originalsConcurrent)
   await sleep(2)
   originalsConcurrent--
   originalUploads.set(path,(originalUploads.get(path)||0)+1)
   if(failOriginal&&path.includes('-17-')){failOriginal=false;return {error:new Error('Internet falhou')}}
  }else await sleep(1)
  return {error:null}
 },
 _gerarThumbGaleria:async()=>{
  thumbsConcurrent++;maxThumbs=Math.max(thumbsConcurrent,maxThumbs)
  await sleep(1);thumbsConcurrent--
  return {blob:{},largura:1280,altura:720,larguraOriginal:6000,alturaOriginal:4000}
 },
 _gerarThumbWatermark:async()=>({}),
 _thumbPathDe:p=>p.replace(/\.jpg$/,'_thumb.jpg'),
 toast(){toastCount++},esc:x=>String(x),
 renderFotosEventoAdmin(){uiEventRenders++},
 renderFotosEnsaioAdmin(){uiEnsaioRenders++},
 _renderSelecaoFotosGrid(){uiSelectionRenders++},
 registrarAuditoria(){},
})
vm.runInContext('let _eventoAtual=null,_ensaioAtual=null,_selecaoDetalheAtual=null;let _eventoUploaderCargaSeq=0,_ensaioUploaderCargaSeq=0;',ctx)
vm.runInContext(common+ensaio+selecao,ctx)
vm.runInContext('_eventoAtual={id:"event-A",nome:"Festival",alunos_selecionados:[],pessoas_selecionadas:[]}',ctx)
const files=Array.from({length:300},(_,i)=>({name:'FOTO-'+i+'.jpg',type:'image/jpeg',size:12000000}))
ctx.uploadFiles=files
await vm.runInContext('uploadFotosEvento(uploadFiles,null)',ctx)
let statuses=vm.runInContext('_galUploadSessoes.evt.jobs.map(x=>x.estado)',ctx)
assert.equal(statuses.filter(x=>x==='ok').length,298,'298 arquivos continuam mesmo com 2 falhas')
assert.equal(statuses.filter(x=>x==='erro').length,2,'Falhas isoladas por arquivo')
assert.equal(rows.fotos.length,299,'Uma falha simulada ocorreu depois do registro persistir')
assert.ok(maxOriginals>1&&maxOriginals<=3,'No máximo três originais em paralelo')
assert.equal(maxThumbs,1,'Nunca decodificar 3 miniaturas simultaneamente')
assert.equal(element('evt-upload-status').renderCount,1,'A lista de 300 arquivos deve ser montada uma única vez')
const urlsBeforeRetry=[...originalUploads.entries()].filter(([,n])=>n>1)
assert.equal(urlsBeforeRetry.length,0)
await vm.runInContext('_galUploadRepetirFalhas("evt")',ctx)
statuses=vm.runInContext('_galUploadSessoes.evt.jobs.map(x=>x.estado)',ctx)
assert.ok(statuses.every(x=>x==='ok'),'Retentativa completa os 300 envios')
assert.equal(rows.fotos.length,300,'Nenhuma foto duplicada no banco')
assert.equal(new Set(rows.fotos.map(x=>x.storage_path)).size,300,'Caminhos únicos por foto')
assert.equal(element('evt-upload-status').renderCount,1,'Retentativa não reconstrói a lista inteira')
assert.equal(originalUploads.size,300,'Retry não troca os caminhos originais')
assert.equal([...originalUploads.values()].filter(n=>n>1).length,1,'Somente original com falha é reenviado')
assert.ok(uiEventRenders>=2,'Visualização atualizada ao finalizar e repetir')
assert.equal(vm.runInContext('_evtUploadAtivo',ctx),false,'Flag encerrada após upload')

// Cadastro em lote com alunos marcados: timeout depois do commit das marcações.
ctx.tagFiles=Array.from({length:4},(_,i)=>({name:'tag-'+i+'.jpg',type:'image/jpeg'}))
vm.runInContext('_eventoAtual.alunos_selecionados=["a1","a2"]',ctx)
await vm.runInContext('uploadFotosEvento(tagFiles,"Turma A")',ctx)
assert.equal(vm.runInContext('_galUploadSessoes.evt.jobs.filter(j=>j.estado==="erro").length',ctx),1)
assert.equal(rows.foto_aluno.length,8,'Falha de resposta não remove marcações já gravadas no banco')
await vm.runInContext('_galUploadRepetirFalhas("evt")',ctx)
assert.equal(rows.foto_aluno.length,8,'Retry não duplica relações foto-aluno')
assert.equal(store.fotoAluno.length,8,'Retry sincroniza vínculos existentes no painel')
assert.equal(vm.runInContext('_galUploadSessoes.evt.jobs.filter(j=>j.estado==="erro").length',ctx),0)

ctx.ensaioFiles=Array.from({length:110},(_,i)=>({name:'ensaio-'+i+'.jpg',type:'image/jpeg'}))
vm.runInContext('_ensaioAtual={id:"ens-A",nome:"Retratos",alunos_selecionados:[],pessoas_selecionadas:[]}',ctx)
await vm.runInContext('uploadFotosEnsaio(ensaioFiles,"Bastidores")',ctx)
assert.equal(rows.fotos.filter(x=>x.evento_id==='ens-A').length,110)
assert.ok(rows.fotos.filter(x=>x.evento_id==='ens-A').every(x=>x.subpasta==='Bastidores'))
assert.equal(uiEnsaioRenders,1)

ctx.selFiles=Array.from({length:120},(_,i)=>({name:'selecao-'+i+'.jpg',type:'image/jpeg'}))
rows.selecao_galerias.push({id:'selection-A',capa_url:null})
vm.runInContext('_selecaoDetalheAtual={id:"selection-A",fotos:[],capa_url:null}',ctx)
await vm.runInContext('uploadFotosSelecao(selFiles,false)',ctx)
assert.equal(rows.selecao_fotos.length,120)
assert.equal(new Set(rows.selecao_fotos.map(x=>x.ordem)).size,120,'Ordem única mesmo com workers paralelos')
assert.equal(new Set(rows.selecao_fotos.map(x=>x.storage_path_alta)).size,120)
assert.equal(uiSelectionRenders,1)
assert.ok(vm.runInContext('_selecaoDetalheAtual.capa_url',ctx),'Seleção ganha capa automática')
console.log('✓ Upload paralelo: 300 evento, 110 ensaio, 120 seleção, teto 3, 1 miniatura, falhas parciais, retry sem duplicatas, ordem e capa.')
