import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const html=fs.readFileSync('index.html','utf8')
const extract=(a,b)=>{
 const start=html.indexOf(a),end=html.indexOf(b,start+a.length)
 assert.ok(start>=0&&end>start,'Trecho inexistente: '+a)
 return html.slice(start,end)
}
const funcoes=extract('const PORTFOLIO_FONTES_CHAVE =','// ── Portfólio privado do Dashboard')
const embaralhar=extract('function _portfolioAdminReembaralhar() {','function _portfolioAdminNumColunas()')
const id=n=>('00000000-0000-4000-8000-'+String(n).padStart(12,'0'))
const [a,b,c,d,e,f]=Array.from({length:6},(_,i)=>id(i+1))
const fotos=[
 {id:a,evento_id:'evA',subpasta:'Pasta 1',storage_path:'a.jpg',criado_em:'2026-11-01',_score:1},
 {id:b,evento_id:'evA',subpasta:'Pasta 1',storage_path:'b.jpg',criado_em:'2026-11-02',_score:2},
 {id:c,evento_id:'evA',subpasta:'Pasta 2',storage_path:'c.jpg',criado_em:'2026-11-03',_score:3},
 {id:d,evento_id:'evA',subpasta:'Pasta 2',storage_path:'d.jpg',criado_em:'2026-11-04',_score:4},
 {id:e,evento_id:'evB',subpasta:'Palco',storage_path:'e.jpg',criado_em:'2026-11-05',_score:5},
 {id:f,evento_id:'evC',subpasta:'Retrato',storage_path:'f.jpg',criado_em:'2026-11-06',_score:6}
]
let queryCount=0
function db() {
 return {from(table) {
  assert.equal(table,'fotos')
  const filters=[]; let limit=Infinity,order='criado_em',reverse=false
  const builder={
   select(){queryCount++;return builder},
   eq(field,value){filters.push(x=>x[field]===value);return builder},
   in(field,ids){const set=new Set(ids);filters.push(x=>set.has(x[field]));return builder},
   order(field,opt){order=field;reverse=opt?.ascending===false;return builder},
   limit(n){limit=n;return builder},
   then(ok,err){
    const found=fotos.filter(x=>filters.every(fn=>fn(x))).sort((a,b)=>{
     const c=String(a[order]||'').localeCompare(String(b[order]||''))
     return reverse?-c:c
    }).slice(0,limit)
    return Promise.resolve({data:found,error:null}).then(ok,err)
   }
  }
  return builder
 }}
}
let renderCount=0
const ctx=vm.createContext({
 db:db(),_appConfig:{},store:{eventos:[
  {id:'evA',escola_id:'schoolA',nome:'Escola A'},
  {id:'evB',escola_id:'schoolB',nome:'Escola B'},
  {id:'evC',escola_id:null,nome:'Ensaio'}
 ],escolas:[]},
 meuPerfil:{role:'super_admin'},_portfolioAdminBase:{grupos:[
  {id:'aluno',nome:'Bailarina',escola_id:'schoolA',fotos:fotos.slice(0,4)},
  {id:'aluno2',nome:'Bailarino',escola_id:'schoolB',fotos:[fotos[4]]},
  {id:'fonte:evC',nome:'Retrato',escola_id:null,fotos:[fotos[5]]}
 ]},
 _portfolioFavoritos:new Set(),_portfolioAdminFotos:[],_portfolioAdminHero:null,
 _portfolioAdminEmbaralhar:l=>l,_renderPortfolioAdmin(){renderCount++},
 nomeEscola:id=>id||'',
 Promise,Set,Map,Date,Array,console
})
vm.runInContext(funcoes+'\n'+embaralhar,ctx)
const filtro=()=>vm.runInContext('_portfolioFiltroAtual()',ctx)
const preview=async()=>await vm.runInContext('_portfolioPreviewSelecionadas',ctx)(filtro())
function set(cfg){ctx._appConfig.portfolio_fontes_v1=JSON.stringify(cfg)}
set({modo:'selecionados',escolas:['schoolA'],eventos:[],pastas:[]})
assert.equal(filtro().fotos.length,0,'Configuração v1 preservada')
let res=await preview()
assert.deepEqual([...res.map(x=>x.id)],[d,c,b,a].map(String))
set({modo:'selecionados',escolas:['schoolA'],eventos:[],pastas:[],fotos:[a,b,c,d],capa:d})
res=await preview()
assert.deepEqual([...res.map(x=>x.id)],[d,c,b,a])
vm.runInContext('_portfolioAdminReembaralhar()',ctx)
assert.equal(ctx._portfolioAdminHero.id,d,'Capa fixa sem depender do score')
assert.equal(ctx._portfolioAdminFotos.length,3,'Mostra todas as 4 fotos escolhidas, não limita a 3 por aluno')
set({modo:'selecionados',escolas:['schoolA'],eventos:[],pastas:[],fotos:[a],capa:d})
res=await preview()
assert.deepEqual([...res.map(x=>x.id)],[d,a],'Capa adicionada ao conjunto')
set({modo:'selecionados',escolas:['schoolA'],eventos:[],pastas:[],fotos:[e],capa:e})
res=await preview()
assert.equal(res.length,0,'Bloqueia fotos fora da escola escolhida')
set({modo:'todos',escolas:[],eventos:[],pastas:[],fotos:[],capa:c})
res=await preview()
assert.equal(res[0].id,c,'Capa fixa com seleção automática')
vm.runInContext('_portfolioAdminReembaralhar()',ctx)
assert.equal(ctx._portfolioAdminHero.id,c)
set({modo:'todos',escolas:[],eventos:[],pastas:[],fotos:[f,e],capa:f})
res=await preview()
assert.deepEqual([...res.map(x=>x.id)],[f,e],'Fotos individuais em fontes automáticas')
vm.runInContext('_portfolioAdminReembaralhar()',ctx)
assert.equal(ctx._portfolioAdminHero.id,f)
assert.equal(ctx._portfolioAdminFotos.length,1)
assert.ok(renderCount>=3)

const expected=[
 'id="portfolio-fotos-grade"','id="portfolio-fotos-busca"',
 'id="portfolio-fotos-origem"','id="portfolio-editor-capa-preview"',
 'id="portfolio-editor-contador"',
 'id="portfolio-fotos-so-marcadas"',
 'onclick="_portfolioEditorLimparFotos()"',
 'function _portfolioEditorDefinirCapa(id)',
 'function _portfolioEditorAlternarFoto(id)',
 'function _portfolioEditorBuscarPagina(reiniciar=false)',
 'function _portfolioEditorTrocarOrigem()',
 'cfg.fotos=[..._portfolioEditorFotos]',
 'cfg.capa=capaFoto',
 "query.range(indice,indice+PORTFOLIO_EDITOR_LOTE-1)",
 'const PORTFOLIO_EDITOR_LOTE = 48',
 'const PORTFOLIO_EDITOR_MAX_FOTOS = 250'
]
for(const fragment of expected)assert.ok(html.includes(fragment),'Faltando controle: '+fragment)
assert.ok(queryCount>=6)
console.log('✓ Portfólio: capa fixa, foto individual, filtro por escola, compatibilidade v1, fotos sem marcação e limites da grade.')
