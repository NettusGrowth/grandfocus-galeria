import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const API_URL = SUPABASE_URL + '/functions/v1/contratacao-admin'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

const loginCard = document.getElementById('login-card')
const managerArea = document.getElementById('manager-area')
const loginMessage = document.getElementById('login-message')
const managerMessage = document.getElementById('manager-message')
const campaignList = document.getElementById('campaign-list')
let schools = []
let slugWasEdited = false

function notice(element, message) {
  element.textContent = message
  element.classList.remove('hidden')
}
function clearNotice(element) {
  element.textContent = ''
  element.classList.add('hidden')
}
function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
function statusLabel(status) {
  return ({
    rascunho: 'Em configuração',
    publicado: 'Publicado',
    pausado: 'Pausado',
    encerrado: 'Encerrado',
  })[status] || status || 'Não informado'
}
function formatDate(value) {
  if (!value) return 'Data a confirmar'
  const date = new Date(String(value) + 'T12:00:00')
  if (Number.isNaN(date.getTime())) return 'Data a confirmar'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date)
}

async function adminRequest(action, values = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.')
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ action, ...values }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.')
  return data
}

async function loadSchools() {
  const data = await adminRequest('listar_escolas')
  schools = data.escolas || []
  const select = document.getElementById('school-select')
  select.replaceChildren()
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Selecione a escola'
  select.append(placeholder)
  for (const school of schools) {
    const option = document.createElement('option')
    option.value = school.id
    option.textContent = school.nome + (school.cidade ? ' · ' + school.cidade : '')
    select.append(option)
  }
}

function makeLink(text, href, targetBlank = false) {
  const link = document.createElement('a')
  link.textContent = text
  link.href = href
  if (targetBlank) {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  return link
}

function renderCampaigns(campaigns) {
  campaignList.replaceChildren()
  if (!campaigns.length) {
    const empty = document.createElement('div')
    empty.className = 'manager-empty'
    empty.textContent = 'Ainda não há contratações cadastradas. Use “Nova contratação” para criar o primeiro evento e sua página.'
    campaignList.append(empty)
    return
  }

  for (const campaign of campaigns) {
    const card = document.createElement('article')
    card.className = 'campaign-card'

    const heading = document.createElement('div')
    heading.className = 'participant-head'
    const titleWrap = document.createElement('div')
    const title = document.createElement('h3')
    title.textContent = campaign.nome_publico || campaign.evento_nome || 'Evento sem nome'
    const subtitle = document.createElement('p')
    subtitle.className = 'campaign-sub'
    subtitle.textContent = campaign.escola_nome || 'Escola não informada'
    titleWrap.append(title, subtitle)

    const status = document.createElement('span')
    status.className = 'campaign-status'
    status.textContent = statusLabel(campaign.status)
    heading.append(titleWrap, status)

    const meta = document.createElement('div')
    meta.className = 'campaign-meta'
    const date = document.createElement('span')
    date.textContent = 'Evento em ' + formatDate(campaign.data_evento)
    const orders = document.createElement('span')
    orders.textContent = String(campaign.quantidade_pedidos || 0) + ' pedido(s)'
    meta.append(date, orders)

    const actions = document.createElement('div')
    actions.className = 'campaign-actions'
    const editorUrl = '/contratar/' + encodeURIComponent(campaign.slug) + '/admin/'
    actions.append(makeLink('Configurar contratação', editorUrl))
    if (campaign.status === 'publicado') {
      const publicUrl = window.location.origin + '/contratar/' + encodeURIComponent(campaign.slug) + '/'
      actions.append(makeLink('Abrir página pública', publicUrl, true))
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'text-button'
      copy.textContent = 'Copiar link público'
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(publicUrl)
          notice(managerMessage, 'Link público copiado.')
        } catch {
          notice(managerMessage, 'Não foi possível copiar automaticamente. Abra a página pública e copie o endereço do navegador.')
        }
      })
      actions.append(copy)
    }

    card.append(heading, meta, actions)
    campaignList.append(card)
  }
}

async function loadCampaigns() {
  campaignList.replaceChildren()
  const loading = document.createElement('div')
  loading.className = 'manager-empty'
  loading.textContent = 'Carregando contratações…'
  campaignList.append(loading)
  const data = await adminRequest('listar_campanhas')
  renderCampaigns(data.campanhas || [])
}

async function enterManager() {
  clearNotice(loginMessage)
  try {
    await Promise.all([loadSchools(), loadCampaigns()])
    loginCard.classList.add('hidden')
    managerArea.classList.remove('hidden')
  } catch (error) {
    managerArea.classList.add('hidden')
    loginCard.classList.remove('hidden')
    notice(loginMessage, error.message)
  }
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  clearNotice(loginMessage)
  const button = document.getElementById('login-button')
  button.disabled = true
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value,
    })
    if (error) throw error
    await enterManager()
  } catch (error) {
    notice(loginMessage, error.message || 'Não foi possível entrar.')
  } finally {
    button.disabled = false
  }
})

document.getElementById('logout-button').addEventListener('click', async () => {
  await supabase.auth.signOut()
  managerArea.classList.add('hidden')
  loginCard.classList.remove('hidden')
})

document.getElementById('show-create-button').addEventListener('click', () => {
  clearNotice(managerMessage)
  document.getElementById('new-campaign-form').classList.remove('hidden')
  document.getElementById('event-name').focus()
})
document.getElementById('cancel-create-button').addEventListener('click', () => {
  document.getElementById('new-campaign-form').classList.add('hidden')
})
document.getElementById('refresh-campaigns').addEventListener('click', async () => {
  clearNotice(managerMessage)
  try {
    await loadCampaigns()
  } catch (error) {
    notice(managerMessage, error.message)
  }
})

document.getElementById('event-name').addEventListener('input', () => {
  if (!slugWasEdited) document.getElementById('campaign-slug').value = slugify(document.getElementById('event-name').value)
})
document.getElementById('campaign-slug').addEventListener('input', () => {
  slugWasEdited = true
  const field = document.getElementById('campaign-slug')
  field.value = slugify(field.value)
})

document.getElementById('new-campaign-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  clearNotice(managerMessage)
  const button = document.getElementById('create-campaign-button')
  button.disabled = true
  try {
    const values = {
      evento_nome: document.getElementById('event-name').value.trim(),
      data_evento: document.getElementById('event-date').value,
      escola_id: document.getElementById('school-select').value,
      slug: document.getElementById('campaign-slug').value.trim(),
    }
    const result = await adminRequest('criar_campanha', values)
    const slug = result.campanha?.slug || values.slug
    notice(managerMessage, 'Evento e contratação criados juntos. Agora configure as experiências e os dados da página.')
    try { window.parent.postMessage({ type: 'grandfocus:contratacao-event-created' }, window.location.origin) } catch {}
    window.location.assign('/contratar/' + encodeURIComponent(slug) + '/admin/')
  } catch (error) {
    notice(managerMessage, error.message)
  } finally {
    button.disabled = false
  }
})

const { data: sessionData } = await supabase.auth.getSession()
if (sessionData?.session) await enterManager()
