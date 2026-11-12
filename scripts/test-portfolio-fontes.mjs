import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
function trecho(a,b) {
 const start=html.indexOf(a),end=html.indexOf(b,start+a.length)
 assert.ok(start>=0&&end>start,'Bloco ausente: '+a)
 return html.slice(start,end)
}
const codigo=trecho('const PORTFOLIO_FONTES_CHAVE =','// ── Portfólio privado do Dashboard')
const filas=[
 {id:'a1',evento_id:'eventoA',subpasta:'Abertura',criado_em:'2026-11-09T12:00:00Z',storage_path:'a1.jpg'},
 {id:'a2',evento_id:'eventoA',subpasta:'Final',criado_em:'2026-11-11T12:00:00Z',storage_path:'a2.jpg'},
 {id:'b1',evento_id:'eventoB',subpasta:'Outro',criado_em:'2026-11-10T12:00:00Z',storage_path:'b1.jpg'},
 {id:'c1',evento_id:'eventoC',subpasta:'Escolhida',criado_em:'2026-10-01T12:00:00Z',storage_path:'c1.jpg'},
 {id:'c2',evento_id:'eventoC',subpasta:'Não escolhida',criado_em:'2026-11-12T12:00:00Z',storage_path:'c2.jpg'},
]
const eventos=[
 {id:'eventoA',escola_id:'escolaA',nome:'Entre Estações'},
 {id:'eventoB',escola_id:'escolaB',nome:'Festival'},
 {id:'eventoC',escola_id:null,nome:'Ensaio avulso'},
]
const stats={selects:0,updates:[]}
const db={from(table){
 assert.ok(['fotos','app_config'].includes(table))
 if(table==='app_config')return {upsert:async obj=>{stats.updates.push(obj);return {error:null}}}
 const filtros=[]
 let limite=Infinity,desc=false
 const builder={
  select(){stats.selects++;return builder},
  in(col,ids){const set=new Set(ids);filtros.push(row=>set.has(row[col]));return builder},
  eq(col,valor){filtros.push(row=>row[col]===valor);return builder},
  order(col,opt){if(col==='criado_em')desc=opt?.ascending===false;return builder},
  limit(n){limite=n;return builder},
  then(resolve,reject){
   let data=filas.filter(row=>filtros.every(fn=>fn(row)))
   if(desc)data=data.sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em))
   return Promise.resolve({data:data.slice(0,limite),error:null}).then(resolve,reject)
  }
 }
 return builder
}}
const ctx=vm.createContext({
 db,store:{eventos,escolas:[{id:'escolaA',nome:'A'},{id:'escolaB',nome:'B'}]},
 _appConfig:{},meuPerfil:{role:'super_admin'},
 currentUser:{id:'admin123'},document:{},console,Promise,Set,Map,Date,Array,
 _carregarAppConfig:async()=>{},toast(){},fecharModal(){},
 _portfolioAtualizarPreviewHome:async()=>{},_abrirPortfolioAdmin:async()=>{}
})
vm.runInContext('let _portfolioAdminBase={};let _portfolioAdminFotos=[];let _portfolioAdminHero=null;'+codigo,ctx)
async function preview(config){
 ctx._appConfig.portfolio_fontes_v1=JSON.stringify(config)
 const filtro=vm.runInContext('_portfolioFiltroAtual()',ctx)
 return await vm.runInContext('_portfolioPreviewSelecionadas',ctx)(filtro)
}
const todos=await preview({modo:'todos'})
assert.equal(todos.length,5)
assert.equal(todos[0].id,'c2')
const escola=await preview({modo:'selecionados',escolas:['escolaA'],eventos:[],pastas:[]})
assert.deepEqual(escola.map(x=>x.id).sort(),['a1','a2'])
const evento=await preview({modo:'selecionados',escolas:[],eventos:['eventoB'],pastas:[]})
assert.deepEqual(evento.map(x=>x.id),['b1'])
const pasta=await preview({modo:'selecionados',escolas:[],eventos:[],pastas:[{evento_id:'eventoC',nome:'Escolhida'}]})
assert.deepEqual(pasta.map(x=>x.id),['c1'])
const misto=await preview({modo:'selecionados',escolas:['escolaA'],eventos:['eventoB'],pastas:[{evento_id:'eventoC',nome:'Escolhida'}]})
assert.deepEqual(misto.map(x=>x.id),['a2','b1','a1','c1'])
const vazio=await preview({modo:'selecionados',escolas:[],eventos:[],pastas:[]})
assert.equal(vazio.length,0)
ctx._appConfig.portfolio_fontes_v1='{invalid json'
assert.equal(vm.runInContext('_portfolioFiltroAtual().modo',ctx),'todos')

assert.match(html,/onclick="_portfolioAbrirConfiguracao\(\)"/)
assert.match(html,/id="portfolio-fontes-modal"/)
assert.match(html,/name="portfolio-fontes-modo" value="selecionados"/)
assert.match(html,/upsert\(\{chave:PORTFOLIO_FONTES_CHAVE,valor,atualizado_por:currentUser.id\}\)/)
assert.match(html,/function _portfolioFotoPermitida\(/)
assert.match(html,/_galBuscarTodasAsLinhas\(\(\) => db.from\('fotos'\)/)
assert.match(html,/_galBuscarTodasAsLinhas\(\(\) => db.from\('foto_aluno'\)/)
assert.match(html,/filtro.modo === 'selecionados'\) \{/)
assert.match(html,/if \(meuPerfil\?\.role === 'super_admin'\) _portfolioAtualizarPreviewHome\(\)/)
assert.match(html,/const filtro = meuPerfil\?\.role === 'super_admin'/)
assert.match(html,/if \(filtro.modo !== 'selecionados'\) return true/)
console.log('✓ Curadoria: escolas, eventos, pastas, união, modo padrão, persistência, paginação e prévia não superadmin.')
