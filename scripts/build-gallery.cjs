const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const sourceIndex = path.join(root, 'index.html');

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function patchIndex(html) {
  const migrationAutostart = [
    "  if (['admin', 'super_admin'].includes(data.role)) setTimeout(() => {",
    '    void (async function () {',
    '      const auxiliaryReady = await _r2MigrarAuxiliaresPendentes()',
    '      if (auxiliaryReady) await _r2FinalizarMigracaoStorage()',
    '    })()',
    '  }, 1200)'
  ].join('\n')
  if (html.split(migrationAutostart).length !== 2) {
    throw new Error('Expected one stale R2 migration autostart block; refusing to deploy it on administrator login.')
  }
  html = html.replace(migrationAutostart, [
    '  // A migração/limpeza do R2 é manutenção pontual, não faz parte do login.',
    '  // Não reexecutar a cópia auxiliar em cada abertura do painel administrativo.'
  ].join('\n'))
  const gridStart = html.indexOf('function _hidratarPathImg(img, path) {');
  const gridCall = html.indexOf('  _urlAssinada(path).then(urlReal => {', gridStart);
  const gridEndStart = html.indexOf('\n  })', gridCall);
  if (gridStart < 0 || gridCall < 0 || gridEndStart < 0) {
    throw new Error('Could not find the expected grid image-loading code; refusing to patch.');
  }
  const gridEnd = gridEndStart + '\n  })'.length;
  const newGridCall = [
    '  _ativarFallbackImagemVisivel(img, path)',
    '  _urlPreviewValidada(path).then(urlReal => {',
    '    if (!urlReal || img._gfFallbackIntentado) return',
    '    realAplicada = true',
    '    if (!img.isConnected || urlReal === img.src) return',
    '    img.src = urlReal',
    '  }).catch(() => {})'
  ].join('\n');
  html = html.slice(0, gridCall) + newGridCall + html.slice(gridEnd);

  const helperMarker = '\nfunction _hidratarImgCache(escopo) {';
  if (html.split(helperMarker).length !== 2) {
    throw new Error('Expected exactly one image-cache hydration insertion point; refusing to patch.');
  }
  const helper = [
    'function _originalPathDaMiniatura(path) {',
    "  if (typeof path !== 'string') return null",
    "  const baseStart = path.lastIndexOf('/') + 1",
    '  const base = path.slice(baseStart)',
    "  const marker = base.toLowerCase().lastIndexOf('_thumb')",
    "  if (marker < 0 || !base.slice(marker + 6).startsWith('.')) return null",
    '  return path.slice(0, baseStart + marker) + path.slice(baseStart + marker + 6)',
    '}',
    '',
    'function _urlAssinadaComLimite(path, timeoutMs = 8000) {',
    '  return new Promise(resolve => {',
    '    let settled = false',
    '    let timer',
    '    const finish = value => {',
    '      if (settled) return',
    '      settled = true',
    '      clearTimeout(timer)',
    '      resolve(value || null)',
    '    }',
    '    timer = setTimeout(() => finish(null), timeoutMs)',
    '    Promise.resolve().then(() => _urlAssinada(path)).then(url => finish(url), () => finish(null))',
    '  })',
    '}',
    '',
    'function _precarregarUrlImagem(url, timeoutMs = 8000) {',
    '  return new Promise(resolve => {',
    '    const pre = new Image()',
    '    let settled = false',
    '    let timer',
    '    const finish = ok => {',
    '      if (settled) return',
    '      settled = true',
    '      clearTimeout(timer)',
    '      pre.onload = null',
    '      pre.onerror = null',
    '      resolve(ok)',
    '    }',
    '    timer = setTimeout(() => finish(false), timeoutMs)',
    '    pre.onerror = () => finish(false)',
    "    if (typeof pre.decode === 'function') {",
    '      pre.src = url',
    '      pre.decode().then(() => finish(true)).catch(() => finish(false))',
    '    } else {',
    '      pre.onload = () => finish(true)',
    '      pre.src = url',
    '    }',
    '  })',
    '}',
    '',
    '// Tenta o original apenas quando a miniatura falha ao carregar/decodificar.',
    'async function _urlPreviewValidada(path, originalPath = null) {',
    '  let url = null',
    '  try { url = await _urlAssinadaComLimite(path) } catch {}',
    '  if (url && await _precarregarUrlImagem(url).catch(() => false)) return url',
    '',
    '  const fallbackPath = originalPath && originalPath !== path',
    '    ? originalPath',
    '    : _originalPathDaMiniatura(path)',
    '  if (!fallbackPath || fallbackPath === path) return null',
    '',
    '  let fallbackUrl = null',
    '  try { fallbackUrl = await _urlAssinadaComLimite(fallbackPath) } catch {}',
    '  if (fallbackUrl && await _precarregarUrlImagem(fallbackUrl).catch(() => false)) return fallbackUrl',
    '  return null',
    '}',
    '',
    'function _ativarFallbackImagemVisivel(img, path, originalPath = null, deveAplicar = () => true) {',
    '  if (!img) return',
    '  if (img._gfFallbackHandler) img.removeEventListener(\'error\', img._gfFallbackHandler)',
    '  img._gfFallbackIntentado = false',
    '  const fallbackPath = originalPath && originalPath !== path',
    '    ? originalPath',
    '    : _originalPathDaMiniatura(path)',
    '  if (!fallbackPath || fallbackPath === path) { img._gfFallbackHandler = null; return }',
    '  let tentado = false',
    '  const handler = () => {',
    '    if (tentado) return',
    '    tentado = true',
    '    img._gfFallbackIntentado = true',
    '    _urlAssinadaComLimite(fallbackPath).then(url => {',
    '      if (!url || !img.isConnected || !deveAplicar()) return',
    '      img.src = url',
    '    }).catch(() => {})',
    '  }',
    '  img._gfFallbackHandler = handler',
    '  img.addEventListener(\'error\', handler, { once: true })',
    '}',
    ''
  ].join('\n');
  html = html.replace(helperMarker, '\n' + helper + helperMarker);

  const lightboxStart = html.indexOf('async function renderLightboxAtual() {');
  const lightboxCall = html.indexOf("  img.src = _imgCache(path) || ''", lightboxStart);
  const lightboxEnd = html.indexOf('\n  const evento = store.eventos.find', lightboxCall);
  if (lightboxStart < 0 || lightboxCall < 0 || lightboxEnd < 0) {
    throw new Error('Could not find the expected lightbox image-loading code; refusing to patch.');
  }
  const newLightboxCall = [
    '  _ativarFallbackImagemVisivel(img, path, f.storage_path, () => _lightboxFotos[_lightboxIdx] === f)',
    "  img.src = _imgCache(path) || ''",
    '  let urlRealAplicada = false',
    '  _carregarImgCache(path).then(blobUrl => {',
    '    if (blobUrl && !urlRealAplicada && !img._gfFallbackIntentado && _lightboxFotos[_lightboxIdx] === f) img.src = blobUrl',
    '  }).catch(() => {})',
    '  const urlReal = await _urlPreviewValidada(path, f.storage_path)',
    '  if (urlReal && !img._gfFallbackIntentado && _lightboxFotos[_lightboxIdx] === f) {',
    '    urlRealAplicada = true',
    '    if (urlReal !== img.src) img.src = urlReal',
    '  }'
  ].join('\n');
  html = html.slice(0, lightboxCall) + newLightboxCall + html.slice(lightboxEnd);
  return html;
}

function main() {
  if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const html = patchIndex(fs.readFileSync(sourceIndex, 'utf8'));
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  const assets = path.join(root, 'assets');
  if (fs.existsSync(assets)) copyTree(assets, path.join(dist, 'assets'));
  const migrationPage = path.join(root, 'r2-migration.html');
  if (fs.existsSync(migrationPage)) fs.copyFileSync(migrationPage, path.join(dist, 'r2-migration.html'));

  const deployed = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  if ((deployed.match(/function _urlPreviewValidada/g) || []).length !== 1) throw new Error('Fallback helper missing/duplicated.');
  if (!deployed.includes('_urlPreviewValidada(path, f.storage_path)')) throw new Error('Lightbox fallback missing.');
  if (!deployed.includes('timeoutMs = 8000')) throw new Error('Image timeout fallback missing.');
  if (!deployed.includes('_carregarImgCache(path).then(blobUrl =>')) throw new Error('Non-blocking lightbox cache missing.');
  if (deployed.includes('const auxiliaryReady = await _r2MigrarAuxiliaresPendentes()')) throw new Error('Stale R2 migration autostart must not run on administrator login.');
  if (!deployed.includes('_ativarFallbackImagemVisivel(img, path)')) throw new Error('Visible image error fallback missing.');
  console.log('Gallery build passed: timeout fallback, visible-image fallback, and no migration autostart.');
  console.log('Static output:', dist, 'index bytes:', Buffer.byteLength(deployed));
}

main();
