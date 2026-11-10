// Grand Focus × Fada Açucarada: agendamento simples e pagamento manual.
// O cliente apenas escolhe o horário; a reserva acontece atomicamente no ENVIO.
const SLUG='natal-fada-acucarada-2026'
const URL_API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-publica'
const URL_ADMIN='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-admin'
const SUPABASE_URL='https://selnsjtumkxjrtnqofqx.supabase.co'
const PUBLIC_KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const preview=new URLSearchParams(location.search).get('preview')==='1'
const prices=Object.freeze({1:8000,2:14500,3:21500,4:28500})
const state={day:'2026-12-12',count:1,period:'morning',slot:null,slots:[],expanded:false,loading:false,submitting:false,requestSeq:0}
const $=id=>document.getElementById(id)
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)

function notify(message){
 const target=$('gf-error');target.textContent=message;target.hidden=false
 target.scrollIntoView({block:'center',behavior:'auto'})
}
function clearError(){$('gf-error').hidden=true}
function renderStudents(){
 const root=$('gf-students')
 const existing=[...root.querySelectorAll('[data-student-name]')].map(input=>input.value)
 root.replaceChildren()
 for(let i=0;i<state.count;i++){
  const wrapper=document.createElement('div');wrapper.className='gf-student'
  const label=document.createElement('label')
  label.textContent=state.count===1?'Nome completo do aluno *':'Nome completo do aluno '+(i+1)+' *'
  const input=document.createElement('input')
  input.id='gf-aluno-'+i;input.type='text';input.maxLength=120;input.required=true
  input.placeholder='Nome completo';input.autocomplete='off';input.dataset.studentName=''
  input.value=existing[i]||''
  label.append(input);wrapper.append(label);root.append(wrapper)
 }
 $('gf-total').textContent=money(prices[state.count])
 for(const btn of document.querySelectorAll('[data-count]'))
  btn.setAttribute('aria-pressed',String(Number(btn.dataset.count)===state.count))
 renderRecap()
}
function availability(){
 return state.slots.filter(slot=>slot.dia===state.day&&slot.ativo&&slot.disponiveis>0&&
   ((slot.inicio<'13:00')===(state.period==='morning')))
}
function renderRecap(){
 const root=$('gf-recap');root.replaceChildren()
 const selected=state.slots.find(x=>x.id===state.slot)
 if(!selected)return
 const p=document.createElement('p')
 p.textContent=(state.count===1?'1 aluno':state.count+' alunos')+' · '+
  (selected.dia==='2026-12-12'?'Sáb., 12/12':'Dom., 13/12')+
  ' às '+selected.inicio+' · '+money(prices[state.count])
 root.append(p)
}
function renderSlots(){
 const root=$('gf-slots');root.replaceChildren()
 const all=availability()
 if(state.loading){
  const p=document.createElement('p');p.className='gf-inline-help'
  p.textContent='Consultando horários...';root.append(p)
 }else if(!all.length){
  const p=document.createElement('p');p.className='gf-slots-empty'
  p.textContent='Sem horários livres neste período. Experimente outro dia.'
  root.append(p)
 }else{
  const ids=[all[0].id,all[Math.floor((all.length-1)/2)].id,all[all.length-1].id]
  const suggestions=[...new Set(ids)].map(id=>all.find(x=>x.id===id))
  const selected=all.find(x=>x.id===state.slot)
  const visible=state.expanded?all:(
    selected&&!suggestions.some(x=>x.id===selected.id)
    ?[...suggestions,selected].sort((a,b)=>a.inicio.localeCompare(b.inicio)):suggestions
  )
  for(const slot of visible){
   const button=document.createElement('button');button.type='button';button.textContent=slot.inicio
   button.setAttribute('aria-pressed',String(slot.id===state.slot))
   button.setAttribute('aria-label',slot.inicio+', para '+state.count+' aluno(s)')
   button.disabled=state.submitting
   button.addEventListener('click',()=>chooseSlot(slot.id))
   root.append(button)
  }
  if(all.length>suggestions.length){
   const more=document.createElement('button');more.type='button';more.className='gf-more-slots'
   more.disabled=state.submitting
   more.textContent=state.expanded?'Mostrar menos horários':'Ver todos os horários'
   more.addEventListener('click',()=>{state.expanded=!state.expanded;renderSlots()})
   root.append(more)
  }
 }
 for(const btn of document.querySelectorAll('[data-day]')){
  btn.setAttribute('aria-pressed',String(btn.dataset.day===state.day))
  btn.disabled=state.submitting
 }
 for(const btn of document.querySelectorAll('[data-period]')){
  btn.hidden=state.day==='2026-12-13'&&btn.dataset.period==='afternoon'
  btn.setAttribute('aria-pressed',String(btn.dataset.period===state.period))
  btn.disabled=state.submitting
 }
 renderRecap()
}
function chooseSlot(id){
 if(state.loading||state.submitting)return
 state.slot=id
 clearError()
 $('gf-slot-hint').textContent='Horário escolhido. A vaga será verificada quando você enviar.'
 renderSlots()
}
async function api(action,values={},admin=false){
 const headers={'Content-Type':'application/json',apikey:PUBLIC_KEY}
 if(admin){
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2')
  const supa=createClient(SUPABASE_URL,PUBLIC_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  })
  const {data}=await supa.auth.getSession()
  const token=data?.session?.access_token
  if(!token)throw new Error('Faça login na administração para visualizar a prévia.')
  headers.Authorization='Bearer '+token
 }
 const response=await fetch(admin?URL_ADMIN:URL_API,{
  method:'POST',headers,
  body:JSON.stringify(admin?{action,slug:SLUG,...values}:{action,campaign_slug:SLUG,...values}),
  signal:AbortSignal.timeout(17000)
 })
 const data=await response.json().catch(()=>({}))
 if(!response.ok){
  const error=new Error(data.error||'Falha na comunicação. Tente novamente.')
  error.status=response.status;throw error
 }
 return data
}
async function loadSlots(){
 const sequence=++state.requestSeq
 state.loading=true;renderSlots()
 try{
  const data=preview?await api('natal_agenda',{quantidade:state.count},true):
   await api('natal_horarios',{quantidade:state.count})
  if(sequence!==state.requestSeq)return
  state.slots=Array.isArray(data.horarios)?data.horarios:[]
  if(state.slot&&!state.slots.some(x=>x.id===state.slot&&x.disponiveis>0)){
   state.slot=null
   $('gf-slot-hint').textContent='Esse horário acabou de ficar indisponível. Escolha outro.'
  }
  if(!preview&&!data.disponivel){
   $('gf-loading').hidden=true;$('gf-fada-form').hidden=true;$('gf-closed').hidden=false
   return
  }
  if(preview){
   $('gf-preview').hidden=false
   $('gf-submit').disabled=true
   $('gf-submit').textContent='Prévia: envio desativado'
  }
  $('gf-loading').hidden=true;$('gf-closed').hidden=true;$('gf-fada-form').hidden=false
 }finally{
  if(sequence===state.requestSeq){state.loading=false;renderSlots()}
 }
}
async function changeAgenda(nextCount,nextDay,nextPeriod=state.period){
 if(state.submitting)return
 state.count=nextCount;state.day=nextDay
 state.period=nextDay==='2026-12-13'?'morning':nextPeriod
 state.slot=null;state.expanded=false
 $('gf-slot-hint').textContent='O horário será solicitado quando você enviar o formulário.'
 renderStudents();clearError()
 try{await loadSlots()}catch(error){notify(error.message||'Falha ao consultar a agenda.')}
}
function studentsData(){
 return [...document.querySelectorAll('[data-student-name]')].map(input=>({
  nome:input.value.trim(),turma:''
 }))
}
function validate(){
 const alunos=studentsData()
 if(alunos.length!==state.count||alunos.some(x=>x.nome.length<3||x.nome.length>120))
  throw new Error('Preencha o nome completo de cada aluno da sua família.')
 if(!state.slot||!state.slots.some(x=>x.id===state.slot&&x.disponiveis>0))
  throw new Error('Escolha um horário disponível para sua família.')
 const nome=$('gf-responsavel').value.trim()
 const whatsapp=$('gf-whatsapp').value.replace(/\D/g,'')
 if(nome.length<5)throw new Error('Preencha seu nome e sobrenome.')
 if(whatsapp.length<10||whatsapp.length>13)
  throw new Error('Informe um WhatsApp válido com DDD.')
 const pagamento=document.querySelector('input[name="pagamento"]:checked')?.value
 if(!pagamento)throw new Error('Informe se já pagou pelas fotos.')
 if(!$('gf-consent').checked)throw new Error('Aceite os termos e a política de privacidade.')
 return {alunos,nome,whatsapp,pagamento}
}
function submissionToken(){
 let token=sessionStorage.getItem('gf_natal_submission_id')
 if(!token){token=crypto.randomUUID();sessionStorage.setItem('gf_natal_submission_id',token)}
 return token
}
async function submit(event){
 event.preventDefault();clearError()
 if(preview){notify('Esta é uma prévia. Nenhuma inscrição foi enviada.');return}
 if(state.submitting)return
 let payload
 try{
  const input=validate()
  if($('gf-website').value.trim())throw new Error('Solicitação não aceita.')
  payload={
   horario_id:state.slot,nome:input.nome,whatsapp:input.whatsapp,email:'',
   alunos:input.alunos,pagamento:input.pagamento,meio_pagamento:'',
   data_pagamento:null,familia:'',observacao:'',
   idempotencia:submissionToken(),aceite:true,company_website:''
  }
 }catch(error){notify(error.message);return}
 const button=$('gf-submit')
 state.submitting=true;button.disabled=true;button.textContent='Enviando solicitação...'
 renderSlots()
 try{
  const result=await api('natal_inscrever',payload)
  $('gf-fada-form').hidden=true;$('gf-success').hidden=false
  $('gf-ref').textContent=result.codigo
  $('gf-success-message').textContent=result.ja_pago_declarado
   ?'Você informou que já pagou. Não pague novamente. Nossa equipe vai conferir e confirmar pelo WhatsApp.'
   :'Recebemos seu pedido! Nossa equipe enviará as instruções de pagamento e confirmará o horário pelo WhatsApp.'
  sessionStorage.removeItem('gf_natal_submission_id')
  $('gf-success').scrollIntoView({block:'start'})
 }catch(error){
  if(error.name==='TimeoutError'){
   notify('A conexão demorou. Antes de reenviar, confira sua solicitação com a Grand Focus.')
  }else if(error.status===409){
   notify('O horário ficou indisponível ou algum dado precisa ser revisto. Confira as opções abaixo.')
  }else notify('Não foi possível enviar: '+error.message)
  try{await loadSlots()}catch{}
 }finally{
  state.submitting=false
  if(!$('gf-fada-form').hidden){
   button.disabled=false;button.textContent='Solicitar meu horário';renderSlots()
  }
 }
}
document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',
 ()=>void changeAgenda(Number(btn.dataset.count),state.day)))
document.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',
 ()=>void changeAgenda(state.count,btn.dataset.day)))
document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',
 ()=>void changeAgenda(state.count,state.day,btn.dataset.period)))
document.querySelectorAll('input[name="pagamento"]').forEach(input=>
 input.addEventListener('change',clearError))
$('gf-fada-form').addEventListener('submit',submit)
renderStudents()
setInterval(()=>{
 if(!state.loading&&!state.submitting&&!document.hidden&&!$('gf-fada-form').hidden){
  void loadSlots().catch(()=>{})
 }
},30000)
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&!state.submitting)void loadSlots().catch(()=>{})
})
loadSlots().catch(error=>{
 $('gf-loading').hidden=true;$('gf-closed').hidden=false
 $('gf-closed').textContent=error.message||'Não foi possível consultar a agenda.'
})
