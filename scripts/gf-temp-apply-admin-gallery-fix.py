from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
original = html

old_card = """<div class="list-item pasta-item" onclick="_galAlbumId='${ev.id}';_galSubpasta=null;_galFiltroPessoaAlbum=null;renderGaleriaAdmin()">"""
new_card = """<div class="list-item pasta-item" onclick="_galAbrirAlbum('${ev.id}')">"""

if html.count(old_card) != 1:
    raise SystemExit(f"Esperava encontrar exatamente 1 link de álbum antigo; encontrei {html.count(old_card)}.")
html = html.replace(old_card, new_card, 1)

old_folders = """function _galSubpastasDisponiveis(eventoId) {
  return [...new Set(store.fotos.filter(f => f.evento_id === eventoId && f.subpasta).map(f => f.subpasta))].sort()
}"""

new_folders = r'''let _galPastasPorAlbum = new Map()
let _galAlbumAberturaSeq = 0

function _galSubpastasDisponiveis(eventoId) {
  const pelasFotos = store.fotos
    .filter(f => f.evento_id === eventoId && f.subpasta)
    .map(f => f.subpasta)
  // O cache de pastas cadastradas só complementa a galeria administrativa.
  // Outras contas continuam dependendo exclusivamente dos dados sob a própria RLS.
  const cadastradas = _galRole === 'admin' ? (_galPastasPorAlbum.get(eventoId) || []) : []
  return [...new Set([...pelasFotos, ...cadastradas])].sort()
}

async function _galBuscarVinculosFotosAlbum(tabela, ids, campoOrdem) {
  const linhas = []
  // Mantém as consultas pequenas para eventos com centenas ou milhares de fotos.
  for (let i = 0; i < ids.length; i += 80) {
    const loteIds = ids.slice(i, i + 80)
    const lote = await _galBuscarTodasAsLinhas(() => db.from(tabela)
      .select('*')
      .in('foto_id', loteIds)
      .order('foto_id', { ascending: true })
      .order(campoOrdem, { ascending: true }))
    linhas.push(...lote)
  }
  return linhas
}

function _galAbrirAlbum(eventoId) {
  _galAlbumId = eventoId
  _galSubpasta = null
  _galFiltroPessoaAlbum = null
  if (_galRole !== 'admin') {
    renderGaleriaAdmin()
    return
  }
  return _galAbrirAlbumAtualizado(eventoId)
}

async function _galAbrirAlbumAtualizado(eventoId) {
  const seq = ++_galAlbumAberturaSeq
  try {
    const [fotosResult, pastasResult] = await Promise.all([
      _galBuscarTodasAsLinhas(() => db.from('fotos').select('*')
        .eq('evento_id', eventoId).order('id', { ascending: true })),
      db.from('evento_subpastas').select('nome').eq('evento_id', eventoId),
    ])
    if (seq !== _galAlbumAberturaSeq) return

    const fotos = Array.isArray(fotosResult) ? fotosResult : []
    const nomesPastas = (pastasResult?.data || [])
      .map(p => p.nome).filter(nome => typeof nome === 'string' && nome.length > 0)
    const idsAntigos = new Set(store.fotos
      .filter(f => f.evento_id === eventoId).map(f => f.id))
    const idsNovos = new Set(fotos.map(f => f.id))
    const idsAtualizados = new Set([...idsAntigos, ...idsNovos])
    const idsConsulta = [...idsNovos]
    const [fa, fp] = idsConsulta.length
      ? await Promise.all([
          _galBuscarVinculosFotosAlbum('foto_aluno', idsConsulta, 'aluno_id'),
          _galBuscarVinculosFotosAlbum('foto_pessoa', idsConsulta, 'user_id'),
        ])
      : [[], []]
    if (seq !== _galAlbumAberturaSeq) return

    // Substitui só este álbum. RLS continua filtrando cada consulta e nada
    // é inserido/alterado no banco; outros eventos ficam intocados.
    store.fotos = store.fotos.filter(f => f.evento_id !== eventoId).concat(fotos)
    store.fotoAluno = store.fotoAluno.filter(x => !idsAtualizados.has(x.foto_id)).concat(fa)
    store.fotoPessoa = store.fotoPessoa.filter(x => !idsAtualizados.has(x.foto_id)).concat(fp)

    if (pastasResult?.error) {
      console.warn('Galeria: não foi possível carregar metadados das pastas', pastasResult.error)
      _galPastasPorAlbum.delete(eventoId)
    } else {
      _galPastasPorAlbum.set(eventoId, [...new Set(nomesPastas)])
    }
    renderGaleriaAdmin()
  } catch (error) {
    if (seq === _galAlbumAberturaSeq) {
      console.error('Galeria: falha ao atualizar álbum antes de exibir', error)
      toast('Não foi possível carregar todas as fotos deste álbum. Tente novamente.')
    }
  }
}'''

if html.count(old_folders) != 1:
    raise SystemExit(f"Esperava encontrar exatamente 1 função antiga de subpastas; encontrei {html.count(old_folders)}.")
html = html.replace(old_folders, new_folders, 1)

if original == html:
    raise SystemExit("Patch vazio.")
if html.count("function _galAbrirAlbumAtualizado(eventoId)") != 1:
    raise SystemExit("O helper novo não ficou único.")
if html.count("onclick=\"_galAbrirAlbum('${ev.id}')\"") != 1:
    raise SystemExit("O cartão do álbum não foi atualizado exatamente uma vez.")
if not html.rstrip().endswith("</html>"):
    raise SystemExit("HTML parece truncado.")

path.write_text(html, encoding="utf-8")
print(f"Patch aplicado com segurança. HTML: {len(original)} -> {len(html)} caracteres.")