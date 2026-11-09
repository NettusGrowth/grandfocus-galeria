import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const API_URL = SUPABASE_URL + '/functions/v1/contratacao-admin'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

async function resolverEmailDeLogin(value) {
  const identifier = String(value || '').trim()
  if (identifier.includes('@')) return identifier
  const { data: email, error } = await supabase.rpc('email_por_usuario', {
    p_username: identifier.toLowerCase(),
  })
  if (error || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Usuário ou senha incorretos.')
  }
  return email
}

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

function makeIcon(name) {
  const paths={
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
    orders:'<path d="M7 3h10a2 2 0 0 1 2 2v16l-3.5-2.2L12 21l-3.5-2.2L5 21V5a2 2 0 0 1 2-2Z"/><path d="M9 9h6M9 13h6"/>',
    manage:'<path d="M4 6h10M4 12h9M4 18h8"/><path d="M17 4v7M13.5 7.5h7"/>',
    external:'<path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  }
  const span=document.createElement('span')
  span.className='manager-inline-icon'
  span.setAttribute('aria-hidden','true')
  // Markup is a constant icon map; no data from schools or users enters HTML.
  span.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||'')+'</svg>'
  return span
}
function setCampaignOverview(campaigns) {
  const total=campaigns.length
  const published=campaigns.filter(item=>item.status==='publicado').length
  const orders=campaigns.reduce((sum,item)=>{
    const n=Number(item.quantidade_pedidos)
    return sum+(Number.isSafeInteger(n)&&n>0?n:0)
  },0)
  document.getElementById('manager-stat-total').textContent=String(total)
  document.getElementById('manager-stat-published').textContent=String(published)
  document.getElementById('manager-stat-orders').textContent=String(orders)
  document.getElementById('manager-campaign-count').textContent=total===1?'1 campanha':total+' campanhas'
}
function renderCampaigns(campaigns) {
  campaignList.replaceChildren()
  setCampaignOverview(campaigns)
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
    card.dataset.status = campaign.status || 'rascunho'

    const heading = document.createElement('div')
    heading.className = 'campaign-card-header'
    const titleWrap = document.createElement('div')
    titleWrap.className = 'campaign-card-title'
    const kicker = document.createElement('p')
    kicker.className = 'campaign-kicker'
    kicker.textContent = 'EVENTO · GRAND FOCUS'
    titleWrap.append(kicker)
    const title = document.createElement('h3')
    title.textContent = campaign.nome_publico || campaign.evento_nome || 'Evento sem nome'
    const subtitle = document.createElement('p')
    subtitle.className = 'campaign-sub'
    subtitle.textContent = campaign.escola_nome || 'Escola não informada'
    titleWrap.append(title, subtitle)

    const status = document.createElement('span')
    status.className = 'campaign-status'
    status.dataset.status = campaign.status || 'rascunho'
    status.textContent = statusLabel(campaign.status)
    heading.append(titleWrap, status)

    const meta = document.createElement('div')
    meta.className = 'campaign-meta'
    const date = document.createElement('span')
    date.append(makeIcon('calendar'),document.createTextNode(formatDate(campaign.data_evento)))
    const orders = document.createElement('span')
    orders.append(makeIcon('orders'),document.createTextNode(String(campaign.quantidade_pedidos || 0) + ' pedido(s) online'))
    meta.append(date, orders)

    const actions = document.createElement('div')
    actions.className = 'campaign-actions'
    const editorUrl = '/contratar/' + encodeURIComponent(campaign.slug) + '/admin/'
    const manage = makeLink('Gerenciar campanha', editorUrl)
    manage.className = 'campaign-manage'
    manage.prepend(makeIcon('manage'))
    actions.append(manage)
    if (campaign.status === 'publicado') {
      const publicUrl = window.location.origin + '/contratar/' + encodeURIComponent(campaign.slug) + '/'
      const publicLink=makeLink('Página pública',publicUrl,true)
      publicLink.className='campaign-public'
      publicLink.prepend(makeIcon('external'))
      actions.append(publicLink)
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'campaign-copy'
      copy.append(makeIcon('copy'),document.createTextNode('Copiar link'))
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(publicUrl)
          copy.textContent='✓ Link copiado'
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
    const email = await resolverEmailDeLogin(document.getElementById('login-email').value)
    const { error } = await supabase.auth.signInWithPassword({
      email,
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
  document.getElementById('new-campaign-form').scrollIntoView({behavior:'smooth',block:'start'})
  document.getElementById('event-name').focus({preventScroll:true})
})
document.getElementById('cancel-create-button').addEventListener('click', () => {
  document.getElementById('new-campaign-form').classList.add('hidden')
  document.getElementById('show-create-button').focus()
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
