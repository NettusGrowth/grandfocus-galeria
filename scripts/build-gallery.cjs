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
  // A hidratação da grade agora é uma única requisição à URL assinada,
  // com fallback somente se a miniatura falhar. Não reintroduzir o
  // pré-carregamento/decode de cada thumbnail durante o build: isso
  // duplicava o tráfego e deixava galerias grandes sem resposta.
  if (!html.includes('function _hidratarPathImg(img, path) {') ||
      !html.includes('_urlAssinadaComLimite ===')) {
    throw new Error('A versão otimizada de hidratação de imagens está ausente.');
  }

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


function patchStableGalleryScroll(html) {
  const replaceOnce = (old, next, label) => {
    if (html.split(old).length !== 2) throw new Error('Stable gallery: unexpected anchor ' + label);
    html = html.replace(old, () => next);
  };
  const cssStart = html.indexOf('.foto-grid.gal-boutique{display:block;column-count:2;column-gap:8px;}');
  const oldCssEnd = '.foto-item.gal-boutique img:not(.gf-carregada){min-height:200px;}';
  const cssEnd = html.indexOf(oldCssEnd, cssStart);
  if (cssStart < 0 || cssEnd < 0) throw new Error('Stable gallery: boutique CSS not found');
  html = html.slice(0,cssStart) + [
    '.foto-grid.gal-boutique{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start;}',
    '@media(min-width:600px){.foto-grid.gal-boutique{gap:14px;}}',
    '@media(min-width:900px){.foto-grid.gal-boutique{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;}}',
    '.foto-grid.gal-boutique>.gf-gal-col{display:flex;flex-direction:column;gap:inherit;min-width:0;align-self:start;}',
    '.foto-item.gal-boutique{aspect-ratio:1;margin:0;min-width:0;width:100%;flex:none;border-radius:8px;contain:layout paint;content-visibility:visible;}',
    '.foto-item.gal-boutique img{height:100%;width:100%;object-fit:contain;display:block;}'
  ].join('\n') + html.slice(cssEnd + oldCssEnd.length);
  replaceOnce(
    '  const aspecto = boutique && f.largura && f.altura ? ` style="aspect-ratio:${f.largura}/${f.altura};"` : \'\'',
    '  const largura = Number(f.largura), altura = Number(f.altura)\n  const aspecto = boutique && Number.isFinite(largura) && Number.isFinite(altura) && largura > 0 && altura > 0 ? ` style="aspect-ratio:${largura}/${altura};"` : \'\'',
    'reserve valid card dimensions'
  );
  replaceOnce(
    'id="gal-fg-${f.id}" onclick="abrirLightbox(\'${f.id}\')">',
    'id="gal-fg-${f.id}"${aspecto} onclick="abrirLightbox(\'${f.id}\')">',
    'apply aspect to fixed card'
  );
  replaceOnce(
    'loading="lazy" alt=""${aspecto} onload="this.classList.add(\'gf-carregada\')"',
    'loading="lazy" alt="" onload="this.classList.add(\'gf-carregada\')"',
    'image cannot resize card'
  );
  const start = html.indexOf('function _renderGridFotosPaginado(gridEl, fotos, itemHtmlFn = _galFotoItemHTML) {');
  const end = html.indexOf("\n// prévia (com marca d'água)",start);
  if (start < 0 || end < 0) throw new Error('Stable gallery: pagination function not found');
  html = html.slice(0,start) + [
    'function _gfFotosUnicas(fotos) {',
    '  const ids = new Set()',
    '  return fotos.filter(f => { if (ids.has(f.id)) return false; ids.add(f.id); return true })',
    '}',
    'function _renderGridFotosPaginado(gridEl, fotos, itemHtmlFn = _galFotoItemHTML) {',
    '  if (!gridEl) return',
    '  _galFotoGridsAtivos.get(gridEl)?.cancel()',
    "  const galeria = gridEl.id === 'gal-fotos-grid'",
    '  if (galeria) { fotos = _gfFotosUnicas(fotos); _lightboxFotos = fotos }',
    '  let ativo = true, renderizados = 0, sentinel = null, observer = null, esperandoFrame = false',
    "  const temObserver = 'IntersectionObserver' in window",
    "  gridEl.setAttribute('data-gf-grid-paginada', '')",
    "  const boutique = galeria && gridEl.classList.contains('gal-boutique')",
    "  const media = boutique ? window.matchMedia('(min-width:900px)') : null",
    '  let colunas = [], alturas = []',
    '  function criarColunas() {',
    '    const quantidade = media.matches ? 3 : 2',
    '    alturas = Array(quantidade).fill(0)',
    '    colunas = Array.from({ length: quantidade }, () => {',
    "      const col = document.createElement('div')",
    "      col.className = 'gf-gal-col'",
    '      gridEl.insertBefore(col, sentinel)',
    '      return col',
    '    })',
    '  }',
    '  function colunaDaFoto(f) {',
    '    let i = 0',
    '    for (let j = 1; j < alturas.length; j++) if (alturas[j] < alturas[i]) i = j',
    '    const w = Number(f.largura), h = Number(f.altura)',
    '    alturas[i] += (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? h / w : 1) + 0.04',
    '    return i',
    '  }',
    '  function reorganizarAoMudarColunas() {',
    '    if (!ativo || !gridEl.isConnected || colunas.length === (media.matches ? 3 : 2)) return',
    '    const anteriores = colunas',
    "    const cards = new Map(anteriores.flatMap(c => Array.from(c.children)).map(c => [c.id, c]))",
    '    criarColunas()',
    '    for (const f of fotos.slice(0, renderizados)) {',
    "      const card = cards.get('gal-fg-' + f.id)",
    '      const col = colunas[colunaDaFoto(f)]',
    '      if (card) col.appendChild(card)',
    '    }',
    '    anteriores.forEach(c => c.remove())',
    '  }',
    '  if (boutique) {',
    '    criarColunas()',
    "    if (media.addEventListener) media.addEventListener('change', reorganizarAoMudarColunas)",
    '    else media.addListener?.(reorganizarAoMudarColunas)',
    '  }',
    '  function observarFinal() {',
    '    if (!ativo || renderizados >= fotos.length || !temObserver) return',
    '    if (!sentinel) {',
    "      sentinel = document.createElement('div')",
    "      sentinel.setAttribute('aria-hidden', 'true')",
    "      sentinel.style.cssText = 'grid-column:1/-1;height:1px;min-height:1px;'",
    '      gridEl.appendChild(sentinel)',
    '    }',
    '    if (!observer) observer = new IntersectionObserver(entries => {',
    '      if (entries.some(entry => entry.isIntersecting)) carregarLote()',
    "    }, { rootMargin: '550px 0px' })",
    '    observer.unobserve(sentinel); observer.observe(sentinel)',
    '  }',
    '  function carregarLote() {',
    '    if (!ativo || esperandoFrame || renderizados >= fotos.length) return',
    '    esperandoFrame = true',
    '    requestAnimationFrame(() => {',
    '      esperandoFrame = false',
    '      if (!ativo || !gridEl.isConnected) { observer?.disconnect(); return }',
    '      const lote = fotos.slice(renderizados, renderizados + GAL_LOTE_FOTOS)',
    '      renderizados += lote.length',
    '      if (boutique) {',
    '        const blocos = colunas.map(() => [])',
    '        for (const f of lote) blocos[colunaDaFoto(f)].push(itemHtmlFn(f))',
    "        blocos.forEach((bloco, i) => { if (bloco.length) colunas[i].insertAdjacentHTML('beforeend', bloco.join('')) })",
    '      } else {',
    "        const html = lote.map(itemHtmlFn).join('')",
    "        if (sentinel?.isConnected) sentinel.insertAdjacentHTML('beforebegin', html)",
    "        else gridEl.insertAdjacentHTML('beforeend', html)",
    '      }',
    '      _hidratarImgCache(gridEl)',
    '      if (renderizados >= fotos.length) {',
    '        observer?.disconnect(); observer = null; sentinel?.remove(); sentinel = null',
    '      } else if (temObserver) observarFinal()',
    '      else requestAnimationFrame(carregarLote)',
    '    })',
    '  }',
    '  _galFotoGridsAtivos.set(gridEl, {',
    '    cancel() {',
    '      ativo = false; observer?.disconnect()',
    "      if (media?.removeEventListener) media.removeEventListener('change', reorganizarAoMudarColunas)",
    '      else media?.removeListener?.(reorganizarAoMudarColunas)',
    '    },',
    '    sync(novas) {',
    '      if (!galeria || !ativo || !gridEl.isConnected || _lightboxFotos !== fotos) return false',
    '      const lista = _gfFotosUnicas(novas), porId = new Map(lista.map(f => [f.id, f]))',
    '      const antigos = new Set(fotos.map(f => f.id))',
    "      const campos = ['storage_path','thumb_path','largura','altura','ordem','subpasta','evento_id']",
    '      if (fotos.some(f => !porId.has(f.id) || campos.some(k => f[k] !== porId.get(f.id)[k]))) return false',
    '      const adicionais = lista.filter(f => !antigos.has(f.id))',
    '      if (!adicionais.length) return true',
    '      const estavaCompleta = renderizados >= fotos.length',
    '      for (const f of adicionais) fotos.push(f)',
    "      const meta = gridEl.previousElementSibling?.querySelector('.meta')",
    "      if (meta) meta.textContent = fotos.length + ' foto(s)'",
    '      if (estavaCompleta) { if (temObserver) observarFinal(); else carregarLote() }',
    '      return true',
    '    }',
    '  })',
    '  carregarLote()',
    '}',
    ''
  ].join('\n') + html.slice(end);
  const helper = [
    'function _gfAtualizarGaleriaSemPulo() {',
    '  const wrap = document.getElementById(_galWrapId())',
    "  const grid = wrap?.querySelector('#gal-fotos-grid')",
    '  if (!grid || !grid.offsetParent) { renderGaleriaAdmin(); return }',
    '  let fotos',
    "  if (_galRole === 'responsavel' && _galVendoFotosPessoais) fotos = _fotosPessoaisResp()",
    '  else {',
    '    const evento = _galAvulsoId || _galAlbumId',
    '    if (!evento) { renderGaleriaAdmin(); return }',
    '    const base = _galAlunoId ? _fotosDoAluno(_galAlunoId) : store.fotos',
    "    fotos = base.filter(f => f.evento_id === evento && (_galSubpasta === '__soltas__' ? !f.subpasta : _galSubpasta ? f.subpasta === _galSubpasta : true))",
    '    if (_galFiltroPessoaAlbum && !_galAvulsoId) {',
    "      const filtro = _galFiltroPessoaAlbum, porAluno = !_galAlunoId && filtro.tipo === 'aluno'",
    '      const ids = new Set((porAluno ? store.fotoAluno : store.fotoPessoa).filter(v => porAluno ? v.aluno_id === filtro.id : v.user_id === filtro.id).map(v => v.foto_id))',
    '      fotos = fotos.filter(f => ids.has(f.id))',
    '    }',
    '  }',
    '  if (!_galFotoGridsAtivos.get(grid)?.sync(fotos)) renderGaleriaAdmin()',
    '}',
    ''
  ].join('\n');
  replaceOnce('async function _galAtualizarDados() {', helper+'\nasync function _galAtualizarDados() {','refresh helper');
  replaceOnce('  if (mudou) renderGaleriaAdmin()\n}', '  if (mudou) _gfAtualizarGaleriaSemPulo()\n}', 'realtime album');
  replaceOnce('  store.fotoPessoa = fp || []\n  renderGaleriaAdmin()\n}', '  store.fotoPessoa = fp || []\n  _gfAtualizarGaleriaSemPulo()\n}', 'initial admin loading');
  replaceOnce("if (meuPerfil?.role === 'responsavel' && _visivel('resptab-fotos')) await iniciarViewResponsavel()", "if (meuPerfil?.role === 'responsavel' && _visivel('resptab-fotos')) await iniciarViewResponsavel(true)", 'parent realtime only');
  replaceOnce('async function iniciarViewResponsavel() {\n  const minhaSeq = ++_galCargaSeq\n  _fotoSelecao.clear(); _fotoFiltroAluno = null; _respFiltroFilho = null', 'async function iniciarViewResponsavel(preservarNavegacao = false) {\n  const minhaSeq = ++_galCargaSeq\n  if (!preservarNavegacao) { _fotoSelecao.clear(); _fotoFiltroAluno = null; _respFiltroFilho = null }', 'parent refresh navigation');
  replaceOnce("  _galRole = 'responsavel'\n  // conta com só 1 aluno", [
    "  if (preservarNavegacao && _galRole === 'responsavel') {",
    "    if (!_visivel('galeria-resp-wrap')) return",
    '    if (!_galAlunoId || meusFilhos.some(a => a.id === _galAlunoId)) { _gfAtualizarGaleriaSemPulo(); return }',
    '  }',
    "  _galRole = 'responsavel'",
    '  // conta com só 1 aluno'
  ].join('\n'), 'parent open album');
  const oldNames = [
    '    const albumIdNoMomento = _galAlbumId',
    '    _garantirNomesPessoas(idsPendentes).then(achouAlgo => {',
    '      if (achouAlgo && _galAlbumId === albumIdNoMomento) renderGaleriaAdmin()',
    '    })'
  ].join('\n');
  const newNames = [
    "    const gradeAtual = wrap.querySelector('#gal-fotos-grid')",
    '    _garantirNomesPessoas(idsPendentes).then(achouAlgo => {',
    '      if (!achouAlgo || !gradeAtual?.isConnected) return',
    "      const chips = wrap.querySelectorAll('.gal-chip-row .chip')",
    '      pessoasNoAlbum.forEach((p, i) => {',
    "        if (p.tipo === 'pessoa' && p.nome === '?' && chips[i+1]) chips[i+1].textContent = _nomePessoaMarcada(p.id)",
    '      })',
    '    })'
  ].join('\n');
  if (html.split(oldNames).length !== 3) throw new Error('Stable gallery: expected two async name callbacks');
  html = html.split(oldNames).join(newNames);
  return html;
}

function main() {
  if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const { patchSelectionAdminDownload } = require('./patch-selection-admin-download.cjs');
  const html = patchSelectionAdminDownload(patchStableGalleryScroll(patchIndex(fs.readFileSync(sourceIndex, 'utf8'))));
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  const assets = path.join(root, 'assets');
  if (fs.existsSync(assets)) copyTree(assets, path.join(dist, 'assets'));
  const migrationPage = path.join(root, 'r2-migration.html');
  if (fs.existsSync(migrationPage)) fs.copyFileSync(migrationPage, path.join(dist, 'r2-migration.html'));

  // Importação administrativa independente: a página precisa existir no dist.
  const accessImporter = path.join(root, 'admin-importar-acessos.html');
  if (!fs.existsSync(accessImporter)) throw new Error('Secure access importer page missing.');
  fs.copyFileSync(accessImporter, path.join(dist, 'admin-importar-acessos.html'));

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
  const accessImporterBuilt = fs.readFileSync(path.join(dist, 'admin-importar-acessos.html'), 'utf8');
  if (!accessImporterBuilt.includes('CADASTROS_NOVOS') || !accessImporterBuilt.includes("['admin','super_admin']")) throw new Error('Access importer lost admin guard or Excel parser.');
  if (!deployed.includes('/admin-importar-acessos.html')) throw new Error('Admin import launcher is missing.');
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
