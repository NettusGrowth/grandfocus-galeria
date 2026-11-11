import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
const extract=(start,end)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length)
 assert.ok(a>=0&&b>a, 'Trecho não encontrado: '+start)
 return html.slice(a,b)
}
const hits=()=>({signCalls:0,concurrent:0,maxConcurrent:0,keys:[],binaryFetches:0})
const metrics=hits()
const ctx=vm.createContext({
 console, Date, Promise, Map, Set, Array, String, Number,
 setTimeout, clearTimeout, window:{}, URL,
 _ehChaveR2Migrada:p=>typeof p==='string'&&p.length>0,
 db:{ storage:{from(){ return {createSignedUrls:async()=>({data:[]})}}} },
 BUCKET:'fotos-grandfocus',
 _r2Api:async (action, payload)=>{
  assert.equal(action,'sign')
  metrics.signCalls++
  metrics.concurrent++
  metrics.maxConcurrent=Math.max(metrics.concurrent,metrics.maxConcurrent)
  metrics.keys.push(...payload.keys)
  assert.ok(payload.keys.length<=80, 'Nunca assinar mais de 80 por lote')
  await new Promise(r=>setTimeout(r,3))
  metrics.concurrent--
  return {urls:payload.keys.map(key=>({key,url:'https://r2.example/'+key}))}
 },
 fetch:()=>{metrics.binaryFetches++;throw Error('Não buscar os bytes da capa novamente')},
})
vm.runInContext(extract('const _cacheUrlAssinada = new Map()', '// chamar depois de QUALQUER upload'),ctx)
vm.runInContext(extract('const _cacheImagemBlob = new Map()', '// gera o <img> já pronto'),ctx)
const signed=vm.runInContext('_urlAssinada',ctx)
const paths=Array.from({length:125},(_,i)=>'evento/foto-'+i+'_thumb.jpg')
const urls=await Promise.all(paths.map(path=>signed(path)))
assert.equal(urls.length,125)
assert.equal(metrics.signCalls,2, '125 fotos juntas => apenas 2 operações assinadas (80+45)')
assert.equal(metrics.maxConcurrent<=2,true)
assert.equal(new Set(metrics.keys).size,125)
assert.equal(await signed(paths[0]),urls[0],'URL assinada deve ser deduplicada/cached')
assert.equal(metrics.signCalls,2)

const aux=vm.runInContext('_carregarImgCache',ctx)
const auxPaths=Array.from({length:100},(_,i)=>'perfis/avatar'+i+'.jpg')
const auxUrls=await Promise.all(auxPaths.map(path=>aux(path)))
assert.ok(auxUrls.every(u=>u.startsWith('https://r2.example/')))
assert.equal(metrics.binaryFetches,0,'Não existe fetch+blob da imagem auxiliar')
assert.equal(vm.runInContext('_cacheImagemBlob.size',ctx)<=64,true,
  'Cache de avatares deve ter limite de 64 URLs, nunca guardar bytes indefinidamente.')
assert.equal(vm.runInContext('_imgCacheStorage',ctx),undefined)
// Não reintroduzir 60 thumbnails de 2,5 megapixels decodificadas de uma vez.
assert.match(html,/const GAL_LOTE_FOTOS = 16/)
assert.match(html,/rootMargin: '350px 0px'/)
assert.match(html,/_cancelarGridFotosPaginado\(wrap\)/)
assert.match(html,/_cancelarGridFotosPaginado\(grid\)/)
// Evitar que abas invisíveis criem todos os DOMs e façam fetch de
// avatares no login; seguir exibindo ao abrir a aba individual.
let rendered=[]
const adminCtx=vm.createContext({
 Promise,console,
 document:{querySelector:()=>({dataset:{tab:'dashboard'}})},
 carregarEscolas:async()=>{},carregarAlunos:async()=>{},carregarEventos:async()=>{},
 carregarResponsaveis:async()=>{},carregarProfessores:async()=>{},
 carregarVinculosResponsaveis:async()=>{},carregarProfessorEscolas:async()=>{},
 carregarClientesAvulsos:async()=>{},carregarTurmas:async()=>{},
 atualizarAcessoAlvo(){},popularVinculoSelects(){},
 iniciarDashboardAdmin(){rendered.push('dashboard')},
 renderEscolas(){rendered.push('escolas')},
 renderAlunos(){rendered.push('alunos')},
 renderEventos(){rendered.push('eventos')},
 renderEnsaios(){rendered.push('ensaios')},
 renderProfessores(){rendered.push('professores')},
 renderPais(){rendered.push('pais')},
 renderTurmas(){rendered.push('turmas')},
})
vm.runInContext(extract('let _adminDadosProntos = false','async function carregarClientesAvulsos()'),adminCtx)
await vm.runInContext('iniciarViewAdmin()',adminCtx)
assert.deepEqual(rendered,['dashboard'],'Login admin deve montar somente dashboard')
vm.runInContext("_adminRenderAba('alunos')",adminCtx)
assert.deepEqual(rendered,['dashboard','alunos'])
assert.match(html,/function setAdminTab\(tab\)[\s\S]{0,480}_adminRenderAba\(tab\)/)

// Uma alteração do Realtime não deve provocar o reload global a cada
// fotografia de um envio em lote. Apenas se a tela estiver visível.
assert.match(html,/12000 - \(Date\.now\(\) - _gfRealtimeFotosUltimo\)/)
assert.match(html,/if \(!_gfRealtimeFotosTemTelaAtiva\(\)\) return/)
assert.match(html,/if \(_eventoAtual && _visivel\('evento-detalhe-wrap'\)\)/)
assert.match(html,/const idsDoAlbum = new Set\(todasFotos\.map\(f => f\.id\)\)/)
console.log('✓ 125 thumbnails em 2 lotes, URL sem bytes duplicados, cache ≤64 URLs, admin sem telas invisíveis, grade 16 e Realtime controlado.')
