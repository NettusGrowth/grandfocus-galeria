import { strict as assert } from 'node:assert'

import {
  normalizeInfinitePayEventType,
  isLikelyPaidInfinitePayWebhook,
  requiresInfinitePayPaymentIdentifiers,
  shouldRetryInfinitePayPaymentCheck,
} from './infinitepay_webhook.ts'

Deno.test('normaliza evento explícito no corpo', () => {
  assert.equal(normalizeInfinitePayEventType({ event: 'REFUNDED' }, new Headers()), 'refunded')
  assert.equal(normalizeInfinitePayEventType({ event_type: 'checkout.payment_failed' }, new Headers()), 'payment_failed')
})

Deno.test('aceita eventos presentes em cabeçalhos sem depender deles', () => {
  const headers = new Headers({ 'x-webhook-event': 'payment.settled' })
  assert.equal(normalizeInfinitePayEventType({}, headers), 'settled')
  assert.equal(normalizeInfinitePayEventType({}, new Headers()), '')
})

Deno.test('reconhece o formato de pagamento aprovado publicado pela InfinitePay', () => {
  const payload = {
    invoice_slug: 'invoice-123',
    transaction_nsu: 'transaction-123',
    amount: 1000,
    paid_amount: 1010,
    capture_method: 'credit_card',
  }
  assert.equal(isLikelyPaidInfinitePayWebhook(payload), true)
  assert.equal(requiresInfinitePayPaymentIdentifiers('', payload), true)
})

Deno.test('não interpreta notificações created sem transação como cobrança aprovada', () => {
  assert.equal(requiresInfinitePayPaymentIdentifiers('created', { order_nsu: 'order-123' }), false)
  assert.equal(requiresInfinitePayPaymentIdentifiers('canceled', { order_nsu: 'order-123' }), false)
})

Deno.test('repete payment_check para paid/settled explícitos e payload pago provável', () => {
  assert.equal(shouldRetryInfinitePayPaymentCheck('paid', {}, 'pagamento_pendente'), true)
  assert.equal(shouldRetryInfinitePayPaymentCheck('settled', {}, 'pagamento_pendente'), true)
  assert.equal(shouldRetryInfinitePayPaymentCheck('', {
    invoice_slug: 'invoice-123',
    transaction_nsu: 'transaction-123',
    amount: 1000,
    paid_amount: 1000,
    capture_method: 'pix',
  }, 'pagamento_pendente'), true)
})

Deno.test('não cria loop de retry para refund/cancel ou notificação desconhecida de pedido já pago', () => {
  const paidPayload = {
    invoice_slug: 'invoice-123',
    transaction_nsu: 'transaction-123',
    amount: 1000,
    paid_amount: 1000,
    capture_method: 'pix',
  }
  assert.equal(shouldRetryInfinitePayPaymentCheck('refunded', paidPayload, 'pago'), false)
  assert.equal(shouldRetryInfinitePayPaymentCheck('canceled', {}, 'pagamento_pendente'), false)
  assert.equal(shouldRetryInfinitePayPaymentCheck('', paidPayload, 'pago'), false)
})
