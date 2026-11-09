import assert from 'node:assert/strict'
import { processingFeeCents, projectedNetCents } from '../contratar/entre-estacoes/admin/fees.js'
// 10 pedidos de R$ 100,00 em crédito com taxa referência 4,20%.
assert.equal(processingFeeCents(10000,420),420)
assert.equal(projectedNetCents(10000,420),9580)
assert.equal(Array.from({length:10},()=>projectedNetCents(10000,420)).reduce((a,b)=>a+b,0),95800)
// R$ 145,00 -> desconto 4,20% de R$ 6,09 e líquido R$ 138,91.
assert.equal(processingFeeCents(14500,420),609)
assert.equal(projectedNetCents(14500,420),13891)
// Taxa diferente ajustada na campanha: maquininha plano inicial 3,15%.
assert.equal(processingFeeCents(10000,315),315)
assert.equal(projectedNetCents(10000,315),9685)
// Pix não tem desconto; o chamador usa taxa zero.
assert.equal(projectedNetCents(14500,0),14500)
// Arredondamento por transação, nunca aplicar sobre total agregado.
assert.equal(processingFeeCents(101,420),4)
assert.equal(processingFeeCents(102,420),4)
assert.throws(()=>processingFeeCents(-1,420),RangeError)
assert.throws(()=>processingFeeCents(100,2001),RangeError)
assert.throws(()=>processingFeeCents(100,4.2),RangeError)
console.log('Projeções líquidas por transação: aprovadas.')
