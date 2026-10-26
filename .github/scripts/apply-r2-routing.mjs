import fs from 'node:fs';

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

const oldPredicate = String.raw`function _ehChaveR2Migrada(path) {
  if (typeof path !== 'string') return false
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  return new RegExp('^' + uuid + '/[^/]+$', 'i').test(path) ||
    new RegExp('^selecoes/' + uuid + '/[^/]+$', 'i').test(path)
}`;
const newPredicate = String.raw`function _ehChaveR2Migrada(path) {
  if (typeof path !== 'string') return false
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  return new RegExp('^' + uuid + '/[^/]+$', 'i').test(path) ||
    new RegExp('^selecoes/' + uuid + '/[^/]+$', 'i').test(path) ||
    new RegExp('^(?:config/hero-bg-[0-9]+\\\\.webp|perfis/' + uuid + '/(?:foto\\\\.[a-z0-9]+|capa\\\\.webp|[a-z0-9_-]+\\\\.webp)|escolas/' + uuid + '/(?:capa\\\\.[a-z0-9]+|logo\\\\.webp|comunidade-capa\\\\.webp)|alunos/' + uuid + '/foto\\\\.[a-z0-9]+|eventos-capa/' + uuid + '/capa\\\\.webp|posts/' + uuid + '/midia-[0-9]+\\\\.[a-z0-9]+)$', 'i').test(path)
}`;
const oldUpload = String.raw`async function _uploadStorage(path, body, options = {}) {
  const contentType = options.contentType || body?.type || 'application/octet-stream'
  const { error: r2Error } = await _r2Upload(path, body, contentType)
  if (r2Error) console.warn('Upload auxiliar não espelhado no R2; Supabase segue como origem:', path, r2Error)
  return await db.storage.from(BUCKET).upload(path, body, options)
}`;
const newUpload = String.raw`async function _uploadStorage(path, body, options = {}) {
  const contentType = options.contentType || body?.type || 'application/octet-stream'
  const { error: r2Error } = await _r2Upload(path, body, contentType)
  if (!r2Error) {
    _invalidarUrlCache(path)
    return { data: { path }, error: null }
  }
  console.error('Upload auxiliar ao R2 falhou; usando Supabase como contingência:', path, r2Error)
  return await db.storage.from(BUCKET).upload(path, body, options)
}`;

if (s.includes(oldPredicate) && s.includes(oldUpload)) {
  s = s.replace(oldPredicate, newPredicate).replace(oldUpload, newUpload);
} else if (!(s.includes(newPredicate) && s.includes(newUpload))) {
  throw new Error('Os trechos esperados não coincidem; index.html não foi alterado.');
}
if ((s.match(/db\.storage\.from\(BUCKET\)\.upload\(/g) || []).length !== 1) {
  throw new Error('Verificação de uploads Supabase inesperada; index.html não foi alterado.');
}
fs.writeFileSync(path, s);
fs.rmSync('.github/workflows/apply-r2-routing.yml', { force: true });
fs.rmSync('.github/scripts/apply-r2-routing.mjs', { force: true });
console.log('R2 routing patch applied and temporary patcher removed.');
