import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://selnsjtumkxjrtnqofqx.supabase.co'
const SUPABASE_PUBLIC_KEY = 'sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const API_URL = SUPABASE_URL + '/functions/v1/contratacao-admin'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

const loginCard = document.getElementById('login-card')
const adminArea = document.getElementById('admin-area')
const loginMessage = document.getElementById('login-message')
const adminMessage = document.getElementById('admin-message')
let currentEvent = null
let currentPackages = []

function showNotice(element, message) {
  element.textContent = message
  element.classList.remove('hidden')
}
function clearNotice(element) {
  element.textContent = ''
  element.classList.add('hidden')
}
function moneyToInput(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',')
}
function parseMoney(value) {
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.')
  const number = Number(normalized)
  if (!Number.isFinite(number)) return NaN
  return Math.round(number * 100)
}
function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}
function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Data ou horário inválido.')
  return date.toISOString()
}
function formatDate(value) {
  if (!value) return 'Não informado'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
function formatMoney(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100)
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

function setField(id, value) {
  const element = document.getElementById(id)
  if (element) element.value = value ?? ''
}
function getField(id) {
  return document.getElementById(id).value.trim()
}

async function loadConfig() {
  const data = await adminRequest('config')
  currentEvent = data.evento
  currentPackages = data.pacotes || []
  setField('event-date', currentEvent.data_evento)
  setField('event-place', currentEvent.local)
  setField('mini-start', toLocalInput(currentEvent.miniensaio_inicio))
  setField('mini-end', toLocalInput(currentEvent.miniensaio_fim))
  setField('duration', currentEvent.duracao_minutos)
  setField('capacity', currentEvent.capacidade_miniensaios)
  setField('sales-end', toLocalInput(currentEvent.vendas_encerram_em))
  setField('reservation-minutes', currentEvent.reserva_minutos)
  setField('delivery-days', currentEvent.prazo_entrega_dias)
  setField('support-whatsapp', currentEvent.whatsapp_atendimento)
  setField('supplier-name', currentEvent.fornecedor_nome)
  setField('supplier-document', currentEvent.fornecedor_documento)
  setField('supplier-address', currentEvent.fornecedor_endereco)
  setField('supplier-email', currentEvent.fornecedor_email)
  setField('privacy-url', currentEvent.privacidade_url)
  setField('privacy-version', currentEvent.privacidade_versao)
  setField('privacy-text', currentEvent.privacidade_conteudo)
  setField('terms-version', currentEvent.termos_versao)
  setField('terms-text', currentEvent.termos_conteudo)
  setField('image-version', currentEvent.autorizacao_imagem_versao)
  setField('image-text', currentEvent.autorizacao_imagem_conteudo)
  document.getElementById('campaign-status').textContent =
    'Status atual ' + currentEvent.status + ' • Data cadastrada ' + (currentEvent.data_evento || 'não confirmada')
  const integration = data.integracao || {}
  document.getElementById('integration-status').textContent = [
    'Pagamentos reais ' + (integration.pagamentos_reais_ativados ? 'ATIVADOS' : 'desativados'),
    'API Key InfinitePay ' + (integration.api_key_configurada ? 'configurada' : 'pendente'),
    'InfiniteTag ' + (integration.infinite_tag_configurada ? 'configurada' : 'pendente'),
  ].join(' • ')
  renderPackages()
}

function renderPackages() {
  const root = document.getElementById('package-fields')
  root.replaceChildren()
  for (const pkg of currentPackages) {
    const card = document.createElement('div')
    card.className = 'participant-card'
    const title = document.createElement('strong')
    title.textContent = pkg.nome
    const priceField = document.createElement('div')
    priceField.className = 'field'
    const label = document.createElement('label')
    label.textContent = 'Preço em reais'
    label.htmlFor = 'price-' + pkg.codigo
    const input = document.createElement('input')
    input.id = 'price-' + pkg.codigo
    input.inputMode = 'decimal'
    input.value = moneyToInput(pkg.preco_centavos)
    input.dataset.packagePrice = pkg.codigo
    priceField.append(label, input)

    const activeLabel = document.createElement('label')
    activeLabel.className = 'consent'
    const active = document.createElement('input')
    active.type = 'checkbox'
    active.checked = pkg.ativo
    active.dataset.packageActive = pkg.codigo
    const activeText = document.createElement('span')
    activeText.textContent = 'Disponibilizar este pacote na página de contratação'
    activeLabel.append(active, activeText)

    const description = document.createElement('p')
    description.className = 'hint'
    description.textContent = Array.isArray(pkg.descricao) ? pkg.descricao.join(' • ') : ''
    card.append(title, priceField, activeLabel, description)
    root.append(card)
  }
}

function collectConfig() {
  return {
    evento: {
      data_evento: getField('event-date') || null,
      local: getField('event-place'),
      miniensaio_inicio: toIso(getField('mini-start')),
      miniensaio_fim: toIso(getField('mini-end')),
      duracao_minutos: Number(getField('duration')),
      capacidade_miniensaios: getField('capacity') === '' ? null : Number(getField('capacity')),
      vendas_encerram_em: toIso(getField('sales-end')),
      reserva_minutos: Number(getField('reservation-minutes')),
      prazo_entrega_dias: getField('delivery-days') === '' ? null : Number(getField('delivery-days')),
      whatsapp_atendimento: getField('support-whatsapp'),
      fornecedor_nome: getField('supplier-name'),
      fornecedor_documento: getField('supplier-document'),
      fornecedor_endereco: getField('supplier-address'),
      fornecedor_email: getField('supplier-email'),
      privacidade_url: getField('privacy-url'),
      privacidade_versao: getField('privacy-version'),
      privacidade_conteudo: document.getElementById('privacy-text').value,
      termos_versao: getField('terms-version'),
      termos_conteudo: document.getElementById('terms-text').value,
      autorizacao_imagem_versao: getField('image-version'),
      autorizacao_imagem_conteudo: document.getElementById('image-text').value,
    },
    pacotes: currentPackages.map((pkg) => ({
      codigo: pkg.codigo,
      preco_centavos: parseMoney(document.getElementById('price-' + pkg.codigo).value),
      ativo: document.querySelector('[data-package-active="' + pkg.codigo + '"]').checked,
    })),
  }
}

async function saveConfig() {
  clearNotice(adminMessage)
  try {
    const config = collectConfig()
    if (config.pacotes.some((pkg) => !Number.isInteger(pkg.preco_centavos) || pkg.preco_centavos < 100)) {
      throw new Error('Confira os preços. Cada pacote deve custar pelo menos R$ 1,00.')
    }
    await adminRequest('salvar', config)
    showNotice(adminMessage, 'Configuração salva. A campanha continua no status atual.')
    await loadConfig()
    return true
  } catch (error) {
    showNotice(adminMessage, error.message)
    return false
  }
}

async function changeCampaign(action, confirmText) {
  clearNotice(adminMessage)
  if (!window.confirm(confirmText)) return
  try {
    if (action === 'salvar') {
      await saveConfig()
      return
    }
    const result = await adminRequest(action)
    showNotice(adminMessage, 'Status atualizado para ' + (result.status || result.resultado?.status || 'concluído') + '.')
    await loadConfig()
  } catch (error) {
    showNotice(adminMessage, error.message)
  }
}

function statusLabel(status) {
  const labels = {
    aguardando_pagamento: 'Aguardando pagamento',
    pagamento_pendente: 'Pagamento pendente',
    pago: 'Pago',
    expirado: 'Expirado',
    cancelado: 'Cancelado',
    reembolsado: 'Reembolsado',
    conciliacao_pendente: 'Em conciliação',
  }
  return labels[status] || status
}

async function loadOrders() {
  const tbody = document.getElementById('orders-body')
  tbody.replaceChildren()
  const loadingRow = document.createElement('tr')
  const loadingCell = document.createElement('td')
  loadingCell.colSpan = 6
  loadingCell.textContent = 'Carregando pedidos…'
  loadingRow.append(loadingCell)
  tbody.append(loadingRow)

  try {
    const data = await adminRequest('pedidos')
    tbody.replaceChildren()
    if (!data.pedidos?.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 6
      cell.textContent = 'Nenhum pedido recebido até o momento.'
      row.append(cell)
      tbody.append(row)
      return
    }

    for (const pedido of data.pedidos) {
      const row = document.createElement('tr')
      row.dataset.pedido = pedido.id
      const values = [
        '#' + pedido.numero,
        pedido.responsavel_nome + ' • ' + pedido.responsavel_whatsapp,
        String(pedido.quantidade_bailarinas),
        formatMoney(pedido.valor_total_centavos),
        statusLabel(pedido.status),
        formatDate(pedido.criado_em),
      ]
      for (const value of values) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      }
      row.addEventListener('click', () => loadOrderDetail(pedido.id))
      tbody.append(row)
    }
  } catch (error) {
    tbody.replaceChildren()
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 6
    cell.textContent = error.message
    row.append(cell)
    tbody.append(row)
  }
}

async function loadOrderDetail(id) {
  const root = document.getElementById('order-detail')
  root.classList.remove('hidden')
  root.replaceChildren()
  const loading = document.createElement('p')
  loading.textContent = 'Carregando detalhes do pedido…'
  root.append(loading)

  try {
    const data = await adminRequest('detalhe', { pedido_id: id })
    root.replaceChildren()
    const heading = document.createElement('h3')
    heading.textContent = 'Pedido #' + data.pedido.numero
    const summary = document.createElement('pre')
    summary.textContent = JSON.stringify({
      responsavel: {
        nome: data.pedido.responsavel_nome,
        whatsapp: data.pedido.responsavel_whatsapp,
        email: data.pedido.responsavel_email,
      },
      status: statusLabel(data.pedido.status),
      valor_total: formatMoney(data.pedido.valor_total_centavos),
      participantes: data.participantes,
      pagamento: data.pagamento,
      aceite: data.aceite,
      webhooks: data.webhooks,
    }, null, 2)
    root.append(heading, summary)

    if (['pagamento_pendente','conciliacao_pendente'].includes(data.pedido.status)) {
      const reconcile = document.createElement('button')
      reconcile.type = 'button'
      reconcile.className = 'btn btn-secondary'
      reconcile.textContent = 'Consultar pagamento na InfinitePay'
      reconcile.addEventListener('click', async () => {
        reconcile.disabled = true
        try {
          const result = await adminRequest('reconciliar', { pedido_id: id })
          showNotice(adminMessage, result.resultado?.status === 'pago' ? 'Pagamento confirmado.' : 'Consulta concluída.')
          await loadOrders()
          await loadOrderDetail(id)
        } catch (error) {
          showNotice(adminMessage, error.message)
          reconcile.disabled = false
        }
      })
      root.append(reconcile)
    }

    if (data.pedido.status === 'pago' || data.pedido.status === 'conciliacao_pendente') {
      const reason = document.createElement('textarea')
      reason.rows = 2
      reason.placeholder = 'Registre o motivo e a conferência do estorno realizado na InfinitePay'
      reason.style.width = '100%'
      reason.style.marginTop = '12px'
      const refund = document.createElement('button')
      refund.type = 'button'
      refund.className = 'btn btn-danger'
      refund.textContent = 'Registrar estorno já realizado'
      refund.style.marginTop = '10px'
      refund.addEventListener('click', async () => {
        if (reason.value.trim().length < 10) {
          showNotice(adminMessage, 'Descreva a conferência do estorno antes de registrar.')
          return
        }
        if (!window.confirm('Confirma que o estorno já foi realizado no aplicativo ou na conta InfinitePay?')) return
        refund.disabled = true
        try {
          await adminRequest('marcar_reembolsado', { pedido_id: id, motivo: reason.value.trim() })
          showNotice(adminMessage, 'Estorno registrado no pedido. A operação financeira foi realizada fora deste painel.')
          await loadOrders()
          await loadOrderDetail(id)
        } catch (error) {
          showNotice(adminMessage, error.message)
          refund.disabled = false
        }
      })
      root.append(reason, refund)
    }
  } catch (error) {
    root.replaceChildren()
    const message = document.createElement('p')
    message.textContent = error.message
    root.append(message)
  }
}

async function enterAdmin() {
  clearNotice(loginMessage)
  try {
    await loadConfig()
    await loadOrders()
    loginCard.classList.add('hidden')
    adminArea.classList.remove('hidden')
  } catch (error) {
    adminArea.classList.add('hidden')
    loginCard.classList.remove('hidden')
    showNotice(loginMessage, error.message)
    await supabase.auth.signOut()
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
    await enterAdmin()
  } catch (error) {
    showNotice(loginMessage, error.message || 'Não foi possível entrar.')
  } finally {
    button.disabled = false
  }
})

document.getElementById('logout-button').addEventListener('click', async () => {
  await supabase.auth.signOut()
  adminArea.classList.add('hidden')
  loginCard.classList.remove('hidden')
})

document.getElementById('save-button').addEventListener('click', saveConfig)
document.getElementById('publish-button').addEventListener('click', async () => {
  if (!window.confirm('Publicar a campanha agora? A página ficará disponível para contratação assim que os dados forem validados.')) return
  const saved = await saveConfig()
  if (!saved) return
  try {
    const result = await adminRequest('publicar')
    showNotice(adminMessage, 'Campanha publicada. A página pública já pode receber contratações.')
    await loadConfig()
  } catch (error) {
    showNotice(adminMessage, error.message)
  }
})
document.getElementById('pause-button').addEventListener('click', () =>
  changeCampaign('pausar', 'Pausar a campanha? Novas contratações serão bloqueadas.'))
document.getElementById('close-button').addEventListener('click', () =>
  changeCampaign('encerrar', 'Encerrar a campanha? Novas contratações serão bloqueadas.'))
document.getElementById('refresh-orders').addEventListener('click', loadOrders)

const { data: sessionData } = await supabase.auth.getSession()
if (sessionData?.session) await enterAdmin()
