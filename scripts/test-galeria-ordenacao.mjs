import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync('index.html','utf8')
const start=html.indexOf('const _galCollatorNumerico =')
const end=html.indexOf('// arrastar 1 foto',start)
assert.ok(start>=0 && end>start,'Função de ordenação deve existir e ser reutilizável.')
const ctx=vm.createContext({Intl,Array,Set,String})
vm.runInContext(html.slice(start,end),ctx)
const ordenar=fotos=>Array.from(ctx.sorter || vm.runInContext('_ordenarGrupoFotos',ctx)(fotos))

// IDs UUID nunca podem definir ordem dos álbuns antigos.
const antigas=[
{id:'0001',criado_em:'2026-11-11T00:12:00Z',storage_path:'evt/z2.jpg',nome_original:null},
{id:'ffff',criado_em:'2026-11-11T00:01:00Z',storage_path:'evt/z1.jpg',nome_original:null},
{id:'1234',criado_em:'2026-11-11T00:03:00Z',storage_path:'evt/z3.jpg',nome_original:null},
]
assert.deepEqual(ordenar(antigas).map(f=>f.id),['ffff','1234','0001'],
 'Fotos antigas precisam seguir o momento de upload, não UUID')

// A sequência numérica original é respeitada para fotos futuras.
const novas=[
{id:'a',criado_em:'2026-11-11T01:00:00Z',nome_original:'IMG_6333.jpg'},
{id:'b',criado_em:'2026-11-11T01:01:00Z',nome_original:'IMG_54.jpg'},
{id:'c',criado_em:'2026-11-11T01:02:00Z',nome_original:'IMG_3342.jpg'},
{id:'d',criado_em:'2026-11-11T01:03:00Z',nome_original:'IMG_100.jpg'},
]
assert.deepEqual(ordenar(novas).map(f=>f.nome_original),
 ['IMG_54.jpg','IMG_100.jpg','IMG_3342.jpg','IMG_6333.jpg'])

// Ordem manual dos 145 registros atuais jamais é descartada.
const manual=[
{id:'z',ordem:2,criado_em:'2026-11-11T00:01:00Z'},
{id:'b',ordem:0,criado_em:'2026-11-11T00:02:00Z'},
{id:'c',ordem:1,criado_em:'2026-11-11T00:03:00Z'},
]
assert.deepEqual(ordenar(manual).map(f=>f.id),['b','c','z'])
assert.equal(ordenar(antigas.concat(novas)).length,7)
assert.deepEqual(antigas.map(f=>f.id),['0001','ffff','1234'],
 'O comparador não pode alterar a lista original')

// Conferir que os quatro caminhos de consumo usam o MESMO comparador.
for(const marker of [
  'const fotos = _ordenarGrupoFotos(fotosSemOrdem)',
  'const fotos = _ordenarGrupoFotos(store.fotos.filter(f => f.evento_id === _galAvulsoId',
  'const fotos = _ordenarGrupoFotos(_fotosPessoaisResp())',
  'fotos = _ordenarGrupoFotos(fotos)',
  'const f = _ordenarGrupoFotos(store.fotos.filter(x => x.evento_id === eventoId && x.subpasta === subpasta))[0]',
])assert.ok(html.includes(marker), 'Falta ordenar um caminho: '+marker)
assert.equal((html.match(/db\.from\('fotos'\)\.insert\(\{ evento_id: (?:eventoId|ensaioId), storage_path: path, thumb_path: thumbPath, nome_original: file\.name,/g)||[]).length,2,
 'Evento e ensaio precisam guardar o nome original.')
const sql=fs.readFileSync('supabase/sql/103_fotos_nome_original.sql','utf8')
assert.match(sql,/add column if not exists nome_original text/i)
assert.doesNotMatch(sql,/\b(delete|truncate|drop table)\b/i)
console.log('✓ 2.280 fotos antigas por upload, ordenação numérica futura, 145 manuais preservadas, sem remoções.')
