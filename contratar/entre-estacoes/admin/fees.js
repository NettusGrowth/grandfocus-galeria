// Estimativa para relatórios administrativos.
// BPS = centésimos de percentual. Cada transação arredonda seu custo em centavos.
// Não substitui o extrato da InfinitePay nem calcula juros repassados ao cliente.
export function processingFeeCents(grossCents,bps) {
  if(!Number.isSafeInteger(grossCents)||grossCents<0||
     !Number.isSafeInteger(bps)||bps<0||bps>2000)
    throw new RangeError('Valor ou taxa inválidos para a projeção financeira.')
  return Math.round(grossCents*bps/10000)
}
export function projectedNetCents(grossCents,bps) {
  return grossCents-processingFeeCents(grossCents,bps)
}
