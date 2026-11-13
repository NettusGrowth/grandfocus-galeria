import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
function part(start,end) {
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length)
 assert.ok(a>=0&&b>a,'Trecho ausente: '+start)
 return html.slice(a,b)
}
const code=[
 part('function renderFotosEventoAdmin() {','function _eventoToggleSelecaoFoto('),
 part('function _eventoSelecionarTodasDaPasta(', 'function _eventoLimparSelecao('),
 part('function renderFotosEnsaioAdmin() {','function _ensaioToggleSelecaoFoto('),
 part('function _ensaioSelecionarTodasDaPasta(', 'function _ensaioLimparSelecao('),
].join('\n')
assert.match(code,/function _eventoDesmarcarTodasDaPasta/)
assert.match(code,/function _ensaioDesmarcarTodasDaPasta/)
assert.match(code,/Desmarcar esta pasta/)
const event='evento-1',shoot='ensaio-1'
const fotos=[
 ...Array.from({length:3},(_,i)=>({id:'a'+i,evento_id:event,subpasta:'Ato 1'})),
 ...Array.from({length:2},(_,i)=>({id:'b'+i,evento_id:event,subpasta:'Ato 2'})),
 {id:'c',evento_id:event,subpasta:null},
 {id:'other',evento_id:'outro-evento',subpasta:'Ato 1'},
 ...Array.from({length:3},(_,i)=>({id:'s'+i,evento_id:shoot,subpasta:'Camarim'})),
 {id:'stage',evento_id:shoot,subpasta:'Palco'},
]
const els=new Map()
const get=id=>{
 if(!els.has(id))els.set(id,{innerHTML:'',style:{display:''}})
 return els.get(id)
}
let rendEvt=0,rendSho=0
const ctx=vm.createContext({
 document:{getElementById:get},
 store:{fotos},
 _eventoAtual:{id:event},_ensaioAtual:{id:shoot},
 _eventoFotoSelecao:new Set(['a0','a1','b0','c','other']),
 _ensaioFotoSelecao:new Set(['s0','s1','stage']),
 _eventoSubpastasConhecidas:new Set(['Ato 1','Ato 2']),
 _ensaioSubpastasConhecidas:new Set(['Camarim','Palco']),
 _eventoSubpastasColapsadas:new Set(['Ato 1']),
 _ensaioSubpastasColapsadas:new Set(['Camarim']),
 _eventoAtualizarBotaoOtimizar(){},_ensaioAtualizarBotaoOtimizar(){},
 _eventoQuemPodeSerMarcado(){return []},_ensaioQuemPodeSerMarcado(){return []},
 _contagemMarcacoesPorFoto(){return new Map()},
 _ordenarGrupoFotos:f=>f,
 _renderGridFotosPaginado(){},
 _atualizarToolbarEvento(){rendEvt++},
 _atualizarToolbarEnsaio(){rendSho++},
 esc:s=>String(s),escJs:s=>String(s).replaceAll("'","\\'"),
 ICON_LIXEIRA:'[trash]',console,Map,Set,Array,
})
vm.runInContext(code,ctx)
const f=expr=>vm.runInContext(expr,ctx)
f('renderFotosEventoAdmin()')
assert.match(get('evt-fotos-por-subpasta').innerHTML,/Desmarcar esta pasta \(2\)/)
assert.match(get('evt-fotos-por-subpasta').innerHTML,/Desmarcar esta pasta \(1\)/)
assert.match(get('evt-fotos-por-subpasta').innerHTML,/Selecionar todas desta pasta/)
const beforeOther=f('_eventoFotoSelecao.has("other")')
f('_eventoDesmarcarTodasDaPasta("Ato 1")')
assert.equal(f('_eventoFotoSelecao.has("a0")'),false)
assert.equal(f('_eventoFotoSelecao.has("a1")'),false)
assert.equal(f('_eventoFotoSelecao.has("b0")'),true,'Pasta Ato 2 preservada')
assert.equal(f('_eventoFotoSelecao.has("c")'),true,'Fotos soltas preservadas')
assert.equal(f('_eventoFotoSelecao.has("other")'),beforeOther,'Outro evento preservado')
assert.ok(rendEvt>=2)
f('_eventoSelecionarTodasDaPasta("Ato 1")')
assert.equal(f('_eventoFotoSelecao.has("a2")'),true,'Pode selecionar novamente')
f('_eventoDesmarcarTodasDaPasta("Ato 2")')
assert.equal(f('_eventoFotoSelecao.has("b0")'),false)
assert.equal(f('_eventoFotoSelecao.has("a2")'),true)

f('renderFotosEnsaioAdmin()')
assert.match(get('ens-fotos-por-subpasta').innerHTML,/Desmarcar esta pasta \(2\)/)
f('_ensaioDesmarcarTodasDaPasta("Camarim")')
assert.equal(f('_ensaioFotoSelecao.has("s0")'),false)
assert.equal(f('_ensaioFotoSelecao.has("s1")'),false)
assert.equal(f('_ensaioFotoSelecao.has("stage")'),true,'Pasta Palco preservada')
assert.match(get('ens-fotos-por-subpasta').innerHTML,/Selecionar todas desta pasta/)
assert.ok(rendSho>=2)
f('_ensaioSelecionarTodasDaPasta("Camarim")')
assert.equal(f('_ensaioFotoSelecao.has("s2")'),true)
console.log('✓ Pastas: desmarca apenas a pasta escolhida, preserva outras pastas/eventos, ensaio e fotos soltas, funciona com pastas recolhidas.')
