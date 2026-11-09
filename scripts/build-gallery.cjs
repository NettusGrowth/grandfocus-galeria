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


  // A galeria possui um HTML legado muito grande. Adicionamos o favicon
  // durante o build, reutilizando o símbolo oficial já publicado em /assets.
  const faviconTag = '<link rel="icon" type="image/png" href="/assets/logo-icone.png?v=20261109">';
  const appleIconTag = '<link rel="apple-touch-icon" href="/assets/logo-icone.png?v=20261109">';
  if (html.split('</head>').length !== 2) {
    throw new Error('Cannot set Grand Focus favicon: expected one head element.');
  }
  if (!html.includes('href="/assets/logo-icone.png?v=20261109"')) {
    html = html.replace('</head>', '  ' + faviconTag + '\n  ' + appleIconTag + '\n</head>');
  }

  // A área de contratação fica em uma aba própria. Embutir o editor em um
  // iframe cria duas barras de rolagem e deixa o formulário pequeno.
  // O index.html legado é grande: ajustamos somente sua saída de build,
  // com uma âncora explícita que falha caso a estrutura original mude.
  const oldContractFrame = '<iframe title="Gerenciador de contratações e experiências" src="/contratar/admin/" loading="lazy" referrerpolicy="same-origin"></iframe>';
  if (html.split(oldContractFrame).length !== 2) {
    throw new Error('Expected exactly one embedded contracting panel; cannot replace it safely.');
  }
  const contractLauncher = [
    '<section class="gf-contract-launch" aria-labelledby="gf-contract-launch-title">',
    ' <div class="gf-contract-hero">',
    '  <div class="gf-contract-hero-copy">',
    '   <span class="gf-contract-launch-eyebrow"><span class="gf-hero-dot"></span> GRAND FOCUS · ÁREA ADMINISTRATIVA</span>',
    '   <h2 id="gf-contract-launch-title">Suas campanhas, em um só lugar.</h2>',
    '   <p>Organize formulários, acompanhe famílias e visualize os recebimentos com clareza — para todas as escolas e eventos.</p>',
    '   <a class="gf-contract-launch-primary" href="/contratar/admin/" target="_blank" rel="noopener noreferrer">',
    '     <span class="gf-contract-primary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>',
    '     Gerenciar campanhas <span aria-hidden="true">↗</span></a>',
    '  </div>',
    '  <div class="gf-contract-hero-mark" aria-hidden="true"><div class="gf-hero-mark-inner"><img src="/assets/logo-icone.png" alt=""><span>GF</span></div><div class="gf-hero-mark-circle"></div></div>',
    ' </div>',
    ' <div class="gf-contract-module-grid" aria-label="O que você administra">',
    '  <div class="gf-contract-module"><span class="gf-contract-module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><div><strong>Formulários</strong><p>Personalize perguntas e a aparência de cada evento.</p></div></div>',
    '  <div class="gf-contract-module"><span class="gf-contract-module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 11h5m-2.5-2.5v5"/></svg></span><div><strong>Atendimento</strong><p>Identifique novos contatos e acompanhe pendências.</p></div></div>',
    '  <div class="gf-contract-module"><span class="gf-contract-module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M7 15h4"/></svg></span><div><strong>Financeiro</strong><p>Compare valores, taxas estimadas e recebimentos.</p></div></div>',
    ' </div>',
    ' <p class="gf-contract-launch-note"><span class="gf-hero-note-dot"></span> Área restrita à equipe administrativa. Os dados de clientes permanecem protegidos.</p>',
    '</section>'
  ].join('\n');
  html = html.replace(oldContractFrame, contractLauncher);
  const launchCss = [
    '<style id="gf-contratacoes-launch-style">',
    '  #admintab-contratacoes .gf-contract-launch { max-width: 1040px; margin: 0 auto; padding: clamp(26px,5vw,52px); border: 1px solid rgba(200,170,113,.42); border-radius: 20px; background: #F9F4EB; box-shadow: 0 12px 42px rgba(25,3,11,.12); color: #382F35; box-sizing: border-box; }',
    '  #admintab-contratacoes .gf-contract-launch-top { display:flex; gap:12px; justify-content:space-between; align-items:center; }',
    '  #admintab-contratacoes .gf-contract-launch-eyebrow { font-size:12px; font-weight:700; letter-spacing:.12em; color:#77394C; }',
    '  #admintab-contratacoes .gf-contract-launch-symbol { font-size:28px; font-weight:600; color:#5B0D27; }',
    '  #admintab-contratacoes .gf-contract-launch h2 { max-width:850px; margin:20px 0 14px; font-size:clamp(26px,3vw,38px); line-height:1.22; color:#4B0416; font-family:Georgia,serif; }',
    '  #admintab-contratacoes .gf-contract-launch p { max-width:780px; margin:0; font-size:clamp(16px,1.7vw,19px); line-height:1.65; }',
    '  #admintab-contratacoes .gf-contract-launch-actions { display:flex; gap:13px; flex-wrap:wrap; margin:28px 0 21px; }',
    '  #admintab-contratacoes .gf-contract-launch-actions a { display:inline-flex; align-items:center; justify-content:center; gap:12px; min-height:52px; padding:12px 19px; border-radius:10px; box-sizing:border-box; text-align:center; font-size:16px; font-weight:700; line-height:1.35; text-decoration:none; }',
    '  #admintab-contratacoes .gf-contract-launch-primary { background:#4B0416; color:white; border:2px solid #4B0416; }',
    '  #admintab-contratacoes .gf-contract-launch-primary:hover { background:#750B2C; color:white; }',
    '  #admintab-contratacoes .gf-contract-launch-secondary { background:#FFFDF8; color:#4B0416; border:2px solid #C2A36D; }',
    '  #admintab-contratacoes .gf-contract-launch-secondary:hover { background:#F3E6D0; color:#4B0416; }',
    '  #admintab-contratacoes .gf-contract-launch-note { font-size:14px; color:#625560; }',
    '  #admintab-contratacoes .gf-contract-launch-actions a:focus-visible { outline:3px solid #C89E56; outline-offset:3px; }',
    '  @media (max-width:640px) { #admintab-contratacoes .gf-contract-launch { padding:22px 16px; border-radius:12px; } #admintab-contratacoes .gf-contract-launch-actions a { width:100%; } }',
    '  #admintab-contratacoes .gf-contract-launch {max-width:1160px;overflow:hidden;padding:0;background:#FFFCF7;border:1px solid #E4D7C3;border-radius:23px;box-shadow:0 20px 54px rgba(31,7,17,.13);}',
    '  #admintab-contratacoes .gf-contract-hero{min-height:315px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:clamp(26px,5vw,57px);background:radial-gradient(circle at 82% 17%,rgba(213,168,103,.23),transparent 39%),linear-gradient(115deg,#fffaf3 0%,#f5ebdf 100%);}',
    '  #admintab-contratacoes .gf-contract-hero-copy{position:relative;z-index:2;max-width:675px;}',
    '  #admintab-contratacoes .gf-hero-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#AF8541;margin-right:7px;box-shadow:0 0 0 4px rgba(175,133,65,.15);}',
    '  #admintab-contratacoes .gf-contract-launch h2{font-family:Georgia,serif;font-weight:500;max-width:680px;font-size:clamp(31px,3.4vw,50px);letter-spacing:-.035em;line-height:1.12;margin:21px 0 15px;}',
    '  #admintab-contratacoes .gf-contract-hero-copy p{font-size:clamp(16px,1.65vw,19px);max-width:570px;line-height:1.68;color:#53454B;}',
    '  #admintab-contratacoes .gf-contract-launch-primary{margin-top:29px;display:inline-flex;align-items:center;gap:12px;justify-content:center;font-size:16px;padding:15px 24px;min-height:54px;box-shadow:0 9px 20px rgba(75,4,22,.18);background:#4B0416;color:white;border:1px solid #4B0416;border-radius:11px;text-decoration:none;font-weight:750;transition:transform .18s,box-shadow .18s;}',
    '  #admintab-contratacoes .gf-contract-launch-primary:hover{background:#70112D;transform:translateY(-2px);box-shadow:0 13px 25px rgba(75,4,22,.24);}',
    '  #admintab-contratacoes .gf-contract-primary-icon{display:inline-flex;width:22px;height:22px;}',
    '  #admintab-contratacoes .gf-contract-primary-icon svg{width:100%;height:100%;}',
    '  #admintab-contratacoes .gf-contract-hero-mark{width:230px;height:230px;position:relative;display:grid;place-items:center;margin-left:18px;flex:none;}',
    '  #admintab-contratacoes .gf-hero-mark-inner{z-index:2;width:178px;height:178px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#4B0416,#7F2640);border:8px solid #FAF1E0;box-shadow:0 17px 42px rgba(61,4,25,.29);}',
    '  #admintab-contratacoes .gf-hero-mark-inner img{width:105px;height:105px;object-fit:contain;}',
    '  #admintab-contratacoes .gf-hero-mark-inner span{display:none;}',
    '  #admintab-contratacoes .gf-hero-mark-circle{position:absolute;inset:0;border:1px solid #BEA27A;border-radius:50%;box-shadow:0 0 0 16px rgba(190,162,122,.11);}',
    '  #admintab-contratacoes .gf-contract-module-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;padding:24px clamp(20px,4vw,52px);background:white;}',
    '  #admintab-contratacoes .gf-contract-module{display:flex;align-items:flex-start;gap:14px;padding:18px 15px;border:1px solid #ECE1D8;border-radius:13px;background:linear-gradient(155deg,#fff,#fcf9f5);box-shadow:0 3px 14px rgba(60,35,40,.045);}',
    '  #admintab-contratacoes .gf-contract-module-icon{display:inline-grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;background:#F4E9DF;color:#672B40;}',
    '  #admintab-contratacoes .gf-contract-module-icon svg{width:23px;height:23px;}',
    '  #admintab-contratacoes .gf-contract-module strong{display:block;font-size:17px;color:#441625;line-height:1.4;}',
    '  #admintab-contratacoes .gf-contract-module p{font-size:14px;line-height:1.5;color:#73666C;margin-top:5px;}',
    '  #admintab-contratacoes .gf-contract-launch-note{display:flex;align-items:center;gap:9px;font-size:13px;line-height:1.5;color:#605A60;padding:0 clamp(24px,4vw,55px) 24px;}',
    '  #admintab-contratacoes .gf-hero-note-dot{width:7px;height:7px;border-radius:50%;background:#5B9D79;display:inline-block;flex:none;}',
    '  @media(max-width:900px){#admintab-contratacoes .gf-contract-hero-mark{width:145px;height:145px;}#admintab-contratacoes .gf-hero-mark-inner{width:126px;height:126px;border-width:5px;}#admintab-contratacoes .gf-hero-mark-inner img{width:74px;height:74px;}#admintab-contratacoes .gf-contract-module-grid{grid-template-columns:1fr;}}',
    '  @media(max-width:620px){#admintab-contratacoes .gf-contract-hero{padding:30px 21px;min-height:0;}#admintab-contratacoes .gf-contract-hero-mark{display:none;}#admintab-contratacoes .gf-contract-launch-primary{width:100%;box-sizing:border-box;}#admintab-contratacoes .gf-contract-module-grid{padding:15px;}#admintab-contratacoes .gf-contract-launch-note{padding:4px 20px 20px;}}',
    '</style>',
  ].join('\n');
  if (html.split('</head>').length !== 2) {
    throw new Error('Cannot place contracting launcher styles without one closing head tag.');
  }
  html = html.replace('</head>', launchCss + '\n</head>');

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

  // Módulo de contratação independente da galeria principal.
  const contractingPages = path.join(root, 'contratar');
  if (fs.existsSync(contractingPages)) copyTree(contractingPages, path.join(dist, 'contratar'));

  const deployed = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const contractingPublic = path.join(dist, 'contratar', 'entre-estacoes', 'index.html');
  const contractingAdmin = path.join(dist, 'contratar', 'entre-estacoes', 'admin', 'index.html');
  const contractingPublicScript = path.join(dist, 'contratar', 'entre-estacoes', 'app.js');
  const contractingAdminScript = path.join(dist, 'contratar', 'entre-estacoes', 'admin', 'admin.js');
  const contractingManager = path.join(dist, 'contratar', 'admin', 'index.html');
  const contractingManagerScript = path.join(dist, 'contratar', 'admin', 'manager.js');
  if (![contractingPublic, contractingAdmin, contractingPublicScript, contractingAdminScript, contractingManager, contractingManagerScript].every(fs.existsSync)) {
    throw new Error('Public contracting pages, campaign manager, or scripts are missing from dist.');
  }
  if ((deployed.match(/function _urlPreviewValidada/g) || []).length !== 1) throw new Error('Fallback helper missing/duplicated.');
  if (!deployed.includes('_urlPreviewValidada(path, f.storage_path)')) throw new Error('Lightbox fallback missing.');
  if (!deployed.includes('timeoutMs = 8000')) throw new Error('Image timeout fallback missing.');
  if (!deployed.includes('_carregarImgCache(path).then(blobUrl =>')) throw new Error('Non-blocking lightbox cache missing.');
  if (deployed.includes('const auxiliaryReady = await _r2MigrarAuxiliaresPendentes()')) throw new Error('Stale R2 migration autostart must not run on administrator login.');
  if (!deployed.includes('_ativarFallbackImagemVisivel(img, path)')) throw new Error('Visible image error fallback missing.');
  if (!deployed.includes('<link rel="icon" type="image/png" href="/assets/logo-icone.png?v=20261109">')) {
    throw new Error('The built gallery must advertise the official Grand Focus favicon.');
  }
  if (!deployed.includes('id="gf-contract-launch-title"') ||
      !deployed.includes('href="/contratar/admin/" target="_blank"') ||
      deployed.includes('<iframe title="Gerenciador de contratações e experiências"')) {
    throw new Error('The contracting panel must open independently instead of using an embedded iframe.');
  }
  console.log('Gallery build passed: timeout fallback, visible-image fallback, and no migration autostart.');
  console.log('Static output:', dist, 'index bytes:', Buffer.byteLength(deployed));
}

main();
