'use strict'

// Patch incremental de build: mantém index.html e a implementação
// individual existentes sem regravar 1,3 MB de HTML.
function patchSelectionBulkDownload(html) {
  if (typeof html !== 'string') throw new Error('Expected gallery HTML')
  if (html.includes('function _selecaoBaixarTodasOriginais(')) {
    throw new Error('Bulk selection download duplicated')
  }
  const toolbarMarker = "          ${!_selOrdemModoAtivo && g.fotos.length ? `<button class=\"btn btn-sm\" onclick=\"_selecaoReprocessarMarcaDagua()\"";
  const toolbarButton = "          ${meuPerfil?.role === 'super_admin' && !_selOrdemModoAtivo && !_selLoteModoAtivo && g.fotos.some(f => f.storage_path_alta) ? `<button class=\"btn btn-sm\" type=\"button\" onclick=\"event.stopPropagation();_selecaoBaixarTodasOriginais()\" title=\"Baixar todas as fotos originais desta galeria de seleção, sem marca d’água\">⬇ Baixar todas (${g.fotos.filter(f => f.storage_path_alta).length})</button>` : ''}\n";
  if (html.split(toolbarMarker).length !== 2) throw new Error('Selection toolbar anchor missing or duplicated')
  html = html.replace(toolbarMarker, toolbarButton + toolbarMarker)

  const functionMarker = 'function _renderSelecaoFotosGrid() {'
  if (html.split(functionMarker).length !== 2) throw new Error('Selection grid function anchor missing or duplicated')
  html = html.replace(functionMarker, "\n// Download em lote da pasta de seleção: reutiliza o fluxo já testado da\n// Galeria (desktop e iPhone) sem mexer no pedido nem nas métricas do cliente.\nlet _selecaoBaixandoTodosOriginais = false\nasync function _selecaoBaixarTodasOriginais() {\n  if (meuPerfil?.role !== 'super_admin') {\n    toast('Download de originais disponível apenas para Super Admin.')\n    return\n  }\n  const g = _selecaoDetalheAtual\n  if (!g?.fotos?.length) { toast('Esta seleção ainda não tem fotos.'); return }\n  if (_selecaoBaixandoTodosOriginais || _baixandoPrivado) {\n    toast('Já existe um download em andamento.')\n    return\n  }\n  if (_selLoteModoAtivo || _selOrdemModoAtivo || _galUploadAtivo()) {\n    toast('Finalize o envio ou a organização das fotos antes de baixar todas.')\n    return\n  }\n  const paths = g.fotos.map(f => f.storage_path_alta)\n    .filter(p => typeof p === 'string' && p.trim())\n  if (!paths.length) { toast('Não há fotos originais disponíveis para download.'); return }\n  const semOriginal = g.fotos.length - paths.length\n  _selecaoBaixandoTodosOriginais = true\n  try {\n    if (semOriginal) toast(semOriginal + ' foto(s) sem arquivo original serão ignoradas.')\n    // O helper já trata URLs assinadas, progresso e lotes do iPhone.\n    // nomeBase null evita registrar seleção como download de fotos comuns.\n    await _baixarFotosPrivadoNativo(paths, null)\n    void registrarAuditoria('solicitou download de originais da seleção', 'selecao_galerias', g.id,\n      paths.length + ' fotos em lote')\n  } catch (error) {\n    console.error('Falha no download de todos os originais da seleção', error)\n    toast('Não foi possível concluir o download. Tente novamente.')\n  } finally {\n    _selecaoBaixandoTodosOriginais = false\n  }\n}\n" + '\n' + functionMarker)
  return html
}
module.exports = { patchSelectionBulkDownload }
