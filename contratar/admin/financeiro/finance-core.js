/**
 * Financeiro central Grand Focus — regras puras.
 * Valores sempre em CENTAVOS. Nenhum pagamento é criado ou alterado por este módulo.
 */
export const CANCELED = new Set(['cancelado', 'expirado', 'reembolsado']);
const ONLINE_PENDING = new Set(['aguardando_pagamento', 'pagamento_pendente', 'conciliacao_pendente']);
const FORM_PENDING = new Set(['nao_conferido', 'pendente', 'parcial']);

const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
const words = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const brl = cents => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(amount(cents) / 100);
export const clean = words;
export function normalizeFinance(campaign, payload) {
  const entries = [];
  const slots = new Map((payload.horarios || []).map(s => [s.id,s]));
  const base = {
    schoolId:campaign.escola_id, school:campaign.escola_nome || 'Escola não identificada',
    campaignId:campaign.id, campaign:campaign.nome_publico || 'Campanha', slug:campaign.slug,
    archivedCampaign:Boolean(campaign.oculto_em),
  };
  for(const p of (payload.pedidos || [])) {
    const state = String(p.status || '');
    const canceled = CANCELED.has(state);
    const paid = state === 'pago' ? amount(p.valor_pago_centavos) : 0;
    const value = p.valor_total_centavos == null ? null : amount(p.valor_total_centavos);
    const packages = [...new Set((p.participantes || []).map(x => x.pacote).filter(Boolean))];
    entries.push({
      ...base, id:p.id, source:'online', type:'Pedido online',
      name:p.responsavel_nome || 'Sem responsável',
      dancer:(p.participantes || []).map(x => x.nome).filter(Boolean).join(', '),
      package:packages.join(' / ') || 'Não informado', value, paid, state,
      method:p.metodo_pagamento || '', declared:false,
      date:p.criado_em || '', schedule:'', scheduleState:'',
      archived: Boolean(p.arquivado_em), canceled,
      review:state==='conciliacao_pendente',
      active:!canceled && (state==='pago' || ONLINE_PENDING.has(state)),
    });
  }
  for(const p of (payload.respostas || [])) {
    const state = String(p.pagamento_situacao || 'nao_conferido');
    const canceled = CANCELED.has(state);
    const paid = ['pago_manual','parcial'].includes(state) ? amount(p.valor_recebido_centavos) : 0;
    const value = p.valor_informado_centavos == null ? null : amount(p.valor_informado_centavos);
    const slot = slots.get(p.horario_id);
    const day = String(slot?.dia || '').slice(0,10);
    const start = String(slot?.inicio || '').slice(0,5);
    const participants = Array.isArray(p.alunos_inscritos) && p.alunos_inscritos.length ? p.alunos_inscritos.length : 1;
    const duration = amount(slot?.duracao_minutos) || 15;
    const time = /^\d{2}:\d{2}$/.test(start) ? Number(start.slice(0,2))*60+Number(start.slice(3,5))+participants*duration : null;
    const finish = time !== null && time <= 1440 ? String(Math.floor(time/60)).padStart(2,'0')+':'+String(time%60).padStart(2,'0') : '';
    const schedule = /^\d{4}-\d{2}-\d{2}$/.test(day) && finish ? day.slice(8)+'/'+day.slice(5,7)+'/'+day.slice(0,4)+' · '+start+'–'+finish : '';
    entries.push({
      ...base, id:p.id, source:'formulario', type:'Formulário',
      name:p.responsavel_nome || 'Sem responsável',
      dancer:Array.isArray(p.alunos_inscritos) && p.alunos_inscritos.length
        ? p.alunos_inscritos.map(x=>x.nome || x.bailarina_nome).filter(Boolean).join(', ')
        : p.bailarina_nome || '',
      package:p.experiencia_original || 'Não informado', value, paid, state,
      method:p.pagamento_metodo || p.pagamento_preferido || '',
      declared:!p.pagamento_metodo && Boolean(p.pagamento_preferido),
      date:p.respondido_em || p.criado_em || '', schedule,
      scheduleState:p.agendamento_status || '',
      archived:Boolean(p.arquivado_em), canceled,
      review:state==='nao_conferido',
      active:!canceled && (state==='pago_manual' || FORM_PENDING.has(state)),
    });
  }
  return entries;
}
export function isIncluded(row) {
  // Arquivados sem receita não entram na posição; com pagamento mantêm o histórico.
  return row.active && (!row.archived || row.paid > 0);
}
export function due(row) {
  return isIncluded(row) && row.value !== null ? Math.max(0,row.value-row.paid) : 0;
}
export function statusGroup(row) {
  if(!row.active || (row.archived && row.paid===0)) return 'cancelado';
  if(row.review) return 'conferir';
  if(row.value !== null && row.value > 0 && row.paid >= row.value) return 'confirmado';
  if(row.paid > 0) return 'parcial';
  return 'pendente';
}
export function financeTotals(rows) {
  const active=rows.filter(isIncluded);
  return {
    closed:active.reduce((s,r)=>s+(r.value ?? 0),0),
    received:active.reduce((s,r)=>s+r.paid,0),
    due:active.reduce((s,r)=>s+due(r),0),
    missingValue:active.filter(r=>r.value===null).length,
    activeCount:active.length,
    reviewCount:active.filter(r=>r.review).length,
    scheduleCount:active.filter(r=>r.source==='formulario' &&
      r.scheduleState==='solicitado' && r.value !== null && r.value > 0 && r.paid >= r.value).length,
  };
}
export function filterFinance(rows, filters) {
  const q=words(filters.query).trim();
  return rows.filter(r=>{
    if(filters.school && r.schoolId!==filters.school)return false;
    if(filters.campaign && r.slug!==filters.campaign)return false;
    if(filters.type && r.source!==filters.type)return false;
    if(filters.package && r.package!==filters.package)return false;
    if(filters.status && filters.status!=='geral'){
      if(filters.status==='recebidos'){if(r.paid<=0)return false;}
      else if(filters.status==='a-receber'){if(due(r)<=0)return false;}
      else if(filters.status!==statusGroup(r))return false;
    }
    if(filters.method){
      const m=words(r.method);
      if(filters.method==='pix' && !m.includes('pix'))return false;
      if(filters.method==='credito' && !/cr[eé]dito|cart[aã]o|credit/.test(m))return false;
      if(filters.method==='outro' && (!m || m.includes('pix') || /credito|cartao|credit/.test(m)))return false;
    }
    if(filters.from && String(r.date).slice(0,10)<filters.from)return false;
    if(filters.to && String(r.date).slice(0,10)>filters.to)return false;
    if(q&&!words([r.name,r.dancer,r.school,r.campaign,r.package,r.schedule,r.method].join(' ')).includes(q))return false;
    return true;
  });
}
export function exportFinanceCSV(rows) {
  const columns=['Escola','Campanha','Tipo','Data','Responsável','Bailarina(s)','Experiência','Valor fechado (R$)','Recebido (R$)','A receber (R$)','Situação','Forma indicada','Horário','Situação do horário'];
  const safe = value=>{
    let s=String(value??'').replace(/[\r\n]+/g,' ');
    if(/^[=+\-@\t]/.test(s))s="'"+s; // evita execução de fórmula ao abrir no Excel
    return '"'+s.replace(/"/g,'""')+'"';
  };
  return '\uFEFF'+[columns,...rows.map(r=>[
    r.school,r.campaign,r.type,r.date,r.name,r.dancer,r.package,
    r.value===null?'':(r.value/100).toFixed(2).replace('.',','),
    (r.paid/100).toFixed(2).replace('.',','),
    (due(r)/100).toFixed(2).replace('.',','),
    statusGroup(r),r.method+(r.declared?' (preferência)':''),r.schedule,r.scheduleState
  ])].map(line=>line.map(safe).join(';')).join('\r\n');
}
