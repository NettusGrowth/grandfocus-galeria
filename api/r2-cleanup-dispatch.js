module.exports = async function (req, res) {
  const dispatchToken = process.env.R2_CLEANUP_DISPATCH_TOKEN
  const functionToken = process.env.R2_CLEANUP_FUNCTION_TOKEN
  if (req.method !== 'GET' || !dispatchToken || !functionToken ||
      typeof req.query?.token !== 'string' || req.query.token !== dispatchToken) {
    return res.status(404).json({ error: 'Not found' })
  }

  const inventory = {
    '07769261-1011-4368-b5a3-be0486437ae2': [50, 80043103],
    '0c70c38b-d35f-4e53-a43c-949626b5f973': [11, 1408563],
    '2d2d31df-3899-40b1-adf9-a03e4424f5dc': [2, 138551],
    '32fbaff0-d6b2-4e92-9267-95ff03c60ad1': [58, 309745269],
    '37b7f62d-7564-41c3-92d7-d0d85931706f': [134, 936016835],
    '597e1703-98bf-446b-95f3-b31c414785a6': [1160, 9299854805],
    '608eec83-ed16-4b4b-93cb-606054a439b8': [56, 82493374],
    '8d79957d-d8e3-4619-9989-f1d3ed22b408': [374, 2238595000],
    'a888216f-da0d-4ef1-8e25-6c23f609ee7a': [29, 4410513],
    'aebe0732-c2b0-4ff9-85b7-29f7159ecc24': [4, 604947],
    'ab1001ab-04cd-4be3-92a3-e4845c995890': [94, 662869195],
    'bbb1fdb5-ec19-4f0e-9834-3fa81287d86c': [160, 1054152684],
    'bd00518a-4f56-45ac-bc8b-6155b0ab72b2': [29, 4695164],
    'bee7238a-454d-45ed-8827-4e65364cd857': [7, 1068187],
    'c1791dd5-4253-412f-acfa-d5b6b043b42c': [22, 116199584],
    'e9a8a736-113f-4227-9a8c-fc854434cb6d': [12, 20409660],
    'eb934ff8-c704-49e1-97f5-646c238df23a': [30, 4838451],
    'f7440349-8fe9-418e-9cff-59b11e87757d': [7, 696100]
  }
  const prefix = typeof req.query?.prefix === 'string' ? req.query.prefix : ''
  const action = req.query?.action === 'cleanup' ? 'cleanup' : 'audit'
  const expected = inventory[prefix]
  if (!expected) return res.status(400).json({ error: 'Prefix is not in the verified photo inventory' })
  if (action === 'cleanup' && req.query?.confirm !== 'DELETE_VERIFIED_DUPLICATES') {
    return res.status(400).json({ error: 'Explicit cleanup confirmation missing' })
  }

  try {
    const upstream = await fetch('https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/r2-verified-storage-cleanup-temp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-r2-cleanup-token': functionToken,
        'apikey': 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
      },
      body: JSON.stringify({
        prefix, action, expectedCount: expected[0], expectedBytes: expected[1],
        ...(action === 'cleanup' ? { confirm: 'DELETE_VERIFIED_DUPLICATES' } : {})
      }),
      cache: 'no-store'
    })
    const body = await upstream.text()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json')
    return res.status(upstream.status).send(body)
  } catch (error) {
    return res.status(502).json({ error: 'Upstream request failed' })
  }
}
