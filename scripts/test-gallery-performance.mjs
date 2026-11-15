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
assert.equal(vm.runInContext('typeof _imgCacheStorage',ctx),'undefined')
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
// Seleção: a interface original permanece intocada; apenas a frase da régua muda.
assert.match(html, /class="selpub-regua-track"/)
assert.doesNotMatch(html, /class="selpub-guia"/)
assert.doesNotMatch(html, /class="selpub-resumo-vivo"/)
assert.doesNotMatch(html, /As anteriores mantêm o preço original/)

// Comprovar a oferta do conjunto com os valores REAIS de cada galeria.
const precosEls = new Map()
const precosCtx=vm.createContext({
  document:{getElementById(id){
    if(!precosEls.has(id))precosEls.set(id,{style:{},classList:{toggle:()=>{}},textContent:'',innerHTML:''})
    return precosEls.get(id)
  }},
  fmtBRL:n=>'R$ '+Number(n).toFixed(2).replace('.',','),
  _selPub:{dados:{galeria:{
    qtd_incluida:5,preco_extra:30,
    faixas_preco:[{ate:2,preco:30},{ate:3,preco:10},{ate:null,preco:5}]
  }}},
  Math,Number,Array,
})
vm.runInContext(extract('function _selPubCalcularTotal(', 'function _selPubAtualizarContador()'),precosCtx)
function conferirOferta(qtd,esperado,precoInicial,reguaVisivel=true){
  vm.runInContext('_selPubRenderRegua('+qtd+')',precosCtx)
  assert.match(precosEls.get('selpub-regua-titulo').textContent,precoInicial)
  assert.match(precosEls.get('selpub-regua-nudge').textContent,esperado)
  assert.equal(precosEls.get('selpub-regua-track').style.display,reguaVisivel ? '' : 'none')
  assert.equal(precosEls.get('selpub-regua').style.display,'block')
}
conferirOferta(0,/^$/,/Fotos extras: R\$ 30,00 por foto/,false)
conferirOferta(1,/Mais 2 e você desbloqueia uma oferta especial/,/Fotos extras: R\$ 30,00 por foto/)
conferirOferta(2,/Falta só mais 1 foto para liberar um desconto especial/,/Fotos extras: R\$ 30,00 por foto/)
conferirOferta(3,/Desconto liberado! 3 fotos extras por R\$ 70,00.*economizou R\$ 20,00/,/Fotos extras: R\$ 30,00 por foto/)
conferirOferta(4,/Desconto liberado! 4 fotos extras por R\$ 75,00.*economizou R\$ 45,00/,/Fotos extras: R\$ 30,00 por foto/)
assert.equal(vm.runInContext('_selPubCalcularTotal(_selPub.dados.galeria.faixas_preco,30,3)',precosCtx),70)
vm.runInContext('_selPub.dados.galeria={qtd_incluida:5,preco_extra:45,faixas_preco:[{ate:2,preco:45},{ate:null,preco:30}]}',precosCtx)
conferirOferta(0,/^$/,/Fotos extras: R\$ 45,00 por foto/,false)
conferirOferta(2,/Falta só mais 1 foto/,/Fotos extras: R\$ 45,00 por foto/)
conferirOferta(3,/3 fotos extras por R\$ 120,00.*economizou R\$ 15,00/,/Fotos extras: R\$ 45,00 por foto/)
vm.runInContext('_selPub.dados.galeria={qtd_incluida:0,preco_extra:25,faixas_preco:[{ate:2,preco:25},{ate:null,preco:20}]}',precosCtx)
conferirOferta(0,/^$/,/Fotos: R\$ 25,00 por foto/,false)
conferirOferta(3,/3 fotos por R\$ 70,00.*economizou R\$ 5,00/,/Fotos: R\$ 25,00 por foto/)
vm.runInContext('_selPub.dados.galeria={qtd_incluida:5,preco_extra:45,faixas_preco:[{ate:5,preco:45},{ate:null,preco:30}]}',precosCtx)
conferirOferta(0,/^$/,/Fotos extras: R\$ 45,00 por foto/,false)
conferirOferta(6,/6 fotos extras por R\$ 255,00.*economizou R\$ 15,00/,/Fotos extras: R\$ 45,00 por foto/)
vm.runInContext('_selPub.dados.galeria={qtd_incluida:5,preco_extra:30,faixas_preco:null}',precosCtx)
conferirOferta(0,/^$/,/Fotos extras: R\$ 30,00 por foto/,false)
conferirOferta(1,/^$/,/Fotos extras: R\$ 30,00 por foto/,false)
assert.doesNotMatch(html,/✨ Escolha \$\{alvo\}/)
console.log('✓ Descoberta progressiva: preço único na entrada, promoção só após extras, valores reais 70/120 e poupança, sem preço fictício.')
console.log('✓ 125 thumbnails em 2 lotes, URL sem bytes duplicados, cache ≤64 URLs, admin sem telas invisíveis, grade 16 e Realtime controlado.')
