import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
function part(start,end) {
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length)
 assert.ok(a!==-1&&b>a,'Não encontrou trecho '+start)
 return html.slice(a,b)
}
const snippets=[
 part('async function _galBuscarTodasAsLinhas(', '// Busca fotos específicas em blocos seguros'),
 part('async function _galBuscarVinculosFotosAlbum(', 'function _galAbrirAlbum('),
 part('let _eventoUploaderCargaSeq = 0','async function abrirEventoAdmin('),
 part('async function abrirEventoAdmin(','// tela de conferência antes de efetivamente subir'),
 part('async function abrirEnsaioAdmin(', 'async function uploadFotosEnsaio(')
]
assert.match(snippets[3], /_uploaderCarregarAlbumCompleto\(eventoId\)/)
assert.match(snippets[4], /_uploaderCarregarAlbumCompleto\(ensaioId\)/)
assert.match(html, /\+\+_eventoUploaderCargaSeq \/\/ cancela refresh iniciado antes deste upload/)
assert.match(html, /\+\+_ensaioUploaderCargaSeq \/\/ cancela refresh iniciado antes deste upload/)

const eventId='evento-grande',smallId='evento-pequeno',ensaioId='ensaio-grande'
const fotos=[
 ...Array.from({length:1410},(_,i)=>({
   id:'f'+String(i).padStart(6,'0'),evento_id:eventId,
   criado_em:new Date(1700000000000+i*1000).toISOString(),
   storage_path:eventId+'/f'+i+'.jpg',
   subpasta:i<1000?'Abertura':i<1200?'Um dia de praia':'Ondas do verão'
 })),
 ...Array.from({length:12},(_,i)=>({
   id:'s'+i,evento_id:smallId,criado_em:new Date(1700000000000+i*1000).toISOString(),
   storage_path:smallId+'/s'+i+'.jpg',subpasta:'Única'
 })),
 ...Array.from({length:1140},(_,i)=>({
   id:'e'+String(i).padStart(6,'0'),evento_id:ensaioId,
   criado_em:new Date(1700000000000+i*1000).toISOString(),
   storage_path:ensaioId+'/e'+i+'.jpg',subpasta:i<1000?'Antes':'Depois'
 }))
]
const fa=fotos.slice(0,1150).map(f=>({foto_id:f.id,aluno_id:'aluno1'}))
const fp=fotos.slice(0,1350).map(f=>({foto_id:f.id,user_id:'cliente1'}))
const dbTables={
 fotos,
 foto_aluno:fa,
 foto_pessoa:fp,
 evento_subpastas:[...new Set(fotos.map(f=>f.evento_id+'|'+f.subpasta))].map(x=>{
  const idx=x.indexOf('|');return {evento_id:x.slice(0,idx),nome:x.slice(idx+1)}
 })
}
function makeDb({failure=false,delay=2}={}){
 const stats={pages:[],requests:0}
 const db={from(table){
  const filters=[],orders=[]
  const b={
   select(){return b},
   eq(col,val){filters.push(row=>row[col]===val);return b},
   in(col,ids){let set=new Set(ids);filters.push(row=>set.has(row[col]));return b},
   order(col,opts){orders.push({col,asc:opts?.ascending!==false});return b},
   range(start,end){return load(start,end,true)},
   then(ok,err){return load(0,999,false).then(ok,err)}
  }
  function load(start,end,ranged){
   stats.requests++
   if(ranged)stats.pages.push({table,start,end})
   let rows=(dbTables[table]||[]).filter(row=>filters.every(fn=>fn(row)))
   if(orders.length)rows=rows.slice().sort((x,y)=>{
    for(const {col,asc} of orders) {
     const cmp=String(x[col]??'').localeCompare(String(y[col]??''))
     if(cmp)return asc?cmp:-cmp
    }
    return 0
   })
   return new Promise(resolve=>setTimeout(()=>resolve(
    failure&&table==='fotos'&&start>=1000?
     {data:null,error:new Error('rede: página 2 indisponível')}:
     {data:rows.slice(start,end+1),error:null}),delay))
  }
  return b
 }}
 return {db,stats}
}
function harness(config={}){
 const {db,stats}=makeDb(config)
 const elements=new Map()
 const store={
  eventos:[
   {id:eventId,nome:'Entre Estações',tipo:'evento',capa_url:null},
   {id:smallId,nome:'Álbum pequeno',tipo:'evento',capa_url:null},
   {id:ensaioId,nome:'Ensaio grande',tipo:'ensaio',capa_url:null}
  ],
  fotos:[{id:'fora',evento_id:'outro',subpasta:'Outros'}],
  fotoAluno:[{foto_id:'fora',aluno_id:'fora'}],
  fotoPessoa:[{foto_id:'fora',user_id:'fora'}]
 }
 const rendered={eventos:[],ensaios:[]},warnings=[]
 const ctx=vm.createContext({
  db,store,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,{style:{display:''},innerHTML:'',addEventListener(){}});return elements.get(id)}},
  _ligarDropzone(){},_carregarImgCache:async()=>null,
  _todasSubpastasConhecidas(){return [...new Set(store.fotos.filter(f=>f.evento_id===vm.runInContext('_eventoAtual?.id',ctx)).map(f=>f.subpasta))]},
  _todasSubpastasConhecidasEnsaio(){return [...new Set(store.fotos.filter(f=>f.evento_id===vm.runInContext('_ensaioAtual?.id',ctx)).map(f=>f.subpasta))]},
  renderFotosEventoAdmin(){rendered.eventos.push(store.fotos.filter(f=>f.evento_id===vm.runInContext('_eventoAtual?.id',ctx)).length)},
  renderFotosEnsaioAdmin(){rendered.ensaios.push(store.fotos.filter(f=>f.evento_id===vm.runInContext('_ensaioAtual?.id',ctx)).length)},
  renderEventos(){},renderEnsaios(){},
  toast(msg){warnings.push(msg)},console:{...console,error(...x){warnings.push(x.map(String).join(' '))}},Promise,Set,Map,Array,Date
 })
 vm.runInContext('let _eventoAtual=null,_ensaioAtual=null;let _eventoFotoSelecao=new Set(),_ensaioFotoSelecao=new Set();let _eventoSubpastasConhecidas=new Set(),_ensaioSubpastasConhecidas=new Set();let _eventoSubpastasColapsadas=new Set(),_ensaioSubpastasColapsadas=new Set();let _evtUploadAtivo=false,_ensUploadAtivo=false;let _eventoVoltarContexto=null;const ICON_LAPIS="";function esc(x){return String(x??"")};function nomeEscola(){return ""};function fmtData(d){return d}',ctx)
 vm.runInContext(snippets.join('\n'),ctx)
 return {ctx,store,stats,rendered,warnings,elements}
}
{
 const t=harness()
 await vm.runInContext('abrirEventoAdmin("evento-grande")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===eventId).length,1410,'Ler todas as 1.410 fotos')
 assert.equal(t.store.fotoAluno.filter(x=>x.foto_id.startsWith('f')).length,1150)
 assert.equal(t.store.fotoPessoa.filter(x=>x.foto_id.startsWith('f')).length,1350)
 assert.equal(t.store.fotos.find(f=>f.id==='fora').evento_id,'outro','Outros álbuns preservados')
 assert.ok(t.store.fotos.some(f=>f.id==='f001409'),'Última foto deve aparecer')
 assert.ok(t.store.fotos.filter(f=>f.evento_id===eventId&&f.subpasta==='Ondas do verão').length===210)
 assert.deepEqual(t.rendered.eventos,[1410])
 assert.ok(t.stats.pages.some(p=>p.table==='fotos'&&p.start===1000),'Consulta segunda página')
 assert.ok(t.stats.pages.every(p=>p.end-p.start+1<=1000),'Respeita limite de 1.000 linhas')
 assert.ok(t.stats.pages.filter(p=>p.table==='foto_aluno').every(p=>p.end<=999))
 await vm.runInContext('_recarregarFotosEvento("evento-grande")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===eventId).length,1410,'Realtime não trunca')
 assert.equal(t.store.fotoAluno.filter(x=>x.foto_id.startsWith('f')).length,1150,'Vínculos intactos')
 assert.equal(new Set(t.store.fotos.map(f=>f.id)).size,t.store.fotos.length,'Sem duplicação após refresh')
 await vm.runInContext('abrirEventoAdmin("evento-pequeno")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===smallId).length,12)
 await vm.runInContext('abrirEnsaioAdmin("ensaio-grande")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===ensaioId).length,1140)
 assert.ok(t.store.fotos.some(f=>f.id==='e001139'),'Última foto de ensaio aparece')
 await vm.runInContext('_recarregarFotosEnsaio("ensaio-grande")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===ensaioId).length,1140)
 assert.ok(!t.warnings.length,'Sem erros inesperados: '+t.warnings)
}
{
 const t=harness({failure:true})
 await vm.runInContext('abrirEventoAdmin("evento-grande")',t.ctx)
 assert.equal(t.store.fotos.filter(f=>f.evento_id===eventId).length,0,'Falha parcial não salva 1.000 de 1.410')
 assert.equal(t.store.fotos.find(f=>f.id==='fora').evento_id,'outro')
 assert.equal(t.rendered.eventos.length,0,'Não renderiza galeria parcialmente truncada')
 assert.ok(t.warnings.some(w=>w.includes('Erro ao carregar todas as fotos')))
}
{
 const t=harness({delay:8})
 const primeira=vm.runInContext('abrirEventoAdmin("evento-grande")',t.ctx)
 const segunda=vm.runInContext('abrirEventoAdmin("evento-pequeno")',t.ctx)
 await Promise.all([primeira,segunda])
 assert.equal(t.store.fotos.filter(f=>f.evento_id===eventId).length,0,
  'Consulta antiga não deve sobrescrever novo álbum')
 assert.equal(t.store.fotos.filter(f=>f.evento_id===smallId).length,12)
}
console.log('✓ Uploader: 1.410 fotos do evento, 1.140 do ensaio, últimas pastas, 2 páginas, vínculos, Realtime, falha parcial e troca rápida.')
