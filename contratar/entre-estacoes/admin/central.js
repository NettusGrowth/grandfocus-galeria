import { processingFeeCents, projectedNetCents } from './fees.js'
import {calculateGenteCommission} from './gente-commission.js'

/* Central de Gestão Grand Focus — exclusiva da área administrativa autenticada.
 * Sem edição do status pago dos pedidos InfinitePay; pagamentos históricos exigem conferência.
 */
const centralRoot = document.getElementById('gf-central')
const centralDialog = document.getElementById('gf-central-dialog')
const centralList = document.getElementById('gf-central-list')
const centralDetail = document.getElementById('gf-central-detail')
const centralMetrics = document.getElementById('gf-central-metrics')
const centralNotice = document.getElementById('gf-central-notice')
const centralSearch = document.getElementById('gf-central-search')
const centralOrigin = document.getElementById('gf-central-origin')
const centralSort = document.getElementById('gf-central-sort')
const centralResultCount = document.getElementById('gf-central-results-count')
const centralState = { data: [], view: 'todos', layout: 'compact', selected: null, loading: false, ready: false, section: null, feeBps:420, previousIds:new Set() } 
const financeScope = () => decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'entre-estacoes')
const financeRows = document.getElementById('gf-finance-sync-rows')
const financeFilter = document.getElementById('gf-finance-filter')
const financeCount = document.getElementById('gf-finance-sync-count')
const financeStatus = document.getElementById('gf-finance-sync-status')

const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(value)||0)/100)
const safeDate = value => {
  if (!value) return 'Não informado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo' })
}
const escapeSearch = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()

function apiCentral(action, fields) {
  const request = window.gfContratacaoAdminRequest
  if (typeof request !== 'function') throw new Error('Entre como administrador para acessar esta central.')
  return request(action, fields || {})
}
function dom(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined && text !== null) el.textContent = String(text)
  return el
}
function notice(text, kind) {
  centralNotice.textContent = text
  centralNotice.dataset.kind = kind||'info'
  const dialogNotice=document.getElementById('gf-modal-notice')
  if(dialogNotice && centralDialog.open){
    dialogNotice.textContent=text
    dialogNotice.dataset.kind=kind||'info'
    dialogNotice.hidden=false
  }
}
function tag(text, tone) {
  const element = dom('span','gf-tag',text)
  element.dataset.tone = tone||'neutral'
  return element
}
function countBy(predicate) { return centralState.data.filter(predicate).length }
function nativePaid(record) { return record.source === 'online' && record.status === 'pago' }
function legacyPaid(record) { return record.source === 'formulario' && record.status === 'pago_manual' }
function paid(record) { return nativePaid(record)||legacyPaid(record) }
function confirmedMoney(record) {
  if (record.source==='online') return nativePaid(record) ? Number(record.paidValue) : 0
  return ['parcial','pago_manual'].includes(record.status) ? Number(record.paidValue) : 0
}
function pendingMoney(record) {
  if (record.source==='online') {
    return ['aguardando_pagamento','pagamento_pendente'].includes(record.status) ? Math.max(0,record.value-confirmedMoney(record)) : 0
  }
  return ['nao_conferido','pendente','parcial'].includes(record.status) ?
    Math.max(0,(record.value||0)-confirmedMoney(record)) : 0
}
function needsReview(record) { return record.source==='formulario' && record.status==='nao_conferido' || record.source==='online' && record.status==='conciliacao_pendente' }
function needsFollow(record) {
  const follow = record.follow||{}
  if (follow.situacao==='concluido'||follow.situacao==='nao_precisa') return false
  if (follow.situacao==='contatar') return true
  if (follow.proximo_contato_em) return follow.proximo_contato_em <= new Date().toISOString().slice(0,10)
  return false
}
function openPending(record) { return pendingMoney(record)>0 || record.status==='conciliacao_pendente' }
function statusDisplay(record) {
  const map = record.source==='online' ? {
    pago:['Pago pela InfinitePay','positive'],
    aguardando_pagamento:['Aguardando pagamento','attention'],
    pagamento_pendente:['Pagamento pendente','attention'],
    conciliacao_pendente:['Em conferência','danger'],
    reembolsado:['Reembolsado','neutral'],
    expirado:['Pedido expirado','neutral'],
    cancelado:['Cancelado','neutral'],
  } : {
    nao_conferido:['Pagamento não conferido','attention'],
    pendente:['Pagamento pendente','attention'],
    parcial:['Recebimento parcial','attention'],
    pago_manual:['Pago · conferido manualmente','positive'],
    cancelado:['Cancelado','neutral'],
  }
  return map[record.status]||[record.status||'Sem classificação','neutral']
}
function normalizedEntries(payload) {
  const slotById = new Map((payload.horarios||[]).map(slot=>[slot.id,slot]))
  const follows = new Map((payload.acompanhamentos||[]).map(f=>[
    (f.pedido_id ? 'online:' + f.pedido_id : 'formulario:' + f.resposta_form_id),f,
  ]))
  const online=(payload.pedidos||[]).map(p=>{
    const people=Array.isArray(p.participantes)?p.participantes:[]
    const entry={
      source:'online',id:p.id,label:'#'+p.numero,
      name:p.responsavel_nome,whatsapp:p.responsavel_whatsapp,email:p.responsavel_email,
      people, dancer:people.map(x=>x.nome).join(', '),package:people.map(x=>x.pacote).join(' / '),
      value:Number(p.valor_total_centavos)||0,
      paidValue:Number(p.valor_pago_centavos)||0,
      paymentMethod:p.metodo_pagamento||'',preferred:'',
      status:p.status,when:p.criado_em,reference:'Pagamento automático conforme provedor',
      archived:!!p.arquivado_em, archivedAt:p.arquivado_em||null,
      questionAnswers:p.formulario_respostas||{},
      questionSnapshot:p.formulario_modelo_snapshot||{},
    }
    entry.follow=follows.get('online:'+p.id)||null
    return entry
  })
  const forms=(payload.respostas||[]).map(p=>{
    const slot=slotById.get(p.horario_id)
    const day=String(slot?.dia||'').slice(0,10)
    const start=String(slot?.inicio||'').slice(0,5)
    const participants=Array.isArray(p.alunos_inscritos)&&p.alunos_inscritos.length?
      p.alunos_inscritos.length:1
    const duration=Number(slot?.duracao_minutos)||15
    const startMinutes= /^\d{2}:\d{2}$/.test(start)?
      Number(start.slice(0,2))*60+Number(start.slice(3,5)):null
    const endMinutes=startMinutes===null?null:startMinutes+duration*participants
    const finish=endMinutes!==null&&endMinutes<=1440?
      String(Math.floor(endMinutes/60)).padStart(2,'0')+':'+
      String(endMinutes%60).padStart(2,'0'):null
    const scheduledAt=/^\d{4}-\d{2}-\d{2}$/.test(day)&&finish?
      day.slice(8)+'/'+day.slice(5,7)+'/'+day.slice(0,4)+' · '+start+'–'+finish:null
    const entry={
      source:'formulario',id:p.id,
      label:p.origem==='formulario_site'?(payload.campanha?.nome||'Formulário')+' · inscrição '+p.origem_linha:'Google Forms · linha '+p.origem_linha,
      name:p.responsavel_nome,whatsapp:p.responsavel_whatsapp,email:p.email_responsavel||'',
      slotId:p.horario_id||null,scheduleStatus:p.agendamento_status||null,
      scheduledAt,
      declaredPayment:p.pagamento_declarado||null,
      studentsCount:Array.isArray(p.alunos_inscritos)?p.alunos_inscritos.length:0,
      scheduleExpiry:p.agendamento_expira_em||null,
      people:[{nome:p.bailarina_nome,turma:p.modalidade_original,pacote:p.experiencia_original}],
      dancer:p.bailarina_nome,package:p.experiencia_original,
      value:p.valor_informado_centavos==null?null:Number(p.valor_informado_centavos),
      paidValue:Number(p.valor_recebido_centavos)||0,
      paymentMethod:p.pagamento_metodo||'',
      preferred:p.pagamento_preferido||'',status:p.pagamento_situacao,
      when:p.respondido_em||p.criado_em,reference:p.pagamento_referencia||'',
      sourceNote:p.observacao_origem||'',paymentNote:p.pagamento_observacao||'',
      paymentChecked:p.pagamento_conferido_em||null,
      archived:!!p.arquivado_em, archivedAt:p.arquivado_em||null,
    }
    entry.follow=follows.get('formulario:'+p.id)||null
    return entry
  })
  return [...online,...forms]
}
function hasContact(record) {
  const follow=record.follow||{}
  return !!follow.ultimo_contato_em || ['aguardando_resposta','concluido','nao_precisa'].includes(follow.situacao)
}
function isNewRecord(record) {return !record.archived && !paid(record) && !hasContact(record)}
function crmDisplay(record) {
  if(record.archived)return ['Arquivado','neutral','arquivado']
  if(paid(record))return ['Pago','positive','pago']
  if(needsFollow(record))return ['Precisa de retorno','attention','atencao']
  if(hasContact(record))return ['Já contatado','contact','contatado']
  return [record.source==='online'?'Novo cadastro':'Sem contato registrado','new','novo']
}
// Projeção por transação. Um valor parcelado pode ter juros adicionais
// repassados ao pagador, mas aqui só se deduz a taxa de 1x assumida pela GF.
// Não confundir com extrato líquido conciliado / taxas reais de cada plano.
function isProjectedCredit(record) {
  const raw=escapeSearch(record.paymentMethod||record.preferred||'')
  if(/pix|dinheiro|debito|débito/.test(raw))return false
  if(/cartao|credito|visa|master|elo|amex/.test(raw))return true
  return record.source==='online' && !raw // hipótese informada ao administrador
}
function estimatedCharge(amount,record){
  const cents=Math.max(0,Math.round(Number(amount)||0))
  return isProjectedCredit(record)?processingFeeCents(cents,centralState.feeBps):0
}
function estimatedNet(amount,record){
  const cents=Math.max(0,Math.round(Number(amount)||0))
  return isProjectedCredit(record)?projectedNetCents(cents,centralState.feeBps):cents
}
function isForecastEligible(record){
  return !record.archived && !['cancelado','expirado','reembolsado'].includes(record.status)
}
function financeRateLabel(){
  return (centralState.feeBps/100).toFixed(2).replace('.',',')+'%'
}
function metric(label,value,caption,tone) {
  const card=dom('article','gf-metric')
  if (tone) card.dataset.tone=tone
  card.append(dom('span','gf-metric-label',label),dom('strong','gf-metric-value',value),dom('p','gf-metric-caption',caption))
  return card
}
// A comissão da Gente que Dança só considera crianças de pedidos integralmente
// pagos e conferidos. Não conta Pix declarado, interesse, pagamento parcial,
// nem transação cancelada ou reembolsada. >35 exige acordo escrito.
function updateGenteCommission(records){
 const root=document.getElementById('gf-gente-comissao')
 if(!root)return
 const slug=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'')
 root.hidden=slug!=='gente-que-danca-2026'
 if(root.hidden)return
 const {children:confirmed,gross,percent:tier,payout}=calculateGenteCommission(records)
 const children=root.querySelector('[data-gente-children]')
 const revenue=root.querySelector('[data-gente-revenue]')
 const percent=root.querySelector('[data-gente-rate]')
 const commission=root.querySelector('[data-gente-payout]')
 const caveat=root.querySelector('[data-gente-caveat]')
 if(children)children.textContent=String(confirmed)
 if(revenue)revenue.textContent=brl(gross)
 if(percent)percent.textContent=tier===null?'A definir':tier+'%'
 if(commission)commission.textContent=payout===null?'Conforme acordo escrito':brl(payout)
 if(caveat)caveat.textContent=confirmed>35
  ?'Mais de 35 crianças: o contrato exige novo acordo escrito sobre a comissão. Nenhum repasse foi calculado automaticamente.'
  :'Faixa calculada sobre crianças com pedidos integralmente pagos e conferidos. Reembolsos e pagamentos parciais não são contabilizados automaticamente. Estimativa; nenhum repasse foi realizado.'
}

function financialSourceRows(){
  // Um pedido = uma linha. Usa os MESMOS registros de "central_listar"
  // que alimentam a planilha, sem tabela-espelho nem lançamento duplicado.
  return centralState.data.filter(r=>!r.archived||confirmedMoney(r)>0)
}
function paidAwaitingSchedule(record){
 return record.source==='formulario'&&!record.archived&&!!record.slotId&&
  record.scheduleStatus==='solicitado'&&record.value>0&&
  paid(record)&&confirmedMoney(record)>=record.value
}
function syncFinancialRowVisible(record,mode){
 if(mode==='recebidos')return confirmedMoney(record)>0
 if(mode==='pendentes')return !record.archived&&pendingMoney(record)>0
 if(mode==='conferir')return !record.archived&&needsReview(record)
 if(mode==='horarios')return paidAwaitingSchedule(record)
 return true
}
function renderFinanceLedger(){
 if(!financeRows)return
 const entries=financialSourceRows()
 const mode=financeFilter?.value||'todos'
 const visible=entries.filter(record=>syncFinancialRowVisible(record,mode))
 visible.sort((a,b)=>{
  const at=Date.parse(a.when||'')||0,bt=Date.parse(b.when||'')||0
  return bt-at
 })
 financeRows.replaceChildren()
 financeCount.textContent=visible.length+' de '+entries.length+' registro(s) · '+
  entries.filter(paidAwaitingSchedule).length+' horário(s) pago(s) a confirmar'
 if(!visible.length){
  const tr=dom('tr'),td=dom('td','gf-finance-sync-empty','Nenhum registro corresponde a este filtro.')
  td.colSpan=8;tr.append(td);financeRows.append(tr);return
 }
 const fragment=document.createDocumentFragment()
 for(const r of visible){
  const tr=dom('tr')
  if(r.archived)tr.classList.add('gf-finance-sync-archived')
  const person=dom('td')
  person.append(dom('strong','gf-finance-sync-person',r.name||'Sem responsável'),
    dom('span','gf-finance-sync-secondary',
      [r.source==='online'?'Pedido da galeria':'Formulário',r.dancer||r.package||'']
       .filter(Boolean).join(' · ')))
  if(r.archived)person.append(dom('span','gf-finance-sync-muted','Histórico arquivado'))
  const when=dom('td','gf-finance-sync-when',r.scheduledAt||'Sem horário selecionado')
  const expected=dom('td','gf-finance-sync-money',r.value==null?'A conferir':brl(r.value))
  const received=dom('td','gf-finance-sync-money',brl(confirmedMoney(r)))
  const due=dom('td','gf-finance-sync-money',
    brl(!r.archived&&isForecastEligible(r)?pendingMoney(r):0))
  const moneyStatus=dom('td')
  const [paymentText,paymentTone]=statusDisplay(r)
  const paymentPill=tag(paymentText,paymentTone)
  paymentPill.classList.add('gf-finance-sync-pill')
  moneyStatus.append(paymentPill)
  const schedule=dom('td')
  const scheduleText=!r.slotId?'Sem reserva':r.scheduleStatus==='confirmado'?'Confirmado':
    r.scheduleStatus==='solicitado'?'Solicitado':
    r.scheduleStatus==='cancelado'?'Cancelado':'A conferir'
  const schedulePill=tag(scheduleText,r.scheduleStatus==='confirmado'?'positive':
    paidAwaitingSchedule(r)?'attention':'neutral')
  schedulePill.classList.add('gf-finance-sync-pill')
  schedule.append(schedulePill)
  if(paidAwaitingSchedule(r))schedule.append(dom('small','gf-finance-sync-warning',
    'Pagamento conferido · confirmar horário'))
  const action=dom('td')
  if(r.source==='formulario'){
   const link=dom('a','gf-finance-sync-action','Abrir na planilha ↗')
   link.href='/contratar/planilha/?campanha='+encodeURIComponent(financeScope())+
    (r.archived?'&situacao=arquivados':'')+'&editar='+encodeURIComponent(r.id)
   link.target='_blank';link.rel='noopener noreferrer'
   action.append(link)
  }else{
   const button=dom('button','gf-finance-sync-action','Ver pedido')
   button.type='button'
   button.addEventListener('click',()=>{
    window.gfOpenAdminWorkspace?.('respostas',true)
    selectRecord(r)
   })
   action.append(button)
  }
  tr.append(person,when,expected,received,due,moneyStatus,schedule,action)
  fragment.append(tr)
 }
 financeRows.append(fragment)
}

function updateMetrics() {
  const entries=centralState.data.filter(r=>!r.archived||paid(r))
  const future=entries.filter(isForecastEligible)
  const grossFuture=future.reduce((sum,r)=>sum+(r.value||0),0)
  const feeFuture=future.reduce((sum,r)=>sum+estimatedCharge(r.value||0,r),0)
  const netFuture=grossFuture-feeFuture
  const grossConfirmed=entries.reduce((sum,r)=>sum+confirmedMoney(r),0)
  const feeConfirmed=entries.reduce((sum,r)=>sum+estimatedCharge(confirmedMoney(r),r),0)
  const netConfirmed=grossConfirmed-feeConfirmed
  const pendingNet=future.reduce((sum,r)=>sum+estimatedNet(pendingMoney(r),r),0)
  const pendingGross=future.reduce((sum,r)=>sum+pendingMoney(r),0)
  updateGenteCommission(entries)
  centralMetrics.replaceChildren(
    metric('Recebido confirmado',brl(grossConfirmed),'Dinheiro conferido pela equipe ou pelo provedor','positive'),
    metric('Ainda a receber',brl(pendingGross),'Saldo dos pedidos com pagamento pendente','attention'),
    metric('Total de pedidos ativos',brl(grossFuture),'Soma contratada · inclui valores não recebidos'),
    metric('Líquido recebido estimado',brl(netConfirmed),'Recebido menos taxas simuladas','positive'),
    metric('Taxas estimadas sobre pedidos',brl(feeFuture),'Hipótese de cartão à vista '+financeRateLabel(),'attention'),
    metric('Líquido previsto dos pedidos',brl(netFuture),'Projeção, não saldo bancário'),
    metric('Líquido ainda pendente',brl(pendingNet),'Projeção após taxas do saldo a receber'),
    metric('Cadastros ativos',String(entries.filter(r=>!r.archived).length),'Famílias e pedidos ativos'),
    metric('Pagamentos a conferir',String(entries.filter(needsReview).length),'Ainda não são dinheiro confirmado','attention'),
  )
  renderFinanceLedger()
}
function updateViewCounters() {
  const active=centralState.data.filter(r=>!r.archived)
  const counters={
    todos:active.length,
    novos:active.filter(isNewRecord).length,
    contatados:active.filter(hasContact).length,
    conferir:active.filter(needsReview).length,
    follow:active.filter(needsFollow).length,
    pendentes:active.filter(openPending).length,
    pagos:active.filter(paid).length,
    arquivados:centralState.data.filter(r=>r.archived).length,
  }
  for(const [name,n] of Object.entries(counters)) {
    const el=document.getElementById('gf-count-'+name)
    if(el)el.textContent='('+n+')'
  }
}
function viewMatch(r) {
  if(centralState.view==='arquivados')return r.archived
  if(r.archived)return false
  switch(centralState.view){
    case 'novos':return isNewRecord(r)
    case 'contatados':return hasContact(r)
    case 'conferir':return needsReview(r)
    case 'follow':return needsFollow(r)
    case 'pendentes':return openPending(r)
    case 'pagos':return paid(r)
    default:return true
  }
}
function visibleRecords() {
  const term=escapeSearch(centralSearch.value.trim())
  const source=centralOrigin.value
  const order=centralSort.value
  const list=centralState.data.filter(r=>{
    if(!viewMatch(r)||source!=='todas'&&source!==r.source)return false
    if(!term)return true
    return escapeSearch([r.name,r.dancer,r.whatsapp,r.package,r.label,r.email,r.follow?.observacoes].join(' ')).includes(term)
  })
  return list.sort((a,b)=>{
    if(order==='valor')return (b.value||0)-(a.value||0)
    if(order==='follow')return (a.follow?.proximo_contato_em||'9999').localeCompare(b.follow?.proximo_contato_em||'9999')
    const at=new Date(a.when||0).getTime()||0
    const bt=new Date(b.when||0).getTime()||0
    return order==='antigos'?at-bt:bt-at
  })
}
function renderRecord(record) {
  const card=dom('button','gf-result-card')
  card.type='button'
  const [crmLabel,crmTone,crmKind]=crmDisplay(record)
  card.dataset.crm=crmKind
  card.dataset.selected=String(centralState.selected===record.source+':'+record.id)
  card.setAttribute('aria-label','Abrir ficha de '+record.name+', '+crmLabel)
  const header=dom('div','gf-record-head')
  header.append(dom('strong','gf-record-name',record.name))
  const badges=dom('div','gf-record-meta')
  badges.append(tag(crmLabel,crmTone))
  if(needsReview(record)&&!record.archived&&!paid(record))badges.append(tag('Pagamento a conferir','attention'))
  card.append(header,dom('div','gf-record-sub',record.dancer||'Participantes não informados'))
  if(record.package)card.append(dom('div','gf-record-sub gf-record-package',record.package))
  card.append(badges)
  const bottom=dom('div','gf-record-bottom')
  const valueText=record.value==null?'Valor a conferir':brl(estimatedNet(record.value,record))
  bottom.append(dom('strong','gf-record-value',valueText),
    dom('span','gf-record-sub',record.value==null?'Aguardando valor':
      'líquido est. · bruto '+brl(record.value)))
  card.append(bottom)
  card.addEventListener('click',()=>selectRecord(record))
  return card
}
function renderList() {
  updateViewCounters()
  const list=visibleRecords()
  centralResultCount.textContent=list.length+' registro(s) encontrados'
  centralList.replaceChildren()
  centralList.dataset.layout=centralState.layout
  if(!list.length) {
    centralList.append(dom('div','gf-empty','Nenhum registro corresponde aos filtros. Tente outra busca ou veja a opção “Todos”.'))
  } else {
    const fragment=document.createDocumentFragment()
    list.forEach(r=>fragment.append(renderRecord(r)))
    centralList.append(fragment)
  }
}
function phoneLink(phone) {
  let digits=String(phone||'').replace(/\D/g,'')
  if(!digits)return null
  if(digits.length===10||digits.length===11)digits='55'+digits
  if(digits.length<12||digits.length>13||!digits.startsWith('55'))return null
  return 'https://wa.me/'+digits+'?text='+encodeURIComponent('Olá! Aqui é da Grand Focus Fotografia. Podemos conversar sobre seu pedido de fotos?')
}
function detailBox(label,value) {
  const box=dom('div','gf-detail-box')
  box.append(dom('small','',label),dom('strong','',value||'Não informado'))
  return box
}
function labeledInput(label,type,value) {
  const wrap=dom('label','')
  wrap.append(document.createTextNode(label))
  const input=dom(type==='select'?'select':type==='textarea'?'textarea':'input')
  if(type!=='select'&&type!=='textarea')input.type=type
  if(value!=null)input.value=String(value)
  wrap.append(input)
  return {wrap,input}
}
function addChoice(select,value,text) {
  const opt=dom('option','',text);opt.value=value;select.append(opt)
}
function actionButton(label,className) {
  const button=dom('button',className||'btn btn-secondary',label);button.type='button';return button
}
function closeRecord() {
  if(centralDialog.open)centralDialog.close()
  centralState.selected=null
  centralState.section=null
  renderList()
}
function detailAccordion(title,form,key){
  const wrap=dom('details','gf-detail-accordion')
  wrap.dataset.accordion=key
  const summary=dom('summary','',title+'  ⌄')
  wrap.append(summary,form)
  if(centralState.section===key)wrap.open=true
  wrap.addEventListener('toggle',()=>{
    if(wrap.open)centralState.section=key
    else if(centralState.section===key)centralState.section=null
  })
  return wrap
}
function canArchive(record){
  if(record.archived)return true
  if(paid(record)||confirmedMoney(record)>0)return false
  if(record.source==='online')return ['aguardando_pagamento','pagamento_pendente','expirado','cancelado'].includes(record.status)
  return ['nao_conferido','pendente','cancelado'].includes(record.status)
}
function addArchiveControls(record){
  const bar=dom('div','gf-archive-bar')
  const description=dom('p','','Registros de teste podem sair da lista sem destruir o histórico. Você poderá recuperá-los em “Arquivados”. Pagamentos confirmados não podem ser arquivados.')
  bar.append(description)
  if(!canArchive(record)){
    bar.append(dom('span','gf-small-note','Registro financeiro protegido'))
    return bar
  }
  const button=actionButton(record.archived?'Restaurar cadastro':'Arquivar cadastro')
  button.addEventListener('click',async()=>{
    const willArchive=!record.archived
    if(!window.confirm(willArchive
      ?'Arquivar o cadastro de '+record.name+'? Ele sairá dos indicadores e da lista principal. Nenhum dado será apagado, e o arquivamento não cancela links externos de pagamento.'
      :'Restaurar o cadastro de '+record.name+' para a lista principal?'))return
    button.disabled=true
    try{
      await apiCentral('central_arquivar',{origem:record.source,referencia_id:record.id,arquivar:willArchive})
      closeRecord()
      notice(willArchive?'Cadastro arquivado. Você pode restaurá-lo em “Arquivados”.':'Cadastro restaurado para a lista ativa.','success')
      await loadCentral(false,true)
    }catch(error){
      notice(error.message||'Não foi possível atualizar o cadastro.','error')
    }finally{button.disabled=false}
  })
  bar.append(button)
  return bar
}
function openDetailSection(name){
  const box=centralDetail.querySelector('[data-accordion="'+name+'"]')
  if(!box)return
  box.open=true;centralState.section=name
  box.scrollIntoView({block:'nearest',behavior:'smooth'})
  box.querySelector('select,input,textarea,button')?.focus({preventScroll:true})
}
function natalAppointmentControls(record){
  const block=dom('section','gf-modal-actions gf-natal-actions')
  const isGente=location.pathname.includes('gente-que-danca-2026')
  block.append(dom('strong','gf-modal-section-heading',
    isGente?'Horário reservado · Gente que Dança':'Horário do Especial de Natal'))
  if(isGente){
    const match=String(record.sourceNote||'').match(/Reserva 15\/12\/2026\s+(\d{2}:\d{2}–\d{2}:\d{2})/)
    if(match)block.append(dom('p','gf-detail-fee-note','Ensaio: 15/12, '+match[1]))
  }
  const status=record.scheduleStatus||'solicitado'
  block.append(dom('p','gf-detail-fee-note',
    status==='confirmado'?'Horário confirmado pela Grand Focus.':
    status==='cancelado'?'Solicitação cancelada.':
    status==='expirado'?'O prazo desta solicitação expirou. Confirme somente se a vaga continuar livre.':
    'Solicitação de horário ainda não confirmada. A família aguarda a conferência da equipe.'))
  if(record.archived)return block
  if(status!=='confirmado'&&status!=='cancelado'){
    const row=dom('div','gf-modal-step-actions')
    if(record.status==='pago_manual'&&confirmedMoney(record)>=record.value){
      const confirm=actionButton('✓ Confirmar horário','gf-quick-step')
      confirm.addEventListener('click',async()=>{
        if(!window.confirm('Você já conferiu o pagamento integral? Confirmar este horário da família?'))return
        confirm.disabled=true
        try{
          await apiCentral(location.pathname.includes('gente-que-danca-2026')?'gente_atualizar_agendamento':'natal_atualizar_agendamento',{resposta_id:record.id,status:'confirmado'})
          notice('Horário confirmado após conferência financeira.','success')
          await loadCentral(false,true)
        }catch(error){notice(error.message||'Não foi possível confirmar.','error');confirm.disabled=false}
      })
      row.append(confirm)
    }else{
      block.append(dom('p','gf-neutral-note','Para confirmar, primeiro registre o pagamento integral em “Conferência de pagamento” e salve a comprovação.'))
    }
    if(confirmedMoney(record)===0){
      const cancel=actionButton('Cancelar solicitação','gf-quick-step')
      cancel.addEventListener('click',async()=>{
        if(!window.confirm('Cancelar a solicitação desta família? A vaga ficará disponível novamente.'))return
        cancel.disabled=true
        try{
          await apiCentral(location.pathname.includes('gente-que-danca-2026')?'gente_atualizar_agendamento':'natal_atualizar_agendamento',{resposta_id:record.id,status:'cancelado'})
          notice('Solicitação cancelada e horário liberado.','success')
          await loadCentral(false,true)
        }catch(error){notice(error.message||'Não foi possível cancelar.','error');cancel.disabled=false}
      })
      row.append(cancel)
    }
    block.append(row)
  }
  return block
}
function selectRecord(record) {
  centralState.selected=record.source+':'+record.id
  const lookup=centralState.data.find(r=>r.source+':'+r.id===centralState.selected)
  if(!lookup)return
  centralDetail.replaceChildren()
  const header=dom('div','gf-detail-toolbar')
  const headerMain=dom('div','gf-detail-head-main')
  const personIcon=dom('span','gf-detail-avatar')
  personIcon.setAttribute('aria-hidden','true')
  personIcon.textContent=String(record.name||'?').trim().slice(0,1).toUpperCase()
  const personText=dom('div','gf-detail-person')
  personText.append(dom('span','gf-detail-eyebrow','FICHA DE ATENDIMENTO'),
    dom('h3','gf-detail-title',record.name),
    dom('p','gf-detail-subtitle',record.dancer||'Cadastro'))
  headerMain.append(personIcon,personText)
  const close=actionButton('✕ Fechar')
  close.setAttribute('aria-label','Fechar ficha e voltar à lista')
  close.addEventListener('click',closeRecord)
  header.append(headerMain,close)
  centralDetail.append(header)
  const feedback=dom('p','gf-modal-notice')
  feedback.id='gf-modal-notice';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite')
  // Não repetir no pop-up a mensagem genérica de atualização da lista.
  feedback.hidden=true
  centralDetail.append(feedback)
  const [statusText,statusTone]=statusDisplay(record)
  const flags=dom('div','gf-record-meta gf-modal-status')
  const [crmLabel,crmTone]=crmDisplay(record)
  flags.append(tag(crmLabel,crmTone),tag(statusText,statusTone))
  centralDetail.append(flags)
  const fast=dom('div','gf-modal-step-actions')
  const whats=phoneLink(record.whatsapp)
  if(whats){
    const a=dom('a','gf-quick-step','WhatsApp ↗')
    a.href=whats;a.target='_blank';a.rel='noopener noreferrer'
    fast.append(a)
  }
  if(!hasContact(record)&&!record.archived){
    const contact=actionButton('✓ Registrei contato','gf-quick-step')
    contact.addEventListener('click',async()=>{
      contact.disabled=true
      try{
        await apiCentral('central_salvar_acompanhamento',{
          origem:record.source,referencia_id:record.id,
          situacao:'aguardando_resposta',proximo_contato_em:null,
          observacoes:record.follow?.observacoes||'',registrar_contato:true
        })
        notice('Contato registrado.','success');await loadCentral(false,true)
      }catch(error){notice(error.message,'error');contact.disabled=false}
    })
    fast.append(contact)
  }
  if(record.source==='formulario'&&!record.archived){
    const editLink=dom('a','gf-quick-step','✎ Editar resposta')
    const campaign=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'entre-estacoes')
    editLink.href='/contratar/planilha/?campanha='+encodeURIComponent(campaign)+
      '&editar='+encodeURIComponent(record.id)
    editLink.target='_blank';editLink.rel='noopener noreferrer'
    fast.append(editLink)
  }
  if(record.source==='formulario'&&!paid(record)&&!record.archived){
    const payment=actionButton('R$ Registrar pagamento','gf-quick-step')
    payment.addEventListener('click',()=>{
      openDetailSection('pagamento')
      const editor=centralDetail.querySelector('[data-accordion="pagamento"]')
      const select=editor?.querySelector('select')
      if(select){select.value='pago_manual';select.dispatchEvent(new Event('change',{bubbles:true}))}
    })
    fast.append(payment)
  }
  centralDetail.append(fast)
  const grid=dom('div','gf-detail-grid')
  grid.append(
    detailBox('Bailarina(s)',record.dancer),
    detailBox('Pacote / experiência',record.package),
    detailBox('Valor do pacote (bruto)',record.value==null?'A conferir':brl(record.value)),
    detailBox('Taxa de cartão estimada',brl(estimatedCharge(record.value,record))),
    detailBox('Líquido previsto',record.value==null?'A conferir':brl(estimatedNet(record.value,record))),
    detailBox('Recebido bruto confirmado',brl(confirmedMoney(record))),
    detailBox('Líquido recebido estimado',brl(estimatedNet(confirmedMoney(record),record))),
  )
  // O resumo completo ficará recolhido, sem exigir leitura para atendimento rápido.
  // Valores aprofundados pertencem à aba Financeiro; a ficha abre resumida.
  const financialDetails=dom('details','gf-detail-accordion')
  financialDetails.append(dom('summary','','Ver valores financeiros detalhados'),grid)
  grid.classList.add('gf-detail-summary')
  centralDetail.append(financialDetails)
  const info=dom('details','gf-detail-accordion')
  info.append(dom('summary','','Ver demais informações  ⌄'))
  const extras=dom('div','gf-detail-grid')
  extras.append(
    detailBox('Data de cadastro',safeDate(record.when)),
    detailBox('Meio de pagamento',record.preferred||record.paymentMethod||'Não informado'),
  )
  if(record.source==='formulario'&&record.sourceNote)extras.append(detailBox('Observação do formulário',record.sourceNote))
  if(record.slotId){
    const statuses={solicitado:'Aguardando confirmação',confirmado:'Horário confirmado',cancelado:'Solicitação cancelada',expirado:'Prazo expirado'}
    extras.append(detailBox('Situação do horário',statuses[record.scheduleStatus]||'Solicitação pendente'))
    if(record.scheduleExpiry&&record.scheduleStatus==='solicitado')
      extras.append(detailBox(location.pathname.includes('gente-que-danca-2026')?'Vaga mantida até o evento':'Prazo para conferência',safeDate(record.scheduleExpiry)))
    extras.append(detailBox('Pagamento informado na inscrição',
      record.declaredPayment==='ja_paguei'?'Família declarou que já pagou · conferir':record.declaredPayment==='a_pagar'?'Família ainda não pagou':'Preferência informada; pagamento a conferir'))
  }
  if(record.paymentChecked)extras.append(detailBox('Pagamento conferido em',safeDate(record.paymentChecked)))
  if(record.reference)extras.append(detailBox('Referência',record.reference))
  if(record.email)extras.append(detailBox('E-mail',record.email))
  if(record.whatsapp)extras.append(detailBox('WhatsApp',record.whatsapp))
  info.append(extras);centralDetail.append(info)
  if(record.source==='online' && record.questionSnapshot?.modelo?.perguntas?.length){
    const block=dom('details','gf-detail-accordion')
    block.append(dom('summary','','Respostas adicionais do formulário  ⌄'))
    const answers=dom('div','gf-detail-grid')
    for(const question of record.questionSnapshot.modelo.perguntas){
      const answer=record.questionAnswers?.[question.id]
      answers.append(detailBox(question.titulo,Array.isArray(answer)?answer.join(' • '):String(answer||'Não respondida')))
    }
    block.append(answers);centralDetail.append(block)
  }
  const quickActions=dom('section','gf-modal-actions')
  quickActions.append(dom('strong','gf-modal-section-heading','Próximo passo'))
  const actions=dom('div','gf-modal-action-buttons')
  const phone=phoneLink(record.whatsapp)
  if(phone){
    const link=dom('a','gf-whatsapp-action')
    link.href=phone;link.target='_blank';link.rel='noopener noreferrer'
    const whatsappIcon=dom('span','gf-whatsapp-mark')
    whatsappIcon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.6A8.5 8.5 0 0 1 8 19.1L3.2 20.8l1.7-4.7A8.5 8.5 0 1 1 20.5 11.6Z"/><path d="M8.5 8.7c.2 3 3.1 5.8 6 6 .7.1 1.5-.8 1.6-1.3l-2-1.1-1.1 1.1a7 7 0 0 1-2.6-2.5l1-1.1-1.2-2.1c-.8-.2-1.6.2-1.7 1Z"/></svg>'
    link.append(whatsappIcon,dom('span','','Enviar mensagem no WhatsApp'),dom('span','gf-action-arrow','↗'))
    actions.append(link)
    const copy=actionButton('Copiar número','gf-copy-phone')
    copy.addEventListener('click',async()=>{
      try{
        const digits=String(record.whatsapp||'').replace(/\D/g,'')
        await navigator.clipboard.writeText(digits)
        copy.textContent='Número copiado ✓'
      }catch(error){
        copy.textContent='Não foi possível copiar'
        notice('Não foi possível copiar o telefone.','error')
      }
    })
    actions.append(copy)
  }else actions.append(dom('span','gf-no-phone','Telefone indisponível'))
  quickActions.append(actions)

  centralDetail.append(quickActions)
  if(!record.archived){
    centralDetail.append(detailAccordion('Acompanhamento e contato',makeFollowEditor(record),'contato'))
    if(record.source==='formulario'){
      centralDetail.append(detailAccordion('Conferência de pagamento',makePaymentEditor(record),'pagamento'))
    }else{
      const box=dom('details','gf-detail-accordion')
      box.dataset.accordion='pagamento'
      box.append(dom('summary','','Pagamento pela InfinitePay  ⌄'),
        dom('p','gf-small-note','Pagamentos online são confirmados apenas pela InfinitePay; esta central não marca pedidos automaticamente como pagos.'))
      if(['pagamento_pendente','conciliacao_pendente'].includes(record.status)){
        const reconcile=actionButton('Consultar pagamento na InfinitePay')
        reconcile.addEventListener('click',async()=>{
          reconcile.disabled=true
          try{await apiCentral('reconciliar',{pedido_id:record.id});notice('Consulta concluída. Confira o status atualizado.','success');await loadCentral(false,true)}
          catch(error){notice(error.message||'Erro na consulta.','error')}
          finally{reconcile.disabled=false}
        })
        box.append(reconcile)
      }
      centralDetail.append(box)
    }
  }else {
    centralDetail.append(dom('p','gf-small-note','Cadastro arquivado. Para voltar a editar ou registrar contato, restaure primeiro.'))
  }
  if(record.slotId)centralDetail.append(natalAppointmentControls(record))
  centralDetail.append(addArchiveControls(record))
  if(!centralDialog.open)centralDialog.showModal()
  centralDetail.scrollTop=0
  const title=centralDetail.querySelector('.gf-detail-title')
  if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
}
function makeFollowEditor(record) {
  const follow=record.follow||{}
  const form=dom('form','gf-editor')
  form.append(dom('h3','','Acompanhamento e follow-up'),
    dom('p','gf-editor-description','Organize os próximos contatos sem precisar de uma planilha. Nada é enviado automaticamente ao responsável.'))
  const grid=dom('div','gf-editor-grid')
  const status=labeledInput('Situação do atendimento','select')
  for(const [v,text] of [
    ['nao_iniciado','Ainda não comecei'],
    ['contatar','Preciso entrar em contato'],
    ['aguardando_resposta','Aguardando resposta da família'],
    ['concluido','Atendimento concluído'],
    ['nao_precisa','Não precisa de contato'],
  ])addChoice(status.input,v,text)
  status.input.value=follow.situacao||'nao_iniciado'
  const next=labeledInput('Próximo contato (opcional)','date',follow.proximo_contato_em||'')
  const notes=labeledInput('Anotações do atendimento','textarea',follow.observacoes||'')
  notes.wrap.classList.add('gf-full');notes.input.maxLength=3000
  notes.input.placeholder='Ex.: Enviar mensagem amanhã para conferir o pagamento.'
  const contact=dom('label','gf-check-row')
  const contactInput=dom('input');contactInput.type='checkbox'
  contact.append(contactInput,document.createTextNode('Registrar que entrei em contato com esta família agora'))
  contact.classList.add('gf-full')
  grid.append(status.wrap,next.wrap,notes.wrap,contact)
  form.append(grid)
  if(follow.ultimo_contato_em)form.append(dom('p','gf-small-note','Último contato registrado: '+safeDate(follow.ultimo_contato_em)))
  const save=actionButton('Salvar acompanhamento','btn btn-primary');save.type='submit'
  const controls=dom('div','gf-form-actions');controls.append(save);form.append(controls)
  form.addEventListener('submit',async e=>{
    e.preventDefault();save.disabled=true
    try {
      await apiCentral('central_salvar_acompanhamento',{
        origem:record.source,referencia_id:record.id,situacao:status.input.value,
        proximo_contato_em:next.input.value||null,observacoes:notes.input.value,
        registrar_contato:contactInput.checked,
      })
      notice('Acompanhamento salvo. Próximo contato e observações atualizados.','success')
      await loadCentral(false, true)
    }catch(error){notice(error.message||'Não foi possível salvar.','error')}
    finally{save.disabled=false}
  })
  return form
}
function inputCents(value) {
  const string=String(value||'').trim()
  if(!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(string))return NaN
  return Math.round(Number(string.replace(',','.'))*100)
}
function makePaymentEditor(record) {
  const form=dom('form','gf-editor')
  form.append(dom('h3','','Pagamento'),
    dom('p','gf-editor-description',
      'Marque como pago apenas depois de conferir o recebimento no Pix, cartão ou extrato.'))
  const grid=dom('div','gf-editor-grid')
  const status=labeledInput('Situação financeira','select')
  for(const [v,text] of [
    ['nao_conferido','Ainda não conferi'],
    ['pendente','Conferi: pagamento pendente'],
    ['parcial','Recebi parte do valor'],
    ['pago_manual','Pago — conferido manualmente'],
    ['cancelado','Cancelado / não contratado'],
  ])addChoice(status.input,v,text)
  status.input.value=record.status
  const value=labeledInput('Valor recebido (R$)','text',((record.paidValue||record.value||0)/100).toFixed(2).replace('.',','))
  value.input.inputMode='decimal';value.input.placeholder='0,00'
  const method=labeledInput('Meio de pagamento','select')
  for(const [v,text] of [
    ['','Selecione'],['pix','Pix'],['credito','Crédito'],['dinheiro','Dinheiro'],['outro','Outro'],
  ])addChoice(method.input,v,text)
  method.input.value=record.paymentMethod||(/pix/i.test(record.preferred||'')?'pix':/cart|cr.dito/i.test(record.preferred||'')?'credito':'')
  const reference=labeledInput('Referência para auditoria','text',record.reference||'Conferência manual em '+new Date().toLocaleString('pt-BR'))
  reference.input.maxLength=180;reference.input.placeholder='Ex.: ID no extrato ou referência do comprovante'
  const notes=labeledInput('Observação da conferência','textarea',record.paymentNote||'')
  notes.wrap.classList.add('gf-full');notes.input.maxLength=1200
  notes.wrap.hidden=true
  notes.input.placeholder='Ex.: Identifiquei o Pix no extrato de 08/11.'
  const confirm=dom('label','gf-check-row')
  const checked=dom('input');checked.type='checkbox'
  confirm.append(checked,document.createTextNode('Eu conferi o recebimento fora deste formulário e confirmo a informação acima.'))
  confirm.classList.add('gf-full')
  grid.append(status.wrap,value.wrap,method.wrap,reference.wrap,confirm)
  const refreshInputs=()=>{
    const confirming=['parcial','pago_manual'].includes(status.input.value)
    method.wrap.hidden=!confirming
    reference.wrap.hidden=!confirming
    confirm.hidden=!confirming
    value.wrap.hidden=!confirming
    if(!confirming)value.input.value='0,00'
    else if(!record.paidValue&&record.value)value.input.value=(record.value/100).toFixed(2).replace('.',',')
  }
  status.input.addEventListener('change',refreshInputs)
  refreshInputs()
  form.append(grid)
  const save=actionButton('Salvar conferência','btn btn-primary');save.type='submit'
  const controls=dom('div','gf-form-actions');controls.append(save);form.append(controls)
  form.addEventListener('submit',async e=>{
    e.preventDefault()
    const verifying=['parcial','pago_manual'].includes(status.input.value)
    const cents=verifying?inputCents(value.input.value):0
    if(!Number.isSafeInteger(cents)||cents<0){notice('Informe o valor recebido corretamente. Ex.: 159,00.','error');value.input.focus();return}
    if(verifying&&(!checked.checked||!method.input.value||reference.input.value.trim().length<5)){
      notice('Para registrar recebimento, confira o comprovante, informe o meio e uma referência e marque a confirmação.','error')
      return
    }
    if(verifying&&!window.confirm('Você já verificou que este dinheiro realmente entrou na conta? Registrar como recebido manualmente?'))return
    save.disabled=true
    try{
      await apiCentral('central_registrar_pagamento',{
        resposta_id:record.id,situacao:status.input.value,
        valor_recebido_centavos:cents,metodo:method.input.value,
        referencia:reference.input.value.trim(),observacao:notes.input.value.trim(),
        conferencia_confirmada:checked.checked,
      })
      notice('Conferência registrada com histórico de auditoria.','success')
      await loadCentral(false, true)
    }catch(error){notice(error.message||'Não foi possível registrar o pagamento.','error')}
    finally{save.disabled=false}
  })
  return form
}
async function loadCentral(initial, preserveNotice = false) {
  if(centralState.loading)return
  centralState.loading=true
  const refresh=document.getElementById('gf-central-refresh')
  refresh.disabled=true
  try {
    const payload=await apiCentral('central_listar')
    const next=normalizedEntries(payload)
    if(centralState.ready){
      const fresh=next.filter(r=>!r.archived&&!centralState.previousIds.has(r.source+':'+r.id))
      if(fresh.length){
        const badge=document.getElementById('gf-live-count')
        if(badge)badge.textContent='+'+fresh.length+' novo(s)'
        notice('● '+fresh.length+' nova(s) resposta(s) chegaram! Confira a lista.','success')
      }
    }
    centralState.data=next
    centralState.previousIds=new Set(next.map(r=>r.source+':'+r.id))
    const rate=Number(payload.campanha?.taxa_credito_a_vista_bps)
    if(Number.isSafeInteger(rate)&&rate>=0&&rate<=2000)centralState.feeBps=rate
    document.getElementById('gf-fee-rate').value=(centralState.feeBps/100).toFixed(2)
    centralState.ready=true
    updateMetrics()
    financeStatus.textContent='Sincronizado com a planilha às '+
      new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'})+
      ' · mesma base de contratos e pagamentos'
    financeStatus.dataset.state='success'
    renderList()
    if (!preserveNotice && !document.getElementById('gf-live-count')?.textContent) notice('Atualizado: '+centralState.data.filter(r=>!r.archived).length+' cadastros ativos.','success')
    if(payload.resultados_possivelmente_truncados)notice('A consulta atingiu o limite de 1.000 registros por origem. Consulte a exportação completa antes de tomar decisões financeiras.','error')
    if(centralState.selected) {
      const selected=centralState.data.find(r=>r.source+':'+r.id===centralState.selected)
      if(selected)selectRecord(selected)
      else{centralState.selected=null;if(centralDialog.open)centralDialog.close()}
    }
  }catch(error) {
    notice(error.message||'Não foi possível carregar os registros.','error')
    financeStatus.textContent='Não foi possível sincronizar o financeiro: '+
      (error.message||'Erro de conexão')+'. Os valores anteriores podem estar desatualizados.'
    financeStatus.dataset.state='error'
    if(initial){centralMetrics.replaceChildren();centralList.replaceChildren(dom('p','gf-empty','Verifique sua conexão ou entre novamente como administrador.'))}
  }finally {centralState.loading=false;refresh.disabled=false}
}
function csvSafe(value) {
  let text=String(value??'')
  if(/^[\s]*[=+@\-]/.test(text))text="'"+text
  return '"'+text.replace(/"/g,'""')+'"'
}
function exportCsv() {
  if(!centralState.ready){notice('Carregue a central antes de exportar.','error');return}
  const cols=['Origem','Identificador','Data da resposta','Responsável','WhatsApp','E-mail','Bailarinas','Experiência','Valor informado bruto (R$)','Taxa de referência (%)','Tarifa prevista (R$)','Total líquido previsto (R$)','Valor bruto recebido confirmado (R$)','Líquido recebido estimado (R$)','Situação financeira','Preferência de pagamento','Meio confirmado','Referência','Follow-up','Próximo contato','Último contato','Observações','Respostas adicionais (pergunta: resposta)']
  const lines=[cols]
  for(const r of visibleRecords())lines.push([
    r.source==='formulario'?'Google Forms':'Galeria',r.label,safeDate(r.when),
    r.name,r.whatsapp,r.email,r.dancer,r.package,
    r.value==null?'':(r.value/100).toFixed(2).replace('.',','),
    isProjectedCredit(r)?financeRateLabel():'0%',
    (estimatedCharge(r.value,r)/100).toFixed(2).replace('.',','),
    r.value==null?'':(estimatedNet(r.value,r)/100).toFixed(2).replace('.',','),
    (confirmedMoney(r)/100).toFixed(2).replace('.',','),
    (estimatedNet(confirmedMoney(r),r)/100).toFixed(2).replace('.',','),
    statusDisplay(r)[0],r.preferred,r.paymentMethod,r.reference,
    r.follow?.situacao||'nao_iniciado',r.follow?.proximo_contato_em||'',
    r.follow?.ultimo_contato_em?safeDate(r.follow.ultimo_contato_em):'',r.follow?.observacoes||'',
    (r.questionSnapshot?.modelo?.perguntas||[]).map(q=>{
      const a=r.questionAnswers?.[q.id]
      return q.titulo+': '+(Array.isArray(a)?a.join(' / '):String(a||'Não respondida'))
    }).join(' | '),
  ])
  const csv='\uFEFF'+lines.map(row=>row.map(csvSafe).join(';')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const link=dom('a');link.href=url;link.download='Grand_Focus_Central_Respostas_'+new Date().toISOString().slice(0,10)+'.csv'
  document.body.append(link);link.click();link.remove()
  URL.revokeObjectURL(url)
  notice('Exportação preparada com os '+(lines.length-1)+' registros filtrados.','success')
}
const feeForm=document.getElementById('gf-fee-form')
feeForm.addEventListener('submit',async event=>{
  event.preventDefault()
  const input=document.getElementById('gf-fee-rate')
  const button=document.getElementById('gf-fee-save')
  const output=document.getElementById('gf-fee-message')
  const percent=Number(input.value)
  const bps=Math.round(percent*100)
  if(!Number.isFinite(percent)||percent<0||percent>20||
     Math.abs(bps/100-percent)>0.000001){
    output.textContent='Informe uma porcentagem entre 0,00% e 20,00%, com duas casas decimais.'
    input.focus();return
  }
  button.disabled=true
  try{
    await apiCentral('central_salvar_taxa',{taxa_credito_a_vista_bps:bps})
    centralState.feeBps=bps
    updateMetrics();renderList()
    const selected=centralState.data.find(r=>r.source+':'+r.id===centralState.selected)
    if(selected)selectRecord(selected)
    output.textContent='Taxa salva: '+financeRateLabel()+'. Valores líquidos recalculados nesta campanha.'
    notice('Previsões líquidas atualizadas. Nenhum pagamento foi alterado.','success')
  }catch(error){
    output.textContent=error.message||'Não foi possível salvar a taxa.'
  }finally{button.disabled=false}
})
const metricToggle=document.getElementById('gf-metrics-toggle')
metricToggle.addEventListener('click',()=>{
  const expanded=document.getElementById('gf-financeiro').classList.toggle('gf-metrics-expanded')
  metricToggle.setAttribute('aria-expanded',String(expanded))
  metricToggle.textContent=expanded?'Mostrar menos indicadores  ⌃':'Ver todos os indicadores  ⌄'
})
for(const [buttonId,mode] of [['gf-layout-compact','compact'],['gf-layout-cards','cards']]){
  document.getElementById(buttonId).addEventListener('click',()=>{
    centralState.layout=mode
    document.getElementById('gf-layout-compact').setAttribute('aria-pressed',String(mode==='compact'))
    document.getElementById('gf-layout-cards').setAttribute('aria-pressed',String(mode==='cards'))
    renderList()
  })
}
centralDialog.addEventListener('close',()=>{
  centralState.selected=null;centralState.section=null;renderList()
})
centralDialog.addEventListener('click',event=>{
  if(event.target===centralDialog)closeRecord()
})
document.getElementById('gf-central-refresh').addEventListener('click',()=>loadCentral(false))
document.getElementById('gf-finance-sync-refresh').addEventListener('click',()=>loadCentral(false,true))
financeFilter.addEventListener('change',renderFinanceLedger)
document.getElementById('gf-central-export').addEventListener('click',exportCsv)
for(const button of document.querySelectorAll('#gf-central-tabs [data-view]')){
  button.addEventListener('click',()=>{
    centralState.view=button.dataset.view
    for(const tab of document.querySelectorAll('#gf-central-tabs [data-view]'))
      tab.setAttribute('aria-pressed',String(tab===button))
    renderList()
  })
}
for(const el of [centralSearch,centralOrigin,centralSort])el.addEventListener(el===centralSearch?'input':'change',renderList)
function refreshFinanceOnReturn(){
 if(document.hidden||centralState.loading||!centralState.ready||
  document.getElementById('admin-area')?.classList.contains('hidden'))return
 void loadCentral(false,true)
}
// Além da atualização periódica, sincroniza imediatamente ao abrir o financeiro,
// voltar de outra aba ou receber notificação da planilha do mesmo evento.
window.addEventListener('gf-workspace-page',event=>{
 if(event.detail?.page==='financeiro')refreshFinanceOnReturn()
})
window.addEventListener('focus',()=>{
 if(document.getElementById('gf-financeiro')?.hidden===false)refreshFinanceOnReturn()
})
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&document.getElementById('gf-financeiro')?.hidden===false)
  refreshFinanceOnReturn()
})
if(typeof BroadcastChannel==='function'){
 const financeChannel=new BroadcastChannel('gf-contratacao-sync')
 financeChannel.addEventListener('message',event=>{
  if(event.data?.slug===financeScope())refreshFinanceOnReturn()
 })
}
setInterval(()=>{
 if(document.hidden||centralDialog.open||document.getElementById('admin-area')?.classList.contains('hidden')
   ||centralState.loading||!centralState.ready)return
 void loadCentral(false,true)
},15000)
window.addEventListener('gf-contratacao-admin-ready',()=>loadCentral(true))
if(!document.getElementById('admin-area')?.classList.contains('hidden') && typeof window.gfContratacaoAdminRequest==='function')loadCentral(true)
