const SUPABASE_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const API_URL = SUPABASE_URL + '/functions/v1/contratacao-publica'

const loading = document.getElementById('loading-state')
const closed = document.getElementById('closed-state')
const form = document.getElementById('contract-form')
const participantsList = document.getElementById('participants-list')
const submitButton = document.getElementById('submit-order')
const formMessage = document.getElementById('form-message')

let campaign = null
let packages = []
let participantSequence = 0

function money(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100)
}

function api(action, values = {}) {
  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLIC_KEY,
    },
    body: JSON.stringify({ action, ...values }),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.')
    return data
  })
}

function formatDate(value) {
  if (!value) return 'Data a confirmar'
  const date = new Date(String(value) + 'T12:00:00')
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
}

function showMessage(message, kind = 'warning') {
  formMessage.textContent = message
  formMessage.classList.remove('hidden')
  formMessage.dataset.kind = kind
}

function hideMessage() {
  formMessage.textContent = ''
  formMessage.classList.add('hidden')
}

function makeField(labelText, input, full = false) {
  const wrap = document.createElement('div')
  wrap.className = 'field' + (full ? ' full' : '')
  const label = document.createElement('label')
  label.textContent = labelText
  label.htmlFor = input.id
  wrap.append(label, input)
  return wrap
}

function makeInput(type, id, placeholder = '') {
  const input = document.createElement('input')
  input.type = type
  input.id = id
  input.placeholder = placeholder
  return input
}

function addCoreographyRow(container) {
  const row = document.createElement('div')
  row.className = 'coreo-row'

  const name = makeInput('text', 'coreo-' + Math.random().toString(36).slice(2), 'Nome da coreografia')
  name.maxLength = 120

  const laterLabel = document.createElement('label')
  laterLabel.className = 'inline-check'
  const later = document.createElement('input')
  later.type = 'checkbox'
  const laterText = document.createElement('span')
  laterText.textContent = 'Confirmar depois'
  laterLabel.append(later, laterText)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'text-button'
  remove.textContent = 'Remover'
  remove.addEventListener('click', () => {
    row.remove()
    updateSummary()
  })

  later.addEventListener('change', () => {
    name.disabled = later.checked
    if (later.checked) name.value = ''
  })
  name.addEventListener('input', updateSummary)

  row.append(name, laterLabel, remove)
  container.append(row)
}

function renderPackageInfo(card) {
  const select = card.querySelector('[data-package]')
  const detail = card.querySelector('[data-package-detail]')
  const coreoArea = card.querySelector('[data-coreo-area]')
  const pkg = packages.find((item) => item.id === select.value)

  detail.replaceChildren()
  coreoArea.classList.toggle('hidden', !pkg?.inclui_palco)

  if (!pkg) {
    detail.classList.add('hidden')
    updateSummary()
    return
  }

  detail.classList.remove('hidden')
  const list = document.createElement('ul')
  for (const line of Array.isArray(pkg.descricao) ? pkg.descricao : []) {
    const li = document.createElement('li')
    li.textContent = String(line)
    list.append(li)
  }
  const price = document.createElement('strong')
  price.textContent = money(pkg.preco_centavos)
  detail.append(list, price)

  if (pkg.inclui_palco && coreoArea.querySelectorAll('.coreo-row').length === 0) {
    addCoreographyRow(coreoArea.querySelector('[data-coreo-list]'))
  }
  updateSummary()
}

function addParticipant() {
  participantSequence += 1
  const card = document.createElement('article')
  card.className = 'participant-card'
  card.dataset.participant = String(participantSequence)

  const head = document.createElement('div')
  head.className = 'participant-head'
  const title = document.createElement('strong')
  title.textContent = 'Bailarina ' + participantSequence
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'text-button'
  remove.textContent = 'Remover bailarina'
  remove.addEventListener('click', () => {
    if (participantsList.children.length <= 1) return
    card.remove()
    renumberParticipants()
    updateSummary()
  })
  head.append(title, remove)

  const grid = document.createElement('div')
  grid.className = 'field-grid'

  const name = makeInput('text', 'dancer-name-' + participantSequence, 'Nome completo da bailarina')
  name.maxLength = 120
  name.required = true
  name.dataset.name = 'true'
  const className = makeInput('text', 'dancer-class-' + participantSequence, 'Turma ou nível')
  className.maxLength = 80
  className.required = true
  className.dataset.class = 'true'
  const age = makeInput('number', 'dancer-age-' + participantSequence, 'Opcional')
  age.min = '1'
  age.max = '99'
  age.dataset.age = 'true'

  const packageSelect = document.createElement('select')
  packageSelect.id = 'dancer-package-' + participantSequence
  packageSelect.required = true
  packageSelect.dataset.package = 'true'
  const empty = document.createElement('option')
  empty.value = ''
  empty.textContent = 'Selecione um pacote'
  packageSelect.append(empty)
  for (const pkg of packages) {
    const option = document.createElement('option')
    option.value = pkg.id
    option.textContent = pkg.nome + ' • ' + money(pkg.preco_centavos)
    packageSelect.append(option)
  }

  grid.append(
    makeField('Nome da bailarina', name, true),
    makeField('Turma ou nível', className),
    makeField('Idade', age),
    makeField('Pacote', packageSelect, true),
  )

  const detail = document.createElement('div')
  detail.className = 'package-detail hidden'
  detail.dataset.packageDetail = 'true'

  const coreoArea = document.createElement('div')
  coreoArea.className = 'coreo-area hidden'
  coreoArea.dataset.coreoArea = 'true'
  const coreoHead = document.createElement('div')
  coreoHead.className = 'coreo-head'
  const coreoTitle = document.createElement('strong')
  coreoTitle.textContent = 'Coreografias para as fotos de palco'
  const addCoreo = document.createElement('button')
  addCoreo.type = 'button'
  addCoreo.className = 'text-button'
  addCoreo.textContent = 'Adicionar coreografia'
  const coreoList = document.createElement('div')
  coreoList.dataset.coreoList = 'true'
  addCoreo.addEventListener('click', () => addCoreographyRow(coreoList))
  coreoHead.append(coreoTitle, addCoreo)
  coreoArea.append(coreoHead, coreoList)

  packageSelect.addEventListener('change', () => renderPackageInfo(card))
  name.addEventListener('input', updateSummary)
  className.addEventListener('input', updateSummary)

  card.append(head, grid, detail, coreoArea)
  participantsList.append(card)
  renumberParticipants()
  updateSummary()
}

function renumberParticipants() {
  [...participantsList.children].forEach((card, index) => {
    const title = card.querySelector('.participant-head strong')
    const remove = card.querySelector('.participant-head button')
    title.textContent = 'Bailarina ' + (index + 1)
    remove.classList.toggle('hidden', participantsList.children.length <= 1)
  })
}

function collectParticipants() {
  const result = []
  for (const card of [...participantsList.children]) {
    const packageId = card.querySelector('[data-package]').value
    const pkg = packages.find((item) => item.id === packageId)
    const name = card.querySelector('[data-name]').value.trim()
    const turma = card.querySelector('[data-class]').value.trim()
    const ageValue = card.querySelector('[data-age]').value.trim()

    if (!name || !turma || !pkg) throw new Error('Preencha o nome, a turma e o pacote de cada bailarina.')

    const coreografias = []
    if (pkg.inclui_palco) {
      const rows = [...card.querySelectorAll('.coreo-row')]
      if (!rows.length) throw new Error('Adicione ao menos uma coreografia para as fotos de palco.')
      for (const row of rows) {
        const confirmarDepois = row.querySelector('input[type="checkbox"]').checked
        const nome = row.querySelector('input[type="text"]').value.trim()
        if (!confirmarDepois && !nome) throw new Error('Informe a coreografia ou marque que o nome será confirmado depois.')
        coreografias.push({ nome, confirmar_depois: confirmarDepois })
      }
    }

    result.push({
      pacote_id: packageId,
      nome,
      turma,
      idade: ageValue ? Number(ageValue) : null,
      coreografias,
    })
  }
  if (!result.length) throw new Error('Adicione ao menos uma bailarina.')
  return result
}

function updateSummary() {
  const summary = document.getElementById('order-summary')
  summary.replaceChildren()
  let total = 0
  const lines = []

  for (const card of [...participantsList.children]) {
    const pkg = packages.find((item) => item.id === card.querySelector('[data-package]').value)
    if (!pkg) continue
    total += Number(pkg.preco_centavos)
    const name = card.querySelector('[data-name]').value.trim() || 'Bailarina'
    lines.push({ name, pkg })
  }

  for (const line of lines) {
    const item = document.createElement('div')
    item.className = 'total-bar'
    const label = document.createElement('span')
    label.textContent = line.name + ' • ' + line.pkg.nome
    const value = document.createElement('strong')
    value.textContent = money(line.pkg.preco_centavos)
    item.append(label, value)
    summary.append(item)
  }

  document.getElementById('order-total').textContent = money(total)
}

function renderCampaign(data) {
  campaign = data.evento
  packages = Array.isArray(data.pacotes) ? data.pacotes : []

  const meta = document.getElementById('event-meta')
  meta.replaceChildren()
  const chips = [
    campaign.escola_nome,
    formatDate(campaign.data_evento),
    campaign.local,
    'Miniensaio das ' + formatTime(campaign.miniensaio_inicio) + ' às ' + formatTime(campaign.miniensaio_fim),
    campaign.duracao_minutos + ' minutos estimados por bailarina',
    campaign.prazo_entrega_dias + ' dias de prazo de entrega',
  ].filter(Boolean)
  for (const label of chips) {
    const chip = document.createElement('span')
    chip.className = 'meta-chip'
    chip.textContent = label
    meta.append(chip)
  }

  const terms = document.getElementById('terms-content')
  terms.textContent = campaign.termos_conteudo || 'Os termos desta contratação ainda não foram disponibilizados.'
  document.getElementById('terms-version').textContent = 'Versão dos termos ' + campaign.termos_versao
  const privacy = document.getElementById('privacy-link')
  privacy.replaceChildren()
  const privacyLink = document.createElement('a')
  privacyLink.href = campaign.privacidade_url
  privacyLink.target = '_blank'
  privacyLink.rel = 'noopener noreferrer'
  privacyLink.textContent = 'Consultar política de privacidade'
  privacy.append(privacyLink)

  if (campaign.autorizacao_imagem_conteudo) {
    document.getElementById('image-consent-area').classList.remove('hidden')
    document.getElementById('image-consent-content').textContent = campaign.autorizacao_imagem_conteudo
    document.getElementById('image-consent-version').textContent = 'Versão da autorização ' + campaign.autorizacao_imagem_versao
  }

  document.getElementById('supplier-footer').textContent =
    campaign.fornecedor_nome + ' • Documento ' + campaign.fornecedor_documento + ' • ' + campaign.fornecedor_email

  if (campaign.whatsapp_atendimento) {
    const contact = document.createElement('span')
    contact.textContent = ' • Atendimento ' + campaign.whatsapp_atendimento
    document.getElementById('supplier-footer').append(contact)
  }

  loading.classList.add('hidden')
  form.classList.remove('hidden')
  addParticipant()
}

async function loadCampaign() {
  try {
    const data = await api('dados')
    loading.classList.add('hidden')
    if (!data.disponivel) {
      document.getElementById('closed-message').textContent = data.mensagem || 'As contratações ainda não foram liberadas.'
      closed.classList.remove('hidden')
      return
    }
    renderCampaign(data)
  } catch (error) {
    loading.classList.add('hidden')
    closed.classList.remove('hidden')
    document.getElementById('closed-message').textContent = error.message
  }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function collectPayload() {
  const responsavel = {
    nome: document.getElementById('responsavel-nome').value.trim(),
    whatsapp: document.getElementById('responsavel-whatsapp').value.trim(),
    email: document.getElementById('responsavel-email').value.trim(),
  }
  const participantes = collectParticipants()
  const aceite = {
    responsavel_legal: document.getElementById('responsavel-legal').checked,
    aceitou_termos: document.getElementById('terms-accepted').checked,
    uso_imagem: document.getElementById('image-consent').checked,
  }
  if (!responsavel.nome || !responsavel.whatsapp || !responsavel.email) {
    throw new Error('Preencha todos os dados do responsável.')
  }
  if (!aceite.responsavel_legal || !aceite.aceitou_termos) {
    throw new Error('É necessário declarar a responsabilidade e aceitar os termos para continuar.')
  }
  return { responsavel, participantes, aceite }
}

async function submitOrder(event) {
  event.preventDefault()
  hideMessage()

  let payload
  try {
    payload = collectPayload()
  } catch (error) {
    showMessage(error.message, 'error')
    return
  }

  const signature = await digest(JSON.stringify(payload))
  let pending = null
  try { pending = JSON.parse(sessionStorage.getItem('gf_entre_estacoes_pending') || 'null') } catch {}
  if (!pending || pending.signature !== signature) {
    pending = {
      signature,
      access_token: randomHex(32),
      idempotency_key: crypto.randomUUID(),
    }
    sessionStorage.setItem('gf_entre_estacoes_pending', JSON.stringify(pending))
  }

  submitButton.disabled = true
  submitButton.textContent = 'Preparando pagamento…'

  try {
    const data = await api('contratar', {
      ...payload,
      access_token: pending.access_token,
      idempotency_key: pending.idempotency_key,
    })
    if (!data.checkout_url) throw new Error('O checkout não foi retornado. Tente novamente.')
    localStorage.setItem('gf_entre_estacoes_token_' + data.order_nsu, pending.access_token)
    sessionStorage.removeItem('gf_entre_estacoes_pending')
    window.location.assign(data.checkout_url)
  } catch (error) {
    showMessage(error.message + ' Seus dados permanecem nesta página. Se necessário, tente novamente sem alterar as informações.', 'error')
    submitButton.disabled = false
    submitButton.textContent = 'Tentar novamente'
  }
}

async function loadOrderReturn() {
  const params = new URLSearchParams(window.location.search)
  const orderNsu = params.get('order_nsu')
  if (!orderNsu) return false

  const token = localStorage.getItem('gf_entre_estacoes_token_' + orderNsu)
  form.classList.add('hidden')
  closed.classList.add('hidden')
  loading.classList.add('hidden')
  const panel = document.getElementById('return-state')
  panel.classList.remove('hidden')

  if (!token) {
    document.getElementById('return-title').textContent = 'Retorno do pagamento recebido'
    document.getElementById('return-message').textContent =
      'Não encontramos o código privado deste pedido neste navegador. Entre em contato com a Grand Focus e informe o número do pedido ' + orderNsu + '.'
    return true
  }

  const transactionNsu = params.get('transaction_nsu')
  const slug = params.get('slug') || params.get('invoice_slug')
  if (transactionNsu && slug) {
    try {
      await api('verificar_retorno', {
        access_token: token,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        slug,
      })
    } catch {
      // O webhook também confirma o pagamento. A consulta de status continua abaixo.
    }
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const data = await api('status', { access_token: token })
      const pedido = data.pedido
      if (pedido.status === 'pago') {
        document.getElementById('return-title').textContent = 'Pagamento confirmado'
        document.getElementById('return-message').textContent =
          'Seu pedido ' + pedido.numero + ' foi confirmado. A Grand Focus recebeu a confirmação do pagamento. Guarde este número para consultar o atendimento.'
        panel.classList.add('success')
        return true
      }
      if (pedido.status === 'conciliacao_pendente') {
        document.getElementById('return-title').textContent = 'Pagamento em conferência'
        document.getElementById('return-message').textContent =
          'Recebemos uma informação de pagamento que precisa de conferência pela equipe. A reserva foi preservada enquanto verificamos os dados.'
        panel.classList.add('warning')
        return true
      }
      if (pedido.status === 'expirado' || pedido.status === 'cancelado') {
        document.getElementById('return-title').textContent = 'A reserva expirou'
        document.getElementById('return-message').textContent =
          'O prazo desta reserva terminou e ela não está mais ativa. Entre em contato com a Grand Focus antes de realizar uma nova contratação.'
        panel.classList.add('warning')
        return true
      }
      document.getElementById('return-title').textContent = 'Aguardando confirmação'
      document.getElementById('return-message').textContent =
        'A InfinitePay ainda não confirmou o pagamento para o nosso sistema. Estamos consultando novamente. Não faça outro pagamento enquanto esta conferência estiver em andamento.'
      if (pedido.checkout_url) {
        const link = document.createElement('a')
        link.href = pedido.checkout_url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = 'Abrir checkout novamente'
        document.getElementById('return-actions').replaceChildren(link)
      }
    } catch (error) {
      document.getElementById('return-message').textContent = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }

  document.getElementById('return-title').textContent = 'Confirmação ainda em andamento'
  document.getElementById('return-message').textContent =
    'A confirmação pode levar mais alguns instantes. Se o pagamento já foi aprovado, não pague novamente. Entre em contato com a Grand Focus e informe o pedido ' + orderNsu + '.'
  panel.classList.add('warning')
  return true
}

document.getElementById('add-participant').addEventListener('click', addParticipant)
form.addEventListener('submit', submitOrder)

async function start() {
  if (await loadOrderReturn()) return
  await loadCampaign()
}

start();
