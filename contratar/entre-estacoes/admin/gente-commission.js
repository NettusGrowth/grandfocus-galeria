// Contrato Gente que Dança 2026: valores somente para simulação de repasse.
// Comissão final depende do recebimento confirmado e, acima de 35, acordo escrito.
export function calculateGenteCommission(records){
 const eligible=(Array.isArray(records)?records:[]).filter(r=>
  r.source==='formulario' && r.status==='pago_manual' &&
  Number.isInteger(r.studentsCount) && r.studentsCount>=1 && r.studentsCount<=4 &&
  r.value===r.studentsCount*15000 && Number(r.paidValue)>=r.value
 )
 const children=eligible.reduce((sum,r)=>sum+r.studentsCount,0)
 const gross=children*15000
 const percent=children<10?0:children<=24?10:children<=29?15:children<=35?20:null
 const payout=percent===null?null:Math.round(gross*percent/100)
 return {children,gross,percent,payout}
}
