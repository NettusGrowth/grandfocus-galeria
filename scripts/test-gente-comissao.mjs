import assert from 'node:assert/strict'
import {calculateGenteCommission} from '../contratar/entre-estacoes/admin/gente-commission.js'
const one={source:'formulario',status:'pago_manual',studentsCount:1,value:15000,paidValue:15000}
const group=n=>Array.from({length:n},()=>({...one}))
for(const [n,pct] of [[0,0],[1,0],[9,0],[10,10],[24,10],[25,15],[29,15],[30,20],[35,20],[36,null]]){
 const {children,gross,percent,payout}=calculateGenteCommission(group(n))
 assert.equal(children,n)
 assert.equal(gross,n*15000)
 assert.equal(percent,pct)
 assert.equal(payout,pct===null?null:Math.round(n*15000*pct/100))
}
const excluded=[
 {...one,status:'pendente'},
 {...one,status:'nao_conferido'},
 {...one,status:'parcial',paidValue:7500},
 {...one,status:'pago_manual',paidValue:7500},
 {...one,status:'cancelado'},
 {...one,status:'pago_manual',value:14000},
 {...one,studentsCount:0},
 {...one,studentsCount:5},
 {...one,source:'online'}
]
assert.deepEqual(calculateGenteCommission(excluded),{children:0,gross:0,percent:0,payout:0})
const families=[
 {...one,studentsCount:4,value:60000,paidValue:60000},
 {...one,studentsCount:3,value:45000,paidValue:45000},
 {...one,studentsCount:2,value:30000,paidValue:30000},
 {...one,studentsCount:1,value:15000,paidValue:15000},
]
assert.deepEqual(calculateGenteCommission(families),{children:10,gross:150000,percent:10,payout:15000})
console.log('Gente: limites 0/9/10/24/25/29/30/35/36, famílias e exclusões confirmados.')
