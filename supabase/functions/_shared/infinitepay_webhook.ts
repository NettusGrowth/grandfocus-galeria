const INFINITEPAY_EVENTS = new Set([
  'created',
  'paid',
  'settled',
  'refunded',
  'canceled',
  'payment_failed',
])

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function normalizedCandidate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const candidate = value.trim().toLowerCase().split(/[.:/]/).filter(Boolean).at(-1) || ''
  return INFINITEPAY_EVENTS.has(candidate) ? candidate : ''
}

/**
 * InfinitePay documents event subscriptions but the published paid webhook
 * example does not include an explicit event property. Accept known event
 * names from documented/observed body fields or optional provider headers.
 */
export function normalizeInfinitePayEventType(body: unknown, headers: Headers): string {
  const value = asRecord(body)
  const candidates = [
    value.event,
    value.event_type,
    value.type,
    headers.get('x-infinitepay-event'),
    headers.get('x-webhook-event'),
    headers.get('x-event-type'),
    value.payment_status,
    value.status,
  ]
  for (const candidate of candidates) {
    const normalized = normalizedCandidate(candidate)
    if (normalized) return normalized
  }
  return ''
}

/**
 * The official paid-event example includes invoice_slug, transaction_nsu,
 * amount, paid_amount and capture_method. This signature is only a retry
 * heuristic; payment_check remains the only source allowed to confirm money.
 */
export function isLikelyPaidInfinitePayWebhook(body: unknown): boolean {
  const value = asRecord(body)
  const amount = Number(value.amount)
  const paidAmount = Number(value.paid_amount)
  const method = String(value.capture_method || '')
  return Boolean(
    String(value.transaction_nsu || '').trim() &&
    String(value.invoice_slug || value.slug || '').trim() &&
    Number.isInteger(amount) && amount > 0 &&
    Number.isInteger(paidAmount) && paidAmount >= amount &&
    (method === 'pix' || method === 'credit_card')
  )
}

/**
 * A create/cancel/failure notification may not carry transaction data. Paid,
 * settled and refunded notifications, or the official paid payload shape,
 * must carry identifiers so they can be checked server-to-server.
 */
export function requiresInfinitePayPaymentIdentifiers(eventType: string, body: unknown): boolean {
  return ['paid', 'settled', 'refunded'].includes(eventType) ||
    isLikelyPaidInfinitePayWebhook(body)
}

/**
 * Retry temporary misses for explicit paid/settled events. If the event name
 * is absent, retry only when the payload matches the official paid shape and
 * the order has not already been paid. Unknown/refund-like notices for an
 * already-paid order are stored for manual review instead of retry-storming.
 */
export function shouldRetryInfinitePayPaymentCheck(
  eventType: string,
  body: unknown,
  orderStatus: string,
): boolean {
  if (eventType === 'paid' || eventType === 'settled') return true
  if (eventType) return false
  const alreadyPaid = orderStatus === 'pago' ||
    orderStatus === 'conciliacao_pendente' ||
    orderStatus === 'reembolsado'
  return !alreadyPaid && isLikelyPaidInfinitePayWebhook(body)
}
