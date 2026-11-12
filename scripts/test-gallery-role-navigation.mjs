import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html = fs.readFileSync('index.html', 'utf8')
function extract(begin, end) {
  const i = html.indexOf(begin), j = html.indexOf(end, i + begin.length)
  assert.ok(i >= 0 && j > i, 'Função ausente: ' + begin)
  return html.slice(i, j)
}
const loadAll = extract('async function _galBuscarTodasAsLinhas(', '// Busca fotos específicas em blocos seguros')
const schoolLoad = extract('async function iniciarViewEscola() {', '// ponto de entrada único da Galeria')
const adminLoad = extract('async function iniciarGaleriaAdmin() {', 'function _galIrRaiz()')
const openSchool = extract('function verGaleriaDaEscola(escolaId) {', 'function verComunidadeDaEscola(')

const fotos = Array.from({length:2425}, (_,i) => ({
  id:'f'+String(i).padStart(5,'0'), evento_id:'ev1',
  storage_path:'ev1/foto'+i+'.jpg', subpasta:i%2?'A':'B'
}))
const fotoAluno = Array.from({length:1005}, (_,i) => ({foto_id:fotos[i].id, aluno_id:'al1'}))
const fotoPessoa = Array.from({length:1262}, (_,i) => ({foto_id:fotos[i].id, user_id:'p1'}))
const base = {
  eventos:[{id:'ev1',nome:'Espetáculo',escola_id:'school1',tipo:'evento'}],
  alunos:[{id:'al1',nome:'Aluna',escola_id:'school1'}],
  escolas:[{id:'school1',nome:'Escola'}],
  turmas:[{id:'t1',nome:'Turma'}],
  fotos,foto_aluno:fotoAluno,foto_pessoa:fotoPessoa
}

function makeDb(data) {
  const stats = {active:0,max:0,requests:[],pages:[]}
  function deliver(table, rows) {
    stats.active++
    stats.max = Math.max(stats.max, stats.active)
    stats.requests.push(table)
    return new Promise(resolve => setTimeout(() => {
      stats.active--
      resolve({data:rows,error:null})
    }, 3))
  }
  const db = {from(table) {
    const filters=[]
    const filtered=()=> (data[table] || []).filter(row => filters.every(fn=>fn(row)))
    const b = {
      select(){return b},order(){return b},
      eq(col,val){filters.push(row=>row[col]===val);return b},
      in(col,values){const set=new Set(values);filters.push(row=>set.has(row[col]));return b},
      range(a,z){
        stats.pages.push({table,a,z})
        return deliver(table, filtered().slice(a,z+1))
      },
      then(yes,no){return deliver(table,filtered().slice(0,1000)).then(yes,no)}
    }
    return b
  }}
  return {db,stats}
}

for (const role of ['proprietario','diretor','professor']) {
  const {db,stats}=makeDb(base)
  let rendered=0, professorDashboard=0
  const ctx=vm.createContext({
    db,store:{escolas:[],turmas:[],eventos:[],alunos:[],fotos:[],fotoAluno:[],fotoPessoa:[]},
    meuPerfil:{role,escola_id:'school1'},_galCargaSeq:0,
    renderGaleriaAdmin(){rendered++},toast(s){throw new Error(s)},
    document:{getElementById(){return {style:{}}}},
    _iniciarDashboardProfessor(){professorDashboard++},setEscolaTab(){},
    console,Promise,Set,Map,Array,Date,Number,String
  })
  vm.runInContext(loadAll+'\n'+schoolLoad,ctx)
  await vm.runInContext('iniciarViewEscola()',ctx)
  assert.equal(ctx.store.fotos.length,2425,'Sem fotos truncadas para '+role)
  assert.equal(ctx.store.fotoAluno.length,1005)
  assert.equal(ctx.store.fotoPessoa.length,1262)
  assert.equal(ctx.store.eventos.length,1)
  assert.equal(ctx.store.alunos.length,1)
  assert.equal(ctx.store.escolas.length,1)
  assert.equal(ctx.store.turmas.length,1)
  assert.equal(rendered,1)
  assert.equal(professorDashboard,role==='professor'?1:0)
  assert.ok(stats.max>=5,role+': metadados e fotos precisam iniciar em paralelo')
  assert.equal(stats.pages.filter(x=>x.table==='fotos').length,3,
    '2.425 fotos devem caber em 3 páginas sem perda (1000+1000+425)')
  assert.ok(stats.pages.every(x=>x.z-x.a+1<=1000),'PostgREST limite respeitado')
}

// Admin: navegação responde ao clique sem aguardar a rodada de banco.
// O DOM inicial pode usar dados anteriores; o retorno atualiza a mesma pasta.
{
  const {db}=makeDb(base)
  let renders=0
  const ctx=vm.createContext({
    db,store:{escolas:base.escolas,eventos:base.eventos,alunos:base.alunos,
      fotos:[],fotoAluno:[],fotoPessoa:[]},_galCargaSeq:0,
    renderGaleriaAdmin(){renders++},
    toast(s){throw new Error(s)},console,Promise,Set,Map,Array,Date,Number,String
  })
  vm.runInContext(loadAll+'\n'+adminLoad,ctx)
  const loading=vm.runInContext('iniciarGaleriaAdmin()',ctx)
  assert.equal(renders,1,'A primeira navegação do admin deve renderizar antes da rede')
  await loading
  assert.equal(renders,2,'Depois da carga, fotos e vínculos aparecem')
  assert.equal(ctx.store.fotos.length,2425)
  assert.equal(ctx.store.fotoPessoa.length,1262)

  // O atalho de uma escola não pode aguardar a rede para entrar na pasta.
  vm.runInContext('function setAdminTab() {}\n'+openSchool,ctx)
  vm.runInContext("verGaleriaDaEscola('school1')",ctx)
  assert.equal(ctx._galEscolaId,'school1')
  assert.equal(ctx._galRaiz,'escolas')
  await new Promise(resolve=>setTimeout(resolve,45))
  assert.equal(ctx._galEscolaId,'school1','A resposta atrasada não volta à raiz')
}

assert.match(html,/function _galAbrirAlbum\(eventoId\)[\s\S]{0,300}renderGaleriaAdmin\(\)/)
assert.match(html,/seq !== _galAlbumAberturaSeq \|\| _galAlbumId !== eventoId/)
assert.match(html,/_cancelarGridFotosPaginado\(wrap\)/)
assert.match(html,/const GAL_LOTE_FOTOS = 16/)
console.log('✓ Administração + escola: clique imediato, proprietário/diretor/professor, 2.425 fotos, 3 páginas, vínculos e sem perda de navegação.')
