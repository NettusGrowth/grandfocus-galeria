const SUPABASE_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const API_URL = SUPABASE_URL + '/functions/v1/contratacao-publica'
const CAMPAIGN_SLUG = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || 'entre-estacoes').toLowerCase()
const CAMPAIGN_STORAGE_PREFIX = 'gf_contratacao_' + CAMPAIGN_SLUG
const ADMIN_PREVIEW = new URLSearchParams(window.location.search).get('preview') === '1'

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
    body: JSON.stringify({ action, campaign_slug: CAMPAIGN_SLUG, ...values }),
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

function renderPackageOverview() {
  const container = document.getElementById('package-overview-list')
  if (!container) return
  container.replaceChildren()

  for (const pkg of packages) {
    const card = document.createElement('article')
    card.className = 'experience-card'

    const eyebrow = document.createElement('p')
    eyebrow.className = 'eyebrow'
    eyebrow.textContent = pkg.inclui_miniensaio && pkg.inclui_palco
      ? 'MINIENSAIO E PALCO'
      : pkg.inclui_miniensaio
        ? 'RETRATOS NO TEATRO'
        : 'REGISTROS DE PALCO'

    const title = document.createElement('h3')
    title.textContent = pkg.nome

    const summary = document.createElement('p')
    summary.className = 'experience-summary'
    if (pkg.inclui_miniensaio && pkg.inclui_palco) {
      summary.textContent = 'Inclui retratos no teatro e cobertura fotográfica das apresentações no palco.'
    } else if (pkg.inclui_miniensaio) {
      summary.textContent = 'Uma sessão de retratos individuais com figurino e fotografias ao lado da família, em um espaço preparado no teatro.'
    } else if (pkg.inclui_palco) {
      summary.textContent = 'Cobertura fotográfica do espetáculo no palco, com registros coletivos e de pequenos grupos. Não há garantia de foto individual. Não inclui miniensaio.'
    } else {
      summary.textContent = 'Uma experiência fotográfica preparada para registrar a trajetória da bailarina.'
    }

    const price = document.createElement('strong')
    price.className = 'experience-price'
    price.textContent = money(pkg.preco_centavos)

    const list = document.createElement('ul')
    for (const line of Array.isArray(pkg.descricao) ? pkg.descricao : []) {
      const item = document.createElement('li')
      item.textContent = String(line)
      list.append(item)
    }

    const notes = []
    if (pkg.inclui_miniensaio) {
      notes.push('O miniensaio acontece por ordem de chegada, dentro do período informado, sem horário individual.')
    }
    if (pkg.inclui_palco) {
      notes.push('A cobertura de palco registra apresentações e grupos, sem promessa de fotografia individual de cada participante.')
    }
    const note = document.createElement('p')
    note.className = 'experience-note'
    note.textContent = notes.join(' ')

    card.append(eyebrow, title, summary, price, list, note)
    container.append(card)
  }
}

function renderPackageInfo(card) {
  const select = card.querySelector('[data-package]')
  const detail = card.querySelector('[data-package-detail]')
  const pkg = packages.find((item) => item.id === select.value)

  detail.replaceChildren()

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

  updateSummary()
}

function addParticipant() {
  if (participantsList.children.length >= 10) {
    showMessage('Cada pedido pode incluir até 10 bailarinas.', 'warning')
    return
  }
  hideMessage()
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
  age.step = '1'
  age.dataset.age = 'true'
  age.inputMode = 'numeric'

  const packageSelect = document.createElement('select')
  packageSelect.id = 'dancer-package-' + participantSequence
  packageSelect.required = true
  packageSelect.dataset.package = 'true'
  const empty = document.createElement('option')
  empty.value = ''
  empty.textContent = 'Selecione uma experiência'
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
    makeField('Experiência', packageSelect, true),
  )

  const detail = document.createElement('div')
  detail.className = 'package-detail hidden'
  detail.dataset.packageDetail = 'true'

  packageSelect.addEventListener('change', () => renderPackageInfo(card))
  name.addEventListener('input', updateSummary)
  className.addEventListener('input', updateSummary)

  card.append(head, grid, detail)
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

    if (!name || !turma || !pkg) throw new Error('Preencha o nome, a turma e a experiência de cada bailarina.')
    if (ageValue && (!Number.isInteger(Number(ageValue)) || Number(ageValue) < 1 || Number(ageValue) > 99)) {
      throw new Error('Informe uma idade inteira entre 1 e 99 anos.')
    }

    result.push({
      pacote_id: packageId,
      nome: name,
      turma,
      idade: ageValue ? Number(ageValue) : null,
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
  const campaignTitle = campaign.nome_publico || 'Contratação da experiência fotográfica'
  document.getElementById('campaign-title').textContent = campaignTitle
  document.title = campaignTitle + ' | Grand Focus Fotografia'
  const description = document.querySelector('meta[name="description"]')
  if (description) description.content = 'Contratação de experiências fotográficas Grand Focus para ' + campaignTitle + '.'
  renderPackageOverview()
  const includesMini = packages.some((pkg) => pkg.inclui_miniensaio === true)
  const miniNote = document.getElementById('mini-session-note')
  if (miniNote) miniNote.classList.toggle('hidden', !includesMini)

  const meta = document.getElementById('event-meta')
  meta.replaceChildren()
  const chips = [campaign.escola_nome, formatDate(campaign.data_evento), campaign.local]
  if (includesMini) {
    chips.push('Miniensaio das ' + formatTime(campaign.miniensaio_inicio) + ' às ' + formatTime(campaign.miniensaio_fim))
    chips.push(campaign.duracao_minutos + ' minutos estimados por bailarina')
  }
  if (campaign.prazo_entrega_dias) chips.push(campaign.prazo_entrega_dias + ' dias de prazo de entrega')
  const visibleChips = chips.filter(Boolean)
  for (const label of visibleChips) {
    const chip = document.createElement('span')
    chip.className = 'meta-chip'
    chip.textContent = label
    meta.append(chip)
  }

  const terms = document.getElementById('terms-content')
  terms.textContent = campaign.termos_conteudo || 'Os termos desta contratação ainda não foram disponibilizados.'
  document.getElementById('terms-version').textContent = 'Versão dos termos ' + campaign.termos_versao
  document.getElementById('privacy-content').textContent =
    campaign.privacidade_conteudo || 'A política de privacidade ainda não foi disponibilizada.'
  document.getElementById('privacy-version').textContent =
    'Versão da política de privacidade ' + campaign.privacidade_versao
  const privacy = document.getElementById('privacy-link')
  privacy.replaceChildren()
  const privacyLink = document.createElement('a')
  privacyLink.href = campaign.privacidade_url
  privacyLink.target = '_blank'
  privacyLink.rel = 'noopener noreferrer'
  privacyLink.textContent = 'Abrir política de privacidade em outra página'
  privacy.append(privacyLink)

  if (campaign.autorizacao_imagem_conteudo) {
    document.getElementById('image-consent-area').classList.remove('hidden')
    document.getElementById('image-consent-content').textContent = campaign.autorizacao_imagem_conteudo
    document.getElementById('image-consent-version').textContent = 'Versão da autorização ' + campaign.autorizacao_imagem_versao
  }

  document.getElementById('supplier-footer').textContent =
    campaign.fornecedor_nome + ' • CNPJ ' + campaign.fornecedor_documento + ' • ' + campaign.fornecedor_email

  const helpLink = document.getElementById('gf-help-link')
  const helpNumber = String(campaign.whatsapp_atendimento || '').replace(/\D/g, '')
  if (helpLink && helpNumber.length >= 10 && helpNumber.length <= 13) {
    const internationalNumber = helpNumber.startsWith('55') ? helpNumber : '55' + helpNumber
    helpLink.href = 'https://wa.me/' + internationalNumber + '?text=' +
      encodeURIComponent('Olá! Preciso de ajuda com o formulário de contratação da Grand Focus.')
    helpLink.classList.remove('hidden')
  }

  if (campaign.whatsapp_atendimento) {
    const contact = document.createElement('span')
    contact.textContent = ' • Atendimento ' + campaign.whatsapp_atendimento
    document.getElementById('supplier-footer').append(contact)
  }

  loading.classList.add('hidden')
  form.classList.remove('hidden')
  addParticipant()
}

async function loadAdminPreview() {
  // A prévia depende de sessão administrativa e usa a própria função protegida.
  // Jamais exibir configurações privadas com base apenas na query string.
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  const { data: sessionData } = await client.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Entre primeiro como administrador na Galeria Grand Focus para visualizar o formulário.')

  const response = await fetch(SUPABASE_URL + '/functions/v1/contratacao-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ action: 'config', slug: CAMPAIGN_SLUG }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Prévia disponível apenas para administradores autorizados.')
  return {
    disponivel: true,
    evento: result.evento,
    pacotes: (result.pacotes || []).filter((item) => item.ativo === true),
  }
}

async function loadCampaign() {
  try {
    const data = ADMIN_PREVIEW ? await loadAdminPreview() : await api('dados')
    loading.classList.add('hidden')
    if (!data.disponivel) {
      document.getElementById('closed-message').textContent = data.mensagem || 'As contratações ainda não foram liberadas.'
      closed.classList.remove('hidden')
      return
    }
    renderCampaign(data)
    if (ADMIN_PREVIEW) {
      document.getElementById('admin-preview-banner').classList.remove('hidden')
      document.getElementById('payment-instructions').textContent =
        'Pré-visualização: este valor é apenas informativo. Nenhuma cobrança será feita.'
      document.getElementById('mini-reservation-note').textContent =
        'Esta prévia não reserva vagas nem cria pedidos.'
      document.getElementById('preview-admin-link').href =
        '/contratar/' + encodeURIComponent(CAMPAIGN_SLUG) + '/admin/'
      submitButton.disabled = true
    }
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
    ciente_privacidade: document.getElementById('privacy-acknowledged').checked,
    uso_imagem: document.getElementById('image-consent').checked,
  }
  if (!responsavel.nome || !responsavel.whatsapp || !responsavel.email) {
    throw new Error('Preencha todos os dados do responsável.')
  }
  const phoneDigits = responsavel.whatsapp.replace(/\D/g, '')
  if (phoneDigits.length < 10 || phoneDigits.length > 13) {
    throw new Error('Informe um WhatsApp válido com DDD.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel.email)) {
    throw new Error('Informe um e-mail válido.')
  }
  if (!aceite.responsavel_legal || !aceite.aceitou_termos || !aceite.ciente_privacidade) {
    throw new Error('É necessário declarar a responsabilidade, aceitar os termos e confirmar a ciência da política de privacidade.')
  }
  return { responsavel, participantes, aceite }
}

async function submitOrder(event) {
  event.preventDefault()
  if (ADMIN_PREVIEW) {
    showMessage('Esta tela é apenas uma prévia administrativa. Nenhum pedido será criado ou cobrado.', 'warning')
    return
  }
  // O Enter em um campo de texto não pode enviar o pedido antes da revisão final.
  if (currentFormStep !== FORM_STEPS.length - 1) {
    if (validateFormStep(currentFormStep)) setFormStep(currentFormStep + 1)
    return
  }
  hideMessage()

  let payload
  try {
    payload = collectPayload()
  } catch (error) {
    const requiredConsent = [
      document.getElementById('responsavel-legal'),
      document.getElementById('terms-accepted'),
      document.getElementById('privacy-acknowledged'),
    ].find(input => !input.checked)
    showStepError(error.message, requiredConsent || null)
    return
  }

  const signature = await digest(JSON.stringify(payload))
  let pending = null
  try { pending = JSON.parse(sessionStorage.getItem(CAMPAIGN_STORAGE_PREFIX + '_pending') || 'null') } catch {}
  if (!pending || pending.signature !== signature) {
    pending = {
      signature,
      access_token: randomHex(32),
      idempotency_key: crypto.randomUUID(),
    }
    sessionStorage.setItem(CAMPAIGN_STORAGE_PREFIX + '_pending', JSON.stringify(pending))
  }

  submitButton.disabled = true
  submitButton.textContent = 'Preparando pagamento…'

  try {
    const data = await api('contratar', {
      ...payload,
      company_website: document.getElementById('company-website').value,
      access_token: pending.access_token,
      idempotency_key: pending.idempotency_key,
    })
    if (!data.checkout_url) throw new Error('O checkout não foi retornado. Tente novamente.')
    localStorage.setItem(CAMPAIGN_STORAGE_PREFIX + '_token_' + data.order_nsu, pending.access_token)
    sessionStorage.removeItem(CAMPAIGN_STORAGE_PREFIX + '_pending')
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

  const token = localStorage.getItem(CAMPAIGN_STORAGE_PREFIX + '_token_' + orderNsu)
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
      if (pedido.status === 'reembolsado') {
        document.getElementById('return-title').textContent = 'Pagamento estornado'
        document.getElementById('return-message').textContent =
          'O estorno deste pedido foi registrado. Se precisar de ajuda, entre em contato com a Grand Focus.'
        panel.classList.add('warning')
        return true
      }
      if (pedido.status === 'expirado' || pedido.status === 'cancelado') {
        document.getElementById('return-title').textContent = pedido.status === 'cancelado' ? 'Pedido cancelado' : 'A reserva expirou'
        document.getElementById('return-message').textContent =
          'Este pedido não está mais ativo. Entre em contato com a Grand Focus antes de realizar uma nova contratação.'
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

// Apresentação inspirada nas páginas de perguntas do Google Forms.
// A navegação muda apenas a interface; o payload, os aceites e os valores não mudam.
const FORM_STEPS = [
  'Conheça as experiências',
  'Bailarinas e experiências',
  'Dados do responsável',
  'Termos e revisão',
]
const STEP_DESCRIPTIONS = [
  'Veja as opções com calma. Você escolhe o pacote na próxima etapa.',
  'Preencha as informações das bailarinas. Toque em Próxima quando terminar.',
  'Informe como podemos identificar o responsável por este pedido.',
  'Confira as informações e leia os termos antes de continuar.',
]
let currentFormStep = 0
const formStepSections = [...form.querySelectorAll('[data-form-step]')]
const formStepBack = document.getElementById('form-back')
const formStepNext = document.getElementById('form-next')
const formProgress = document.querySelector('.gf-progress-track')

function clearInlineErrors() {
  for (const message of form.querySelectorAll('.gf-inline-error')) message.remove()
  for (const element of form.querySelectorAll('[data-gf-invalid]')) {
    element.removeAttribute('aria-invalid')
    element.removeAttribute('data-gf-invalid')
    const existing = String(element.getAttribute('aria-describedby') || '')
    const clean = existing.split(/\s+/).filter(id => id && !id.startsWith('gf-field-error-'))
    if (clean.length) element.setAttribute('aria-describedby', clean.join(' '))
    else element.removeAttribute('aria-describedby')
  }
}

function firstIncompleteParticipantField() {
  for (const card of participantsList.querySelectorAll('.participant-card')) {
    for (const key of ['name', 'class', 'package']) {
      const field = card.querySelector('[data-' + key + ']')
      if (field && !field.value.trim()) return field
    }
    const age = card.querySelector('[data-age]')
    if (age?.value && (!Number.isInteger(Number(age.value)) || Number(age.value) < 1 || Number(age.value) > 99)) {
      return age
    }
  }
  return null
}

function showStepError(message, field = null) {
  clearInlineErrors()
  showMessage(message, 'error')
  if (!field) {
    formMessage.scrollIntoView({ behavior: 'auto', block: 'center' })
    return
  }
  field.dataset.gfInvalid = 'true'
  field.setAttribute('aria-invalid', 'true')
  const hint = document.createElement('span')
  hint.id = 'gf-field-error-' + Math.random().toString(36).slice(2)
  hint.className = 'gf-inline-error'
  hint.textContent = message
  const group = field.closest('.field, .consent')
  if (group?.classList.contains('consent')) group.insertAdjacentElement('afterend', hint)
  else if (group) group.append(hint)
  else field.insertAdjacentElement('afterend', hint)
  field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '))
  field.focus({ preventScroll: true })
  field.scrollIntoView({ behavior: 'auto', block: 'center' })
}

function validateFormStep(step) {
  clearInlineErrors()
  if (step === 1) {
    try {
      collectParticipants()
    } catch (error) {
      showStepError(error.message, firstIncompleteParticipantField())
      return false
    }
  }

  if (step === 2) {
    const nameInput = document.getElementById('responsavel-nome')
    const phoneInput = document.getElementById('responsavel-whatsapp')
    const emailInput = document.getElementById('responsavel-email')
    const nome = nameInput.value.trim()
    const digits = phoneInput.value.replace(/\D/g, '')
    const email = emailInput.value.trim()
    if (nome.length < 5) {
      showStepError('Informe o nome completo do responsável.', nameInput)
      return false
    }
    if (digits.length < 10 || digits.length > 13) {
      showStepError('Informe um WhatsApp válido com DDD.', phoneInput)
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStepError('Informe um e-mail válido.', emailInput)
      return false
    }
  }

  return true
}

function setFormStep(step, scroll = true) {
  currentFormStep = Math.max(0, Math.min(FORM_STEPS.length - 1, step))
  const isLast = currentFormStep === FORM_STEPS.length - 1
  formStepSections.forEach((section) => {
    section.hidden = Number(section.dataset.formStep) !== currentFormStep
  })
  document.getElementById('form-step-heading').textContent = FORM_STEPS[currentFormStep]
  document.getElementById('gf-step-description').textContent = STEP_DESCRIPTIONS[currentFormStep]
  document.getElementById('form-step-count').textContent = 'Página ' + (currentFormStep + 1) + ' de ' + FORM_STEPS.length
  document.getElementById('form-nav-current').textContent = String(currentFormStep + 1)
  document.getElementById('form-step-fill').style.width = ((currentFormStep + 1) / FORM_STEPS.length * 100) + '%'
  formProgress.setAttribute('aria-valuenow', String(currentFormStep + 1))
  formStepBack.hidden = currentFormStep === 0
  formStepNext.hidden = isLast
  formStepNext.textContent = currentFormStep === 0 ? 'Começar' : 'Próxima etapa'
  submitButton.hidden = !isLast || ADMIN_PREVIEW
  document.getElementById('preview-final-info').hidden = !isLast || !ADMIN_PREVIEW
  clearInlineErrors()
  hideMessage()
  if (isLast) updateSummary()
  if (scroll) {
    const activeSection = formStepSections.find(section => !section.hidden)
    const heading = activeSection?.querySelector('h2')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      heading.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
  }
}

const fontToggle = document.getElementById('gf-font-toggle')
const fontLabel = document.getElementById('gf-font-label')
function syncReaderTextSize() {
  const expanded = document.body.classList.contains('gf-large-text')
  fontToggle.setAttribute('aria-pressed', String(expanded))
  fontLabel.textContent = expanded ? 'Voltar ao texto normal' : 'Aumentar letras'
}
try {
  if (localStorage.getItem('gf_form_big_text') === 'true') document.body.classList.add('gf-large-text')
} catch { /* Navegadores com armazenamento restrito seguem com texto padrão legível. */ }
syncReaderTextSize()
fontToggle.addEventListener('click', () => {
  document.body.classList.toggle('gf-large-text')
  syncReaderTextSize()
  try { localStorage.setItem('gf_form_big_text', String(document.body.classList.contains('gf-large-text'))) } catch {}
})

// Clear per-field errors as soon as the visitor edits the highlighted answer.
form.addEventListener('input', event => {
  if (event.target?.matches?.('[data-gf-invalid]')) {
    clearInlineErrors()
    hideMessage()
  }
})
form.addEventListener('change', event => {
  if (event.target?.matches?.('[data-gf-invalid]')) {
    clearInlineErrors()
    hideMessage()
  }
})

formStepBack.addEventListener('click', () => setFormStep(currentFormStep - 1))
formStepNext.addEventListener('click', () => {
  if (validateFormStep(currentFormStep)) setFormStep(currentFormStep + 1)
})
form.classList.add('gf-steps-enabled')
setFormStep(0, false)

document.getElementById('add-participant').addEventListener('click', addParticipant)
form.addEventListener('submit', submitOrder)

async function start() {
  if (await loadOrderReturn()) return
  await loadCampaign()
}

start();
