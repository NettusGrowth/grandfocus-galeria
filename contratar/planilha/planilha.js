import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
const BASE='https://selnsjtumkxjrtnqofqx.supabase.co'
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const client=createClient(BASE,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}})
const slug=new URLSearchParams(location.search).get('campanha')||'entre-estacoes'
const $=id=>document.getElementById(id)
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(n)||0)/100)
const date=n=>n?new Date(n).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const clean=str=>String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const wa=tel=>{let n=String(tel||'').replace(/\D/g,'');if(n.length===10||n.length===11)n='55'+n;return /^55\d{10,11}$/.test(n)?'https://wa.me/'+n:null}
const data={all:[],visible:[],loading:false,ids:new Set(),initial:false,selected:null}
$('back').href='/contratar/'+encodeURIComponent(slug)+'/admin/#respostas'
async function request(action,body={}){
 const {data:s}=await client.auth.getSession()
 if(!s?.session?.access_token)throw new Error('Faça login como administrador para acessar esta planilha.')
 const response=await fetch(BASE+'/functions/v1/contratacao-admin',{
  method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',Authorization:'Bearer '+s.session.access_token},
  body:JSON.stringify({action,slug,...body}),signal:AbortSignal.timeout(20000)
 })
 const output=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(output.error||'Não foi possível carregar a planilha.')
 return output
}
function line(tag,txt,css=''){
 const e=document.createElement(tag);e.textContent=String(txt??'');if(css)e.className=css;return e
}
function current(){
 const q=clean($('query').value),status=$('status-filter').value
 data.visible=data.all.filter(r=>{
  if(q&&!clean([r.name,r.dancer,r.whatsapp].join(' ')).includes(q))return false
  if(status==='novas'&&r.contacted)return false
  if(status==='pago'&&!r.paid)return false
  if(status==='pendente'&&(r.paid||r.cancelled))return false
  return true
 })
 data.visible.sort((a,b)=>Date.parse(b.when||0)-Date.parse(a.when||0))
 $('count').textContent=data.visible.length+' registro(s)'
 $('rows').replaceChildren()
 if(!data.visible.length){
  const tr=line('tr');const td=line('td','Nenhum registro encontrado.');td.colSpan=10;tr.append(td);$('rows').append(tr);return
 }
 const fragment=document.createDocumentFragment()
 for(const r of data.visible){
  const tr=document.createElement('tr')
  if(r.isNew)tr.className='new'
  tr.append(line('td',date(r.when)),line('td',r.name),line('td',r.whatsapp),line('td',r.dancer),
   line('td',r.package),line('td',money(r.value)))
  const statusTd=line('td');statusTd.append(line('span',r.archived?'Arquivado':r.paid?'Pago':r.cancelled?'Cancelado':'Pendente',r.paid?'badge paid':r.archived?'badge archive':'badge'));tr.append(statusTd)
  tr.append(line('td',r.preferred))
  const contact=line('td',r.contacted?'Contatado':'Não contatado');tr.append(contact)
  const action=line('td');const buttons=line('div',undefined,'buttons')
  const phone=wa(r.whatsapp)
  if(phone){const a=line('a','WhatsApp');a.href=phone;a.target='_blank';a.rel='noopener noreferrer';buttons.append(a)}
  if(!r.contacted&&!r.archived){
   const b=line('button','✓ Contatei');b.type='button'
   b.onclick=async()=>{b.disabled=true;try{await request('central_salvar_acompanhamento',{
    origem:r.source,referencia_id:r.id,situacao:'aguardando_resposta',
    proximo_contato_em:null,observacoes:'',registrar_contato:true
   });r.contacted=true;current()}catch(e){showError(e.message)}finally{b.disabled=false}}
   buttons.append(b)
  }
  if(r.source==='formulario'&&!r.paid&&!r.archived&&!r.cancelled){
   const b=line('button','R$ Pago');b.type='button';b.onclick=()=>openPay(r);buttons.append(b)
  }
  action.append(buttons);tr.append(action);fragment.append(tr)
 }
 $('rows').append(fragment)
}
function showError(message){$('error').textContent=message;$('error').hidden=false}
function normalize(payload){
 const follow=new Map((payload.acompanhamentos||[]).map(f=>[
  (f.pedido_id?'online:':'formulario:')+(f.pedido_id||f.resposta_form_id),f]))
 const forms=(payload.respostas||[]).map(r=>{
  const fu=follow.get('formulario:'+r.id)
  return {id:r.id,source:'formulario',name:r.responsavel_nome||'',
   whatsapp:r.responsavel_whatsapp||'',dancer:r.bailarina_nome||'',
   package:r.experiencia_original||'',value:r.valor_informado_centavos||0,
   when:r.respondido_em||r.criado_em,
   paid:r.pagamento_situacao==='pago_manual',cancelled:r.pagamento_situacao==='cancelado',
   preferred:r.pagamento_preferido||'',archived:!!r.arquivado_em,
   contacted:!!fu?.ultimo_contato_em||['aguardando_resposta','concluido','nao_precisa'].includes(fu?.situacao||'')}
 })
 const online=(payload.pedidos||[]).map(r=>{
  const fu=follow.get('online:'+r.id)
  return {id:r.id,source:'online',name:r.responsavel_nome||'',
   whatsapp:r.responsavel_whatsapp||'',dancer:(r.participantes||[]).map(x=>x.nome).join(', '),
   package:(r.participantes||[]).map(x=>x.pacote).filter(Boolean).join(' / '),
   value:r.valor_total_centavos||0,when:r.criado_em,
   paid:r.status==='pago',cancelled:['cancelado','reembolsado'].includes(r.status),
   preferred:r.metodo_pagamento||'',archived:!!r.arquivado_em,
   contacted:!!fu?.ultimo_contato_em||['aguardando_resposta','concluido','nao_precisa'].includes(fu?.situacao||'')}
 })
 return [...forms,...online]
}
async function refresh(){
 if(data.loading)return
 data.loading=true;$('refresh').disabled=true;$('error').hidden=true
 try{
  const payload=await request('central_listar')
  $('campaign-name').textContent=payload.campanha?.nome||slug
  const all=normalize(payload)
  let recent=0
  for(const row of all){
   row.isNew=data.initial&&!data.ids.has(row.source+':'+row.id)
   if(row.isNew)recent++
  }
  data.all=all;data.ids=new Set(all.map(r=>r.source+':'+r.id))
  if(data.initial&&recent>0){
   $('new-count').textContent='● '+recent+' nova(s) inscrição(ões)!'
   document.title='('+recent+' nova(s)) Planilha | Grand Focus'
  }else $('new-count').textContent='Atualização automática a cada 15 segundos'
  data.initial=true
  if(payload.resultados_possivelmente_truncados)showError('A campanha ultrapassou 1.000 registros por origem. Consulte o histórico completo antes de conciliar.')
  current()
  $('updated').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR')
  $('connection').textContent='● Conectado'
 }catch(e){$('connection').textContent='● Sem atualização';showError(e.message)}
 finally{data.loading=false;$('refresh').disabled=false}
}
function openPay(r){
 data.selected=r
 $('pay-person').textContent=r.name+' · '+r.dancer
 $('pay-amount').value=(r.value/100).toFixed(2).replace('.',',')
 const pref=clean(r.preferred)
 $('pay-method').value=pref.includes('pix')?'pix':pref.includes('cartao')||pref.includes('credito')?'credito':''
 $('pay-reference').value=''
 $('pay-verified').checked=false;$('pay-error').hidden=true
 $('pay-dialog').showModal()
}
$('pay-cancel').onclick=()=>$('pay-dialog').close()
$('pay-form').addEventListener('submit',async ev=>{
 ev.preventDefault()
 const r=data.selected
 if(!r||r.source!=='formulario')return
 const val=Number($('pay-amount').value.replace(/\./g,'').replace(',','.'))
 const cents=Math.round(val*100)
 if(!Number.isSafeInteger(cents)||cents<1||cents>100000000){
  $('pay-error').textContent='Informe o valor recebido corretamente.';$('pay-error').hidden=false;return
 }
 const method=$('pay-method').value
 if(!method||!$('pay-verified').checked){
  $('pay-error').textContent='Escolha o meio e confirme que verificou o recebimento.';$('pay-error').hidden=false;return
 }
 const ref=$('pay-reference').value.trim()||
  'Conferência manual pela equipe em '+new Date().toLocaleString('pt-BR')
 const button=$('pay-save');button.disabled=true
 try{
  await request('central_registrar_pagamento',{
   resposta_id:r.id,situacao:cents>=r.value?'pago_manual':'parcial',
   valor_recebido_centavos:cents,metodo:method,
   referencia:ref,observacao:'Conferido e registrado pela planilha Grand Focus.',
   conferencia_confirmada:true
  })
  $('pay-dialog').close();await refresh()
 }catch(e){$('pay-error').textContent=e.message;$('pay-error').hidden=false}
 finally{button.disabled=false}
})
function escCSV(x){let t=String(x??'');if(/^\s*[=+@-]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"'}
$('export').onclick=()=>{
 const rows=[['Data','Responsável','WhatsApp','Bailarinas','Experiência','Valor informado (R$)','Pago','Preferência','Contatado']]
 for(const r of data.visible)rows.push([date(r.when),r.name,r.whatsapp,r.dancer,r.package,
  (r.value/100).toFixed(2).replace('.',','),r.paid?'Sim':'Não',r.preferred,r.contacted?'Sim':'Não'])
 const csv='\uFEFF'+rows.map(row=>row.map(escCSV).join(';')).join('\r\n')
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
 const a=document.createElement('a');a.href=url;a.download='Grand_Focus_'+slug+'_respostas.csv'
 document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url)
}
$('refresh').onclick=refresh
$('query').oninput=current;$('status-filter').onchange=current
setInterval(()=>{if(!document.hidden&&!$('pay-dialog').open)void refresh()},15000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()})
void refresh()
