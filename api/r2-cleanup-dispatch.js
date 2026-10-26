module.exports = function (_req, res) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(404).json({ error: 'Not found' })
}
