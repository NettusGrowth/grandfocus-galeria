export function isAllowedInfinitePayCheckoutUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'checkout.infinitepay.com.br' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      Boolean(parsed.pathname && parsed.pathname !== '/')
  } catch {
    return false
  }
}
