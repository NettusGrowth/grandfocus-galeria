'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const built = fs.readFileSync('dist/index.html','utf8')
const source = fs.readFileSync('index.html','utf8')
const begin = built.indexOf('// Download individual das fotos de Seleção:')
const end = built.indexOf('function _renderSelecaoFotosGrid()', begin)
assert.ok(begin > 0 && end > begin, 'Admin individual-download helper missing from generated HTML')
assert.equal(built.split('function _selecaoBaixarOriginal(').length - 1, 1, 'Download function duplicated')
assert.equal(built.split('  _selecaoMontarDownloadsAdmin(g, grid)\n').length - 1, 1, 'Photo grid must add exactly one download control per photo')
assert.ok(built.includes('#sel-fotos-grid .foto-item .selfoto-download'), 'Selection download button CSS missing')
assert.ok(!source.includes('function _selecaoBaixarOriginal('), 'Build patch must not accidentally duplicate a source implementation')
assert.ok(built.includes('storage_path_alta'), 'High resolution storage key required')
assert.ok(built.includes("meuPerfil?.role !== 'super_admin'"), 'Role guard required')
assert.ok(built.includes('const _selecaoDownloadsAtivos = new Set()'), 'Re-entrancy guard required')
const helper = built.slice(begin, end)

const photoId = '22222222-2222-4222-8222-222222222222'
const path = 'selecoes/11111111-1111-4111-8111-111111111111/alta-111.jpg'
function fresh(role='super_admin',opts={}) {
  const photo = {id:photoId,storage_path: 'selecoes/11111111-1111-4111-8111-111111111111/leve-111.jpg',
    storage_path_alta: opts.missingOriginal ? null : path,
    nome_original: 'Bailarina 001.PNG', bonus: !!opts.bonus}
  const gallery={id:'11111111-1111-4111-8111-111111111111',fotos:[photo]}
  const calls={sign:[],legacy:[],clicked:[],audit:[],native:[],toast:[],buttons:[]}
  const grid={}
  const card={parentElement:grid,appendChild(button){calls.buttons.push(button)}}
  const document={
    getElementById(id){return id==='selfoto-'+photoId?card:null},
    createElement(tag){
      const el={tag,type:'',className:'',style:{},disabled:false,
        attrs:{},listeners:{},setAttribute(name,value){this.attrs[name]=value},
        addEventListener(name,fn){this.listeners[name]=fn},click(){calls.clicked.push(this)},remove(){this.removed=true}}
      return el
    },
    body:{appendChild(){}}
  }
  const context={
    meuPerfil:{role},
    _selecaoDetalheAtual:gallery,
    _selLoteModoAtivo:false,
    _selOrdemModoAtivo:false,
    document,console:{error(){}},
    _precisaWebShare:()=>!!opts.ios,
    _baixarFotosPrivadoNativo:async(...a)=>{calls.native.push(a)},
    _ehChaveR2Migrada:()=>!opts.legacy,
    _r2SignedUrl:async(...a)=>{calls.sign.push(a);if(opts.error)throw Error('Simulated signing error');return 'https://example.invalid/signed'},
    db:{storage:{from(){return {createSignedUrl:async(...a)=>{calls.legacy.push(a);return {data:{signedUrl:'https://example.invalid/legacy'},error:null}}}}}},
    BUCKET:'fotos-grandfocus',
    registrarAuditoria:async(...a)=>{calls.audit.push(a)},
    toast:v=>{calls.toast.push(v)}
  }
  vm.runInNewContext(helper+
    '\nglobalThis._testDownload=_selecaoBaixarOriginal;globalThis._testBuildControls=_selecaoMontarDownloadsAdmin;',context,
    {timeout:1500})
  return {context,calls,gallery,photo,grid,card}
}

async function run(){
 let checks=0
 {
  const t=fresh('admin')
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,0); checks++
  await t.context._testDownload(photoId)
  assert.equal(t.calls.sign.length,0); checks++
  assert.equal(t.calls.clicked.length,0); checks++
 }
 {
  const t=fresh('responsavel')
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,0); checks++
 }
 {
  const t=fresh('super_admin')
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,1); checks++
  assert.match(t.calls.buttons[0].attrs['aria-label'],/Baixar foto 1/); checks++
  assert.equal(t.calls.buttons[0].disabled,false); checks++
  assert.match(t.calls.buttons[0].innerHTML,/svg/); checks++
  await t.context._testDownload(photoId)
  assert.equal(t.calls.sign.length,1); checks++
  assert.equal(t.calls.sign[0][0],path); checks++
  assert.equal(t.calls.sign[0][1],120); checks++
  assert.equal(t.calls.sign[0][2],'Bailarina 001.jpg'); checks++
  assert.equal(t.calls.clicked.length,1); checks++
  assert.equal(t.calls.clicked[0].download,'Bailarina 001.jpg'); checks++
  assert.equal(t.calls.clicked[0].href,'https://example.invalid/signed'); checks++
  assert.equal(t.calls.audit.length,1); checks++
  assert.equal(t.calls.audit[0][1],'selecao_fotos'); checks++
  assert.equal(t.photo.storage_path_alta,path); checks++
  assert.match(t.photo.storage_path,/leve-111/); checks++
 }
 {
  const t=fresh('super_admin',{missingOriginal:true})
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,1); checks++
  assert.equal(t.calls.buttons[0].disabled,true); checks++
  await t.context._testDownload(photoId)
  assert.equal(t.calls.sign.length,0); checks++
 }
 {
  const t=fresh('super_admin',{ios:true})
  await t.context._testDownload(photoId)
  assert.equal(t.calls.native.length,1); checks++
  assert.equal(t.calls.native[0][0][0],path); checks++
  assert.equal(t.calls.sign.length,0); checks++
 }
 {
  const t=fresh('super_admin',{legacy:true})
  await t.context._testDownload(photoId)
  assert.equal(t.calls.legacy.length,1); checks++
  assert.equal(t.calls.sign.length,0); checks++
  assert.equal(t.calls.legacy[0][2].download,'Bailarina 001.jpg'); checks++
 }
 {
  const t=fresh('super_admin',{error:true})
  await t.context._testDownload(photoId)
  assert.equal(t.calls.clicked.length,0); checks++
  assert.ok(t.calls.toast.some(x=>x.includes('Não foi possível baixar'))); checks++
  await t.context._testDownload(photoId)
  assert.equal(t.calls.sign.length,2); checks++
 }
 {
  const t=fresh('super_admin',{bonus:true})
  t.context._testBuildControls(t.gallery,t.grid)
  assert.ok(t.calls.buttons[0].className.includes('has-bonus')); checks++
  t.context._selLoteModoAtivo=true
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,1); checks++
  t.context._selLoteModoAtivo=false
  t.context._selOrdemModoAtivo=true
  t.context._testBuildControls(t.gallery,t.grid)
  assert.equal(t.calls.buttons.length,1); checks++
 }
 console.log('PASS seleção Super Admin: '+checks+' tests; original in high resolution, role filter, filename, legacy, iOS, errors and safe UI.')
}
run().catch(e=>{console.error(e);process.exitCode=1})
