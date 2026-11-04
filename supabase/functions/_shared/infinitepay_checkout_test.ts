import { strict as assert } from 'node:assert'
import { isAllowedInfinitePayCheckoutUrl } from './contratacao.ts'

Deno.test('aceita somente o domínio oficial do checkout InfinitePay', () => {
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://checkout.infinitepay.com.br/abc123'), true)
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://checkout.infinitepay.com.br/path?x=1'), true)
})

Deno.test('rejeita domínios parecidos, protocolos inseguros e URLs com credenciais', () => {
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://infinitepay.io/mock-checkout'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://checkout.infinitepay.com.br.attacker.example/pay'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://fake-checkout.infinitepay.com.br/pay'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('http://checkout.infinitepay.com.br/pay'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://user:pass@checkout.infinitepay.com.br/pay'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('https://checkout.infinitepay.com.br:8443/pay'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl(null), false)
  assert.equal(isAllowedInfinitePayCheckoutUrl(''), false)
})
