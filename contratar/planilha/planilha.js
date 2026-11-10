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
const data={all:[],visible:[],loading:false,ids:new Set(),initial:false,selected:null,editing:null,columns:[],draft:[],editIntentHandled:false}
const palette=['vinho','dourado','azul','verde','rosa','cinza']
const rowColors=['sem','verde','amarelo','rosa','azul','cinza']
$('back').href='/contratar/'+encodeURIComponent(slug)+'/admin/#respostas'

async function request(action,body={}){
 const {data:s}=await client.auth.getSession()
 if(!s?.session?.access_token)throw new Error('Faça login como administrador para acessar esta planilha.')
 const response=await fetch(BASE+'/functions/v1/contratacao-admin',{
  method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',Authorization:'Bearer '+s.session.access_token},
  body:JSON.stringify({action,slug,...body}),signal:AbortSignal.timeout(20000)
 })
 const output=await response.json().catch(()=>({}))
 if(!response.ok){const e=new Error(output.error||'Não foi possível concluir a ação.');e.status=response.status;throw e}
 return output
}
function el(tag,value,className=''){
 const node=document.createElement(tag)
 if(value!==undefined&&value!==null)node.textContent=String(value)
 if(className)node.className=className
 return node
}
function button(text,action,className=''){
 const node=el('button',text,className);node.type='button'
 node.addEventListener('click',action)
 return node
}
function showError(msg){$('error').textContent=msg;$('error').hidden=false}
function toast(msg){
 const node=$('toast');node.textContent=msg;node.hidden=false
 node.classList.remove('pulse');void node.offsetWidth;node.classList.add('pulse')
}
function setDialogError(prefix,msg){$(prefix+'-error').textContent=msg;$(prefix+'-error').hidden=false}
function closeDialog(id){$(id).close()}

function normalize(payload){
 const follow=new Map((payload.acompanhamentos||[]).map(f=>[
  (f.pedido_id?'online:':'formulario:')+(f.pedido_id||f.resposta_form_id),f]))
 const forms=(payload.respostas||[]).map(r=>{
  const fu=follow.get('formulario:'+r.id)
  return {
   id:r.id,source:'formulario',name:r.responsavel_nome||'',
   whatsapp:r.responsavel_whatsapp||'',dancer:r.bailarina_nome||'',
   students:Array.isArray(r.alunos_inscritos)?r.alunos_inscritos:null,
   package:r.experiencia_original||'',value:Number(r.valor_informado_centavos)||0,
   paidAmount:Number(r.valor_recebido_centavos)||0,paymentStatus:r.pagamento_situacao,
   method:r.pagamento_metodo||'',reference:r.pagamento_referencia||'',
   paymentNote:r.pagamento_observacao||'',
   when:r.respondido_em||r.criado_em,
   paid:r.pagamento_situacao==='pago_manual',cancelled:r.pagamento_situacao==='cancelado',
   preferred:r.pagamento_preferido||'',archived:!!r.arquivado_em,
   contacted:!!fu?.ultimo_contato_em||['aguardando_resposta','concluido','nao_precisa'].includes(fu?.situacao||''),
   extras:r.planilha_campos&&typeof r.planilha_campos==='object'&&!Array.isArray(r.planilha_campos)?r.planilha_campos:{},
   color:rowColors.includes(r.planilha_cor)?r.planilha_cor:'sem',
   note:r.planilha_nota||'',slot:r.horario_id||null,scheduleStatus:r.agendamento_status||null
  }
 })
 const online=(payload.pedidos||[]).map(r=>{
  const fu=follow.get('online:'+r.id)
  return {id:r.id,source:'online',name:r.responsavel_nome||'',
   whatsapp:r.responsavel_whatsapp||'',dancer:(r.participantes||[]).map(x=>x.nome).join(', '),
   package:(r.participantes||[]).map(x=>x.pacote).filter(Boolean).join(' / '),
   value:Number(r.valor_total_centavos)||0,paidAmount:Number(r.valor_pago_centavos)||0,
   when:r.criado_em,paymentStatus:r.status,paid:r.status==='pago',
   cancelled:['cancelado','reembolsado'].includes(r.status),preferred:r.metodo_pagamento||'',
   archived:!!r.arquivado_em,contacted:!!fu?.ultimo_contato_em||
    ['aguardando_resposta','concluido','nao_precisa'].includes(fu?.situacao||''),
   extras:{},note:'',color:'sem',students:null,slot:null
  }
 })
 return [...forms,...online]
}
function displayedStatus(r){
 return r.archived?'Removido':r.paid?'Pago':r.paymentStatus==='parcial'?'Parcial':
  r.cancelled?'Cancelado':'Pendente'
}
function current(){
 const q=clean($('query').value),status=$('status-filter').value
 data.visible=data.all.filter(r=>{
  if(status==='arquivados'?!r.archived:r.archived)return false
  if(q&&!clean([r.name,r.dancer,r.whatsapp,r.package,r.note,
   ...Object.values(r.extras||{})].join(' ')).includes(q))return false
  if(status==='novas'&&r.contacted)return false
  if(status==='pago'&&!r.paid)return false
  if(status==='pendente'&&(r.paid||r.cancelled))return false
  return true
 })
 data.visible.sort((a,b)=>Date.parse(b.when||0)-Date.parse(a.when||0))
 $('count').textContent=data.visible.length+' registro(s)'
 renderHead()
 renderRows()
}
function renderHead(){
 const head=$('sheet-head');head.replaceChildren()
 const names=['Data','Responsável','WhatsApp','Bailarina(s)','Experiência','Valor previsto',
  'Recebido','Situação','Preferência','Contato','Anotações']
 for(const name of names)head.append(el('th',name))
 for(const col of data.columns){
  const th=el('th',col.titulo,'column-'+col.cor)
  th.title='Coluna personalizada: '+col.titulo
  head.append(th)
 }
 head.append(el('th','Ações'))
}
function renderRows(){
 const root=$('rows');root.replaceChildren()
 if(!data.visible.length){
  const row=el('tr');const td=el('td','Nenhum registro corresponde aos filtros. Confira a aba “Removidos”.')
  td.colSpan=12+data.columns.length;row.append(td);root.append(row);return
 }
 const fragment=document.createDocumentFragment()
 for(const r of data.visible){
  const row=el('tr')
  if(r.isNew)row.classList.add('new')
  if(r.color!=='sem')row.classList.add('row-'+r.color)
  if(r.archived)row.classList.add('archived')
  const base=[
    date(r.when),r.name,r.whatsapp,r.dancer,r.package,money(r.value),
    money(r.paidAmount),displayedStatus(r),r.preferred,r.contacted?'Contatado':'Ainda não',null
  ]
  for(let i=0;i<base.length;i++){
   const td=el('td')
   if(i===2&&wa(r.whatsapp)){
    const a=el('a',base[i]);a.href=wa(r.whatsapp);a.target='_blank';a.rel='noopener noreferrer';td.append(a)
   }else if(i===7){
    td.append(el('span',base[i],'badge '+(r.paid?'paid':r.archived?'archive':'')))
   }else if(i===10){
    const b=button(r.note||'＋ Anotação',()=>r.source==='formulario'?openEdit(r):toast('Pedido online: ajuste dados pelo pedido original.'),'cell-edit')
    b.title='Editar anotações';td.append(b)
   }else{
    td.textContent=base[i]
    if(i===1&&r.source==='formulario'&&!r.archived){
     td.classList.add('editable-cell')
     td.title='Duplo clique para editar'
     td.addEventListener('dblclick',()=>openEdit(r))
    }
   }
   row.append(td)
  }
  for(const col of data.columns){
   const td=el('td')
   if(r.source==='formulario'){
    const b=button(r.extras?.[col.id]||'＋ Adicionar',()=>openEdit(r),'cell-edit')
    b.title='Editar '+col.titulo
    td.append(b)
   }else td.textContent='—'
   row.append(td)
  }
  const actions=el('td');const controls=el('div',null,'buttons')
  if(r.source==='formulario'&&!r.archived)controls.append(button('✎ Editar',()=>openEdit(r),'action-secondary'))
  if(wa(r.whatsapp)){
   const a=el('a','WhatsApp');a.href=wa(r.whatsapp);a.target='_blank';a.rel='noopener noreferrer'
   controls.append(a)
  }
  if(!r.contacted&&!r.archived){
   controls.append(button('✓ Contatei',async()=>{try{
    await request('central_salvar_acompanhamento',{
     origem:r.source,referencia_id:r.id,situacao:'aguardando_resposta',
     proximo_contato_em:null,observacoes:'',registrar_contato:true
    });toast('Contato registrado.');await refresh()
   }catch(e){showError(e.message)}},'action-secondary'))
  }
  if(r.source==='formulario'&&!r.archived){
   controls.append(button(r.paidAmount>0?'R$ Corrigir':'R$ Conferir',()=>openPay(r),'action-payment'))
  }
  if(r.archived){
   controls.append(button('↶ Restaurar',()=>archive(r,false),'action-secondary'))
  }else if(!r.paid&&r.paidAmount===0){
   if(r.slot&&['solicitado','confirmado'].includes(r.scheduleStatus)){
    controls.append(button('Cancelar horário',()=>cancelSchedule(r),'action-danger'))
   }else controls.append(button('Remover',()=>archive(r,true),'action-danger'))
  }
  actions.append(controls);row.append(actions);fragment.append(row)
 }
 root.append(fragment)
}
async function refresh(){
 if(data.loading)return
 data.loading=true;$('refresh').disabled=true;$('error').hidden=true
 try{
  const payload=await request('central_listar')
  $('campaign-name').textContent=payload.campanha?.nome||slug
  data.columns=Array.isArray(payload.campanha?.planilha_colunas)?
   payload.campanha.planilha_colunas.filter(c=>c&&/^col_[a-f0-9]{8,32}$/.test(c.id)&&palette.includes(c.cor)): []
  const rows=normalize(payload)
  let recent=0
  for(const r of rows){
   r.isNew=data.initial&&!data.ids.has(r.source+':'+r.id)
   if(r.isNew)recent++
  }
  data.all=rows;data.ids=new Set(rows.map(r=>r.source+':'+r.id))
  if(data.initial&&recent>0){
   $('new-count').textContent='● '+recent+' nova(s) inscrição(ões)!'
   document.title='('+recent+' nova(s)) Planilha | Grand Focus'
  }else $('new-count').textContent='Atualização automática a cada 15 segundos'
  data.initial=true
  if(payload.resultados_possivelmente_truncados)showError('Esta campanha pode ter mais de 1.000 registros. Consulte o histórico antes de conciliar.')
  current()
  if(!data.editIntentHandled){
   data.editIntentHandled=true
   const editId=new URLSearchParams(location.search).get('editar')
   const target=data.all.find(r=>r.source==='formulario'&&r.id===editId&&!r.archived)
   if(target)openEdit(target)
  }
  $('updated').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR')
  $('connection').textContent='● Conectado'
 }catch(e){$('connection').textContent='● Sem atualização';showError(e.message)}
 finally{data.loading=false;$('refresh').disabled=false}
}
async function archive(r,remove){
 if(remove&&!window.confirm(
  'Remover esta resposta da lista? Você poderá restaurá-la em “Removidos”. Nenhum pagamento será apagado.'
 ))return
 try{
  await request('central_arquivar',{origem:r.source,referencia_id:r.id,arquivar:remove})
  toast(remove?'Resposta removida da lista. Pode ser restaurada.':'Resposta restaurada.')
  await refresh()
 }catch(e){showError(e.message)}
}
async function cancelSchedule(r){
 if(r.paidAmount>0){showError('Esta reserva possui dinheiro registrado. Revise a conferência financeira antes de cancelar.');return}
 if(!window.confirm('Cancelar o horário desta família para liberar os intervalos? Não será possível desfazer automaticamente.'))return
 try{
  const action=slug==='gente-que-danca-2026'?'gente_atualizar_agendamento':
   slug==='natal-fada-acucarada-2026'?'natal_atualizar_agendamento':null
  if(!action)throw Error('Esta campanha exige cancelamento de horário na administração.')
  await request(action,{resposta_id:r.id,status:'cancelado'})
  toast('Horário liberado. A resposta agora pode ser removida se necessário.')
  await refresh()
 }catch(e){showError(e.message)}
}
function labelInput(label,id,value,area=false){
 const wrapper=el('label')
 wrapper.append(el('span',label))
 const input=el(area?'textarea':'input')
 input.id=id;input.value=value??''
 if(area)input.rows=2
 else input.maxLength=120
 wrapper.append(input);return wrapper
}
function openEdit(r){
 if(r.source!=='formulario'||r.archived)return
 data.editing=r
 $('edit-caption').textContent='Pedido de '+date(r.when)+' · '+r.package
 $('edit-name').value=r.name
 $('edit-phone').value=r.whatsapp
 $('edit-color').value=r.color
 $('edit-note').value=r.note
 $('edit-error').hidden=true
 const students=$('edit-students');students.replaceChildren()
 if(r.students?.length){
  for(let i=0;i<r.students.length;i++){
   const x=labelInput('Bailarino(a) '+(i+1),'edit-student-'+i,r.students[i].nome||'')
   x.querySelector('input').dataset.student=String(i)
   students.append(x)
  }
 }else students.append(labelInput('Bailarina(s)','edit-dancer',r.dancer))
 const extras=$('edit-extras');extras.replaceChildren()
 for(const col of data.columns){
  const x=labelInput(col.titulo,'edit-extra-'+col.id,r.extras?.[col.id]||'',true)
  x.querySelector('textarea').dataset.extra=col.id
  x.querySelector('textarea').maxLength=700
  extras.append(x)
 }
 $('edit-dialog').showModal()
 $('edit-name').focus()
}
$('edit-cancel').onclick=()=>$('edit-dialog').close()
$('edit-form').addEventListener('submit',async event=>{
 event.preventDefault()
 const r=data.editing;if(!r)return
 const alunos=r.students?.length?
  [...$('edit-students').querySelectorAll('[data-student]')].map((field,i)=>({
    ...r.students[i],nome:field.value.trim()})):null
 // As colunas ocultas mantêm seus valores no registro original.
 const campos={...r.extras}
 for(const input of $('edit-extras').querySelectorAll('[data-extra]'))
  campos[input.dataset.extra]=input.value.trim()
 const payload={
  resposta_id:r.id,nome:$('edit-name').value.trim(),whatsapp:$('edit-phone').value,
  bailarina:alunos?alunos.map(a=>a.nome).join(', '):$('edit-dancer')?.value.trim()||r.dancer,
  alunos,campos,cor:$('edit-color').value,nota:$('edit-note').value
 }
 const b=$('edit-save');b.disabled=true;$('edit-error').hidden=true
 try{
  await request('planilha_editar_resposta',payload)
  $('edit-dialog').close();toast('Alterações salvas no cadastro, sem alterar pagamentos.')
  await refresh()
 }catch(e){setDialogError('edit',e.message)}
 finally{b.disabled=false}
})
function formatColorOptions(select,chosen){
 for(const color of palette){
  const opt=el('option',({vinho:'Vinho',dourado:'Dourado',azul:'Azul',verde:'Verde',rosa:'Rosa',cinza:'Cinza'})[color])
  opt.value=color;select.append(opt)
 }
 select.value=chosen
}
function drawColumns(){
 const list=$('columns-list');list.replaceChildren()
 if(!data.draft.length)list.append(el('p','Nenhuma coluna extra. Clique em “Criar coluna”.','muted'))
 for(const col of data.draft){
  const row=el('div',null,'column-setting')
  const name=el('input');name.value=col.titulo;name.placeholder='Nome da coluna';name.maxLength=60
  name.setAttribute('aria-label','Nome da coluna');name.addEventListener('input',()=>col.titulo=name.value)
  const color=el('select');color.setAttribute('aria-label','Cor da coluna')
  formatColorOptions(color,col.cor)
  color.addEventListener('change',()=>col.cor=color.value)
  const del=button('✕',()=>{
   if(!window.confirm('Ocultar esta coluna? Os textos já preenchidos não serão apagados dos registros.'))return
   data.draft=data.draft.filter(c=>c.id!==col.id);drawColumns()
  },'action-danger');del.setAttribute('aria-label','Remover coluna '+col.titulo)
  row.append(name,color,del);list.append(row)
 }
}
$('columns').onclick=()=>{
 data.draft=data.columns.map(c=>({...c}))
 $('columns-error').hidden=true;drawColumns();$('columns-dialog').showModal()
}
$('add-column').onclick=()=>{
 if(data.draft.length>=12){setDialogError('columns','Limite de 12 colunas.');return}
 const id='col_'+crypto.randomUUID().replace(/-/g,'').slice(0,16)
 data.draft.push({id,titulo:'Nova coluna',cor:'vinho'})
 drawColumns()
 $('columns-list').querySelector('.column-setting:last-child input')?.focus()
}
$('columns-cancel').onclick=()=>$('columns-dialog').close()
$('columns-form').addEventListener('submit',async event=>{
 event.preventDefault();$('columns-error').hidden=true
 if(data.draft.some(c=>c.titulo.trim().length<2)){setDialogError('columns','Informe o nome de cada coluna.');return}
 const b=$('columns-save');b.disabled=true
 try{
  await request('planilha_configurar_colunas',{
   colunas:data.draft.map(c=>({id:c.id,titulo:c.titulo.trim(),cor:c.cor}))
  })
  $('columns-dialog').close();toast('Colunas salvas para toda a equipe.')
  await refresh()
 }catch(e){setDialogError('columns',e.message)}
 finally{b.disabled=false}
})
function openPay(r){
 if(r.source!=='formulario')return
 data.selected=r
 $('pay-person').textContent=r.name+' · '+r.dancer
 $('pay-status').value=['pago_manual','parcial','pendente','nao_conferido','cancelado'].includes(r.paymentStatus)?
  r.paymentStatus:'pendente'
 $('pay-amount').value=((r.paidAmount||r.value)/100).toFixed(2).replace('.',',')
 const raw=clean(r.method||r.preferred)
 $('pay-method').value=raw.includes('pix')?'pix':
  raw.includes('cartao')||raw.includes('credito')?'credito':
  raw.includes('dinheiro')?'dinheiro':raw.includes('outro')?'outro':''
 $('pay-reference').value=r.reference||''
 $('pay-note').value=r.paymentNote||''
 $('pay-verified').checked=false;$('pay-error').hidden=true
 $('pay-dialog').showModal()
}
$('pay-cancel').onclick=()=>$('pay-dialog').close()
$('pay-status').onchange=()=>{
 const status=$('pay-status').value
 if(!['parcial','pago_manual'].includes(status)){
  $('pay-amount').value='0,00';$('pay-verified').checked=false
 }else if(Number($('pay-amount').value.replace(',','.'))===0){
  $('pay-amount').value=((data.selected?.value||0)/100).toFixed(2).replace('.',',')
 }
}
$('pay-form').addEventListener('submit',async ev=>{
 ev.preventDefault();const r=data.selected
 if(!r||r.source!=='formulario')return
 const status=$('pay-status').value
 const monetary=['parcial','pago_manual'].includes(status)
 const val=Number($('pay-amount').value.replace(/\./g,'').replace(',','.'))
 const cents=Math.round(val*100)
 const note=$('pay-note').value.trim()
 if(!Number.isSafeInteger(cents)||cents<0||cents>100000000){
  setDialogError('pay','Informe o valor corretamente.');return
 }
 if(monetary&&(cents<=0||!$('pay-method').value||!$('pay-verified').checked)){
  setDialogError('pay','Para registrar dinheiro recebido, selecione o meio e confirme no extrato.');return
 }
 if(!monetary&&cents!==0){setDialogError('pay','Para situação sem recebimento, o valor deve ser R$ 0.');return}
 if(r.paidAmount>0&&!monetary){
  if(note.length<10){setDialogError('pay','Explique por que um recebimento anteriormente registrado está sendo corrigido.');return}
  if(r.scheduleStatus==='confirmado'){
   setDialogError('pay','Este agendamento já está confirmado. Resolva o cancelamento e eventual reembolso com a equipe antes de alterar o recebimento.');return
  }
  if(!window.confirm('Você está retirando um pagamento confirmado do sistema. Isso deve corresponder à conferência real do extrato. Continuar?'))return
 }
 const ref=$('pay-reference').value.trim()||
  'Conferência manual em '+new Date().toLocaleString('pt-BR')
 const b=$('pay-save');b.disabled=true;$('pay-error').hidden=true
 try{
  await request('central_registrar_pagamento',{
   resposta_id:r.id,situacao:status,valor_recebido_centavos:cents,
   metodo:monetary?$('pay-method').value:'',
   referencia:monetary?ref:'',
   observacao:note||'Conferido pela equipe no painel Grand Focus.',
   conferencia_confirmada:monetary?$('pay-verified').checked:false
  })
  $('pay-dialog').close()
  toast('Situação financeira atualizada com registro de auditoria.')
  await refresh()
 }catch(e){setDialogError('pay',e.message)}
 finally{b.disabled=false}
})
function escCSV(x){
 let t=String(x??'')
 if(/^\s*[=+@-]/.test(t))t="'"+t
 return '"'+t.replace(/"/g,'""')+'"'
}
$('export').onclick=()=>{
 const headers=['Data','Responsável','WhatsApp','Bailarinas','Experiência','Valor (R$)',
  'Recebido (R$)','Situação','Preferência','Contatado','Anotações',
  ...data.columns.map(c=>c.titulo)]
 const rows=[headers]
 for(const r of data.visible)rows.push([
  date(r.when),r.name,r.whatsapp,r.dancer,r.package,(r.value/100).toFixed(2).replace('.',','),
  (r.paidAmount/100).toFixed(2).replace('.',','),displayedStatus(r),
  r.preferred,r.contacted?'Sim':'Não',r.note,...data.columns.map(c=>r.extras?.[c.id]||'')
 ])
 const csv='\uFEFF'+rows.map(row=>row.map(escCSV).join(';')).join('\r\n')
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
 const a=document.createElement('a');a.href=url;a.download='Grand_Focus_'+slug+'_respostas.csv'
 document.body.append(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),500)
}
$('refresh').onclick=refresh
$('query').oninput=current;$('status-filter').onchange=current
document.addEventListener('keydown',ev=>{
 if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){
  ev.preventDefault();$('query').focus()
 }
})
setInterval(()=>{
 if(!document.hidden&&![...document.querySelectorAll('dialog')].some(d=>d.open))
  void refresh()
},15000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()})
void refresh()
