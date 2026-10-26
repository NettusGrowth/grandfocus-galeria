module.exports = async function (req, res) {
  const dispatchToken = process.env.R2_CLEANUP_DISPATCH_TOKEN
  const functionToken = process.env.R2_CLEANUP_FUNCTION_TOKEN
  if (
    req.method !== 'GET' ||
    !dispatchToken ||
    !functionToken ||
    typeof req.query?.token !== 'string' ||
    req.query.token !== dispatchToken
  ) {
    return res.status(404).json({ error: 'Not found' })
  }

  const prefix = typeof req.query?.prefix === 'string' ? req.query.prefix : ''
  const known = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!known.test(prefix)) return res.status(400).json({ error: 'Invalid prefix' })

  try {
    const upstream = await fetch(
      'https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/r2-verified-storage-cleanup-temp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-r2-cleanup-token': functionToken,
          'apikey': 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0',
        },
        body: JSON.stringify({ prefix }),
        cache: 'no-store',
      }
    )
    const body = await upstream.text()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json')
    return res.status(upstream.status).send(body)
  } catch (error) {
    return res.status(502).json({ error: 'Upstream request failed' })
  }
}
