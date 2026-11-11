import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Regressão sem credenciais: simula limite PostgREST de 1.000 linhas
// para proprietários, responsáveis e eventos grandes.
const source=fs.readFileSync('index.html','utf8')
function extract(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length)
 assert.ok(a>=0&&b>a,'Trecho ausente: '+start)
 return source.slice(a,b)
}
const script=[
 extract('async function _galBuscarTodasAsLinhas(', '// Busca fotos específicas em blocos seguros'),
 extract('async function _galBuscarFotosPorIds(', 'async function _galAtualizarDados()'),
 extract('function _hidratarPathImg(img, path) {','const _observadoresHidratacaoImg'),
 extract('async function iniciarViewEscola() {','// ponto de entrada único da Galeria'),
 extract('async function iniciarViewResponsavel() {','// fotos onde o PRÓPRIO responsável foi marcado'),
].join('\n')
function fakeDb(tables){
 return {from(table){
   const filtros=[]
   const filtered=()=> (tables[table]||[]).filter(row=>filtros.every(fn=>fn(row)))
   const builder={
     select(){return this},order(){return this},
     eq(col,value){filtros.push(row=>row[col]===value);return this},
     in(col,values){const set=new Set(values);filtros.push(row=>set.has(row[col]));return this},
     range(start,end){return Promise.resolve({data:filtered().slice(start,end+1),error:null})},
     then(onSuccess,onError){
       // PostgREST, quando chamado sem range, responde no máximo 1.000.
       return Promise.resolve({data:filtered().slice(0,1000),error:null}).then(onSuccess,onError)
     }
   }
   return builder
 }}
}
const photos=Array.from({length:2425},(_,i)=>({id:'f'+String(i).padStart(5,'0'),evento_id:'evento1',thumb_path:'e/f'+i+'_thumb.jpg',storage_path:'e/f'+i+'.jpg'}))
const linked=Array.from({length:1083},(_,i)=>({foto_id:photos[i].id,aluno_id:'aluno1'}))
const tagged=Array.from({length:1262},(_,i)=>({foto_id:photos[i].id,user_id:'pai1'}))
const tables={fotos:photos,foto_aluno:linked,foto_pessoa:tagged,
 eventos:[{id:'evento1',nome:'Entre Estações',data:'2026-11-07'}],
 alunos:[{id:'aluno1',nome:'Bailarina',escola_id:'school1'}],
 responsavel_alunos:[{user_id:'pai1',aluno_id:'aluno1',alunos:{id:'aluno1',nome:'Bailarina',escola_id:'school1'}}]
}
let renders=0,blobDownloads=0
const ctx=vm.createContext({
 db:fakeDb(tables),meuPerfil:{role:'proprietario',escola_id:'school1'},
 store:{eventos:[],alunos:[],escolas:[{id:'school1'}],turmas:[{id:'t1'}],fotos:[],fotoAluno:[],fotoPessoa:[]},
 currentUser:{id:'pai1'},_galCargaSeq:0,
 _fotoSelecao:{clear(){}},renderGaleriaAdmin(){renders++},toast(msg){throw Error(msg)},
 _fotosPessoaisResp(){return []},document:{getElementById(){return {style:{}}}},
 _urlAssinada:async path=>'https://cdn.test/'+path,_carregarImgCache(){blobDownloads++;return Promise.resolve('blob:test')},
 console,Promise,Set,Map,Array,Date,Number,String,
})
vm.runInContext(script,ctx)
await vm.runInContext('iniciarViewEscola()',ctx)
assert.equal(ctx.store.fotos.length,2425,'A escola deve acessar todas as 2.425 fotos.')
assert.equal(ctx.store.fotoAluno.length,1083)
assert.equal(ctx.store.fotoPessoa.length,1262)
assert.equal(renders,1)
ctx.store={eventos:[],alunos:[],escolas:[],turmas:[],fotos:[],fotoAluno:[],fotoPessoa:[]}
await vm.runInContext('iniciarViewResponsavel()',ctx)
assert.equal(ctx.store.fotoAluno.length,1083,'Responsável não perde vínculos após a 1.000ª foto.')
assert.equal(ctx.store.fotoPessoa.length,1262,'Responsável não perde marcações após a 1.000ª foto.')
assert.equal(ctx.store.fotos.length,1262,'Responsável recebe todas as fotos que pode acessar, em lotes.')
const img={src:'',isConnected:true}
ctx.img=img
vm.runInContext("_hidratarPathImg(img,'evento/foto_thumb.jpg')",ctx)
await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(img.src,'https://cdn.test/evento/foto_thumb.jpg')
assert.equal(blobDownloads,0,'A grade não deve baixar o blob e a URL assinada da mesma foto.')
assert.match(source,/caches\.open\('grandfocus-aux-v2'\)/)
assert.match(source,/blob\.size <= 512 \* 1024/)
assert.match(source,/function _renderGridFotosPaginado\(gridEl, fotos/)
assert.match(source,/const fotos = await _galBuscarTodasAsLinhas\(\(\) => db\.from\('fotos'\)\.select\('\*'\)/)
console.log('✓ Galeria: 2.425 fotos, proprietário, responsável, miniaturas e cache sem duplicidade.')
