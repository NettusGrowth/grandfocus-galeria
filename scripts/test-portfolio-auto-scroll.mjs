import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html = fs.readFileSync('index.html','utf8')
const start = html.indexOf('// Rolagem automática da tela de Portfólio.')
const end = html.indexOf('function _fecharPortfolioAdmin() {',start)
assert.ok(start > 0 && end > start, 'Código da rolagem automática ausente')
assert.match(html,/id="portfolio-auto-scroll-velocidade"/)
assert.match(html,/id="portfolio-auto-scroll-painel"/)
assert.match(html,/id="portfolio-auto-scroll-captura"/)
assert.match(html,/id="portfolio-auto-scroll-tela-limpa" checked/)
assert.match(html,/portfolio-gravacao-limpa/)
assert.match(html,/function _fecharPortfolioAdmin\(\) \{\s*_portfolioAutoScrollPausar\(\)/)
const listeners = new Map()
const areaListeners = new Map()
let nextRaf = 0
const frames = new Map()
const classes = new Set(['show'])
const makeButton = () => ({
  textContent:'',classList:{toggle(){}},attrs:{},
  setAttribute(k,v){this.attrs[k]=v}
})
const elements = {
  'portfolio-admin-screen':{
    classList:{contains(k){return classes.has(k)},add(k){classes.add(k)},remove(k){classes.delete(k)}}
  },
  'portfolio-admin-scroll':{
    scrollTop:0,scrollHeight:5200,clientHeight:800,
    addEventListener(k,fn){areaListeners.set(k,fn)}
  },
  'portfolio-auto-scroll-botao':makeButton(),
  'portfolio-auto-scroll-iniciar':makeButton(),
  'portfolio-auto-scroll-painel':{hidden:true},
  'portfolio-auto-scroll-velocidade':{value:'4'},
  'portfolio-auto-scroll-valor':{textContent:''},
  'portfolio-auto-scroll-tela-limpa':{checked:true}
}
const doc = {
  hidden:false,
  getElementById(k){return elements[k]||null},
  addEventListener(k,fn){listeners.set(k,fn)},
  activeElement:{blur(){}}
}
const context = vm.createContext({
  document:doc,console,toast(){},
  requestAnimationFrame(fn){const id=++nextRaf;frames.set(id,fn);return id},
  cancelAnimationFrame(id){frames.delete(id)}
})
vm.runInContext(html.slice(start,end),context)
const call=(name,...args)=>vm.runInContext(name,context)(...args)
const step=(time)=>{
  assert.ok(frames.size>0,'Quadro RAF esperado')
  const [id,fn]=frames.entries().next().value
  frames.delete(id)
  fn(time)
}
const area=elements['portfolio-admin-scroll']
const screen=elements['portfolio-admin-screen']
call('_portfolioAutoScrollAtualizarVelocidade','6')
assert.equal(elements['portfolio-auto-scroll-valor'].textContent,'6/10 · Moderada')
call('_portfolioAutoScrollIniciar')
assert.ok(screen.classList.contains('portfolio-gravacao-limpa'),'Modo Stories limpa a tela')
assert.ok(elements['portfolio-auto-scroll-painel'].hidden)
step(0)
step(16.667)
assert.ok(area.scrollTop>0.8&&area.scrollTop<1.2,'Velocidade em pixels por segundo; não pula quadros')
step(2500)
assert.ok(area.scrollTop<5,'Frames lentos não provocam salto de rolagem')
areaListeners.get('wheel')()
assert.equal(frames.size,0,'Roda do mouse interrompe a rolagem')
assert.ok(!screen.classList.contains('portfolio-gravacao-limpa'),'Controles reaparecem')
const parado=area.scrollTop
call('_portfolioAutoScrollIniciar')
step(3000)
step(3016.7)
assert.ok(area.scrollTop>parado,'Retoma do ponto onde parou')
areaListeners.get('touchstart')()
assert.equal(frames.size,0,'Toque interrompe a rolagem')
call('_portfolioAutoScrollIniciar')
step(3500)
doc.hidden=true
step(3517)
assert.equal(frames.size,0,'Aba oculta pausa automaticamente')
doc.hidden=false
area.scrollTop=4398
call('_portfolioAutoScrollIniciar')
step(4000)
step(4050)
assert.ok(area.scrollTop<=4400,'Nunca passa do fim')
assert.equal(frames.size,0,'Para automaticamente ao final')
assert.equal(elements['portfolio-auto-scroll-botao'].textContent,'⇣ Rolagem suave')
call('_portfolioAutoScrollAlternarPainel')
assert.equal(elements['portfolio-auto-scroll-painel'].hidden,false,'Abre controle de velocidade')
call('_portfolioAutoScrollAlternarPainel')
assert.equal(elements['portfolio-auto-scroll-painel'].hidden,true,'Fecha controle de velocidade')
console.log('✓ Rolagem suave: RAF, 10 velocidades, pausa mouse/toque/aba, fim de página, modo Stories e controles.')
