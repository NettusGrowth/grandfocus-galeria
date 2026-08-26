# Regras de arquitetura e UX — Galeria Grand Focus

Documento de referência do projeto (não é um MCP de memória — é um
arquivo de contexto local, lido por qualquer sessão futura que abra
este repositório). Reflete decisões já implementadas e commitadas em
`index.html`, não aspiração — cada regra abaixo tem código real por
trás, referenciado por commit.

## Regra 1 — Download em massa: nunca `.zip`, sempre nativo/Web Share em micro-lotes

- **Desktop/Android tocável**: link direto `<a download>` sequencial,
  via `createSignedUrl(path, exp, {download: nome})` do Supabase
  Storage (`Content-Disposition: attachment`) — nunca passa bytes
  pelo heap do JS, nunca gera `.zip`.
- **iOS tocável**: Web Share API (`navigator.share`) em micro-lotes de
  **no máximo 4 fotos por vez**, cada lote esperando um toque novo do
  usuário no botão "Salvar" antes de chamar `share()` (Safari exige
  gesto novo por lote pra aceitar de forma confiável — automatizar
  entre lotes é o que falhava). Bytes buscados só do lote atual,
  soltos assim que o lote termina.
- Implementado em `_baixarFotosPrivadoNativo`/`_dlPrepararLoteIOS`/
  `_dlSalvarLoteIOS`/`_dlFinalizarLoteIOS` (index.html).
- **Por quê**: `.zip` client-side em iOS estoura RAM do WebKit com
  fotos de câmera profissional (várias dezenas de MB cada); Web Share
  sem lotes some fotos por engano; `<a download>` disparado em massa
  no iOS empilha avisos de download e manda pro app Arquivos em vez do
  app Fotos.

## Regra 2 — Menu nativo "Toque e Segure" (long-press) liberado na galeria autenticada

- Imagens do grid e do lightbox usam `<img src>` nativo (nunca
  `background-image`).
- `.foto-item img,.lightbox-img-wrap img` têm
  `-webkit-touch-callout:default`, `-webkit-user-select:auto`,
  `user-select:auto`, `pointer-events:auto` — todos `!important`.
- **Causa raiz real** (não é CSS/overlay): o `<img>` precisa terminar
  com uma URL de rede de verdade (`https://…`, via `_urlAssinada`) no
  `src` — WebKit não oferece "Salvar Imagem" em `<img src="blob:…">`.
  O blob local (cache rápido) ainda pinta a tela primeiro, zero-flash;
  a URL assinada real é sempre o passo final. Vale tanto pro lightbox
  (`renderLightboxAtual`) quanto pras miniaturas do grid
  (`_imgTagCache`/`_hidratarPathImg`/`_hidratarImgCache`).
- Comunidade (`.post-imagem`) e Seleção pública paga (`.selpub-card`)
  continuam com o toque-e-segure bloqueado de propósito — são prévias
  antes do cliente pagar.

## Regra 3 — Métricas de foto (visualizações/downloads): acesso estrito a `super_admin`

- Botão "📊 Métricas da Foto" no lightbox da galeria autenticada só
  aparece quando `meuPerfil.role === 'super_admin'` (nunca admin
  comum, nunca outro papel).
- RPC `foto_metricas_resumo` (contagem total + pessoas únicas) tem
  gate estrito a `super_admin` no próprio banco (`raise exception` se
  não for) — defesa em profundidade, não só esconder o botão no
  client.
- `detalhe_popularidade_foto` (lista "Quem Viu"/"Quem Baixou") mantém
  o gate mais antigo (`admin`+`super_admin`) — é o mesmo RPC já usado
  pelo Dashboard de "Fotos mais populares", que continua acessível
  pra admin comum; não regredir esse botão que já existia.

## Regra 4 — Testes autônomos: nunca pedir teste manual em dispositivo físico quando WebKit real puder validar

- Toda mudança relevante a iOS/Safari é validada com **Playwright
  WebKit real** (motor de verdade, não mock) além de testes Node-mock
  — nunca uma resposta termina pedindo "teste no seu iPhone" quando
  dá pra provar via engine automatizado.
- Scripts de teste ficam fora do repo (scratchpad da sessão) — o
  padrão de verificação por commit é: syntax check (`new Function()`
  por bloco `<script>`) + balanceamento de `<div>` + suíte de
  asserções Node/Playwright, sempre rodada antes de cada push.

---

## Acesso ao banco (atualizado — 2026-08-19)

- **A CLI do Supabase (`npx supabase`) está autenticada nesta
  máquina** e enxerga os 2 projetos reais da conta (`NettusGrowth's
  Project` e `GrandFocus`, ref `selnsjtumkxjrtnqofqx`). NÃO estava
  linkada por padrão. `supabase link --project-ref ... --yes` não
  pede senha do Postgres (usa o token de management API, não conexão
  direta) — depois disso `supabase db query --linked -f arquivo.sql`
  roda uma migration direto no banco de produção.
- **Ainda assim, nunca rodar migration via CLI sem pedir autorização
  explícita antes**, uma por uma — usuário foi claro ("cuidado pra
  não estragar nada no meu painel") e só autorizou rodar as 2
  migrations pendentes daquele momento (072+073), não deixou
  autorização permanente pra rodar qualquer coisa futura sozinho.
  Cada novo pedido de migration continua exigindo confirmação, mesmo
  com o projeto já linkado.
- `supabase/.temp/` (criado pelo `link`) fica de fora do commit —
  cache local da CLI, não é do projeto.
- Sem MCP de banco de dados dedicado conectado (não existe um
  servidor MCP Supabase/Postgres neste ambiente) — o acesso real é
  via CLI (`npx supabase db query`), não por um MCP.
- **Playwright WebKit** é instalado sob demanda no scratchpad da
  sessão (`npm install --no-save playwright` + `npx playwright install
  webkit`), não faz parte das dependências do projeto em si
  (`package.json`/`node_modules` na raiz do repo não devem ser
  commitados — são artefato de sessão, não do projeto).

## Regra 5 — Protocolo de Diagnóstico Guiado: nunca "no escuro" quando dá pra pedir dado real

Regra pedida explicitamente pelo Luiz (2026-08-26), depois de um caso
real: bug de "pisco" nas fotos foi investigado só por leitura de
código/mock em 2 rodadas antes dele mandar um **trace de performance
real do DevTools** (`.json`, Performance panel) — que revelou uma
causa nova que a leitura de código sozinha não tinha achado (capa de
evento de 9+ MB sendo servida sem nenhum resize, ver commit da mesma
data). Lição: dado real de runtime encontra coisa que análise estática
não encontra.

- **Antes de tentar resolver no escuro** um bug de renderização,
  visual, performance, toque/gesto no Safari-iOS, ou erro
  intermitente de rede/banco — se a causa não está clara só lendo o
  código, **pedir ao Luiz pra gerar e anexar o diagnóstico certo** em
  vez de ficar tentando hipótese atrás de hipótese sem dado:
  - **Performance/flicker/jank**: DevTools → aba Performance → gravar
    durante o momento do bug → exportar (ícone de download, vira um
    `.json`). Contém eventos reais de Paint/Layout/rede/JS por
    timestamp — dá pra extrair com Node (`JSON.parse` +
    `data.traceEvents`, filtrar por `name`: `PaintImage`,
    `LayoutShift`, `ResourceReceiveResponse`/`ResourceFinish` etc.).
  - **Rede/cache/tamanho de resposta**: DevTools → aba Network →
    marcar "Preserve log" → limpar → reproduzir o bug → botão direito
    na lista → "Save all as HAR with content" (**se exportar sem
    "Preserve log" ligado ou sem nenhuma requisição ter acontecido
    ainda, o `.har` sai vazio — já aconteceu nesta sessão, sempre
    conferir `entries.length` do JSON antes de assumir que tem dado).
  - **Erro de banco/RLS**: pedir a query real rodada + o erro completo
    (código Postgres, ex: `42P17` recursão, `22P02` tipo inválido), ou
    rodar a query direto via `supabase db query --linked` (leitura é
    segura sem pedir permissão, ver seção "Acesso ao banco" acima).
  - **Toque/gesto real em iOS/Safari**: quando Playwright WebKit (ver
    Regra 4) não for suficiente pra reproduzir (ex: toque-e-segure de
    verdade, comportamento só visível no dispositivo físico), pedir
    uma gravação de tela curta do celular real.
- Ensinar o passo a passo de como gerar cada um (não assumir que o
  Luiz já sabe abrir o DevTools na aba certa) — é um pedido explícito
  dele aprender a gerar essas evidências.
- Isso não substitui teste automatizado (mock/Playwright continuam
  sendo o primeiro passo pra QUALQUER fix, ver Regra 4) — é sobre não
  ficar preso em hipótese sem dado quando o próprio usuário consegue
  gerar o dado real em segundos.
