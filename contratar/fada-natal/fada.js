// Natal Fada Açucarada 2026: inscrição única por família.
// Não usa nem habilita checkout. O banco calcula valores e trava vagas em transação.
const SLUG='natal-fada-acucarada-2026'
const URL_API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-publica'
const URL_ADMIN='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-admin'
const SUPABASE_URL='https://selnsjtumkxjrtnqofqx.supabase.co'
const PUBLIC_KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const preview=new URLSearchParams(location.search).get('preview')==='1'
const prices=Object.freeze({1:8000,2:14500,3:21500,4:28500})
const state={day:'2026-12-12',count:1,slot:null,slots:[],preview}
const $=id=>document.getElementById(id)
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)
function notify(message){
 const target=$('gf-error')
 target.textContent=message
 target.hidden=false
 target.scrollIntoView({block:'center',behavior:'auto'})
}
function clearError(){$('gf-error').hidden=true}
function field(label,id,placeholder=''){
 const wrapper=document.createElement('label')
 wrapper.textContent=label
 const input=document.createElement('input')
 input.id=id;input.type='text';input.maxLength=120;input.required=true;input.placeholder=placeholder
 wrapper.append(input)
 return wrapper
}
function renderStudents(){
 const root=$('gf-students')
 const old=[...root.querySelectorAll('.gf-student')].map(el=>({
   name:el.querySelector('[data-student-name]')?.value||'',
   className:el.querySelector('[data-student-class]')?.value||''
 }))
 root.replaceChildren()
 for(let i=0;i<state.count;i++){
   const card=document.createElement('div');card.className='gf-student'
   const h=document.createElement('h3');h.textContent='Aluno '+(i+1)
   const grid=document.createElement('div');grid.className='gf-fields'
   const name=field('Nome completo do aluno *','gf-aluno-'+i,'Nome da bailarina ou do bailarino')
   const turma=field('Turma (se souber)','gf-turma-'+i,'Opcional')
   const nameInput=name.querySelector('input');nameInput.dataset.studentName=''
   const turmaInput=turma.querySelector('input');turmaInput.dataset.studentClass='';turmaInput.required=false;turmaInput.maxLength=80
   nameInput.value=old[i]?.name||'';turmaInput.value=old[i]?.className||''
   grid.append(name,turma);card.append(h,grid);root.append(card)
 }
 $('gf-total').textContent=money(prices[state.count])
 for(const btn of document.querySelectorAll('[data-count]'))btn.setAttribute('aria-pressed',String(Number(btn.dataset.count)===state.count))
 updateRecap()
}
function availability(){
 return state.slots.filter(x=>x.dia===state.day&&x.ativo)
}
function renderSlots(){
 const root=$('gf-slots');root.replaceChildren()
 const slots=availability()
 if(!slots.length){
   const p=document.createElement('p');p.className='gf-slots-empty'
   p.textContent='Ainda não há horários disponíveis neste dia. Escolha outra data ou consulte a Grand Focus.'
   root.append(p)
   state.slot=null
 }else{
   if(!slots.some(x=>x.id===state.slot&&x.disponiveis>0))state.slot=null
   for(const slot of slots){
     const btn=document.createElement('button');btn.type='button';btn.textContent=slot.inicio
     btn.disabled=slot.disponiveis<1
     btn.setAttribute('aria-pressed',String(slot.id===state.slot))
     btn.setAttribute('aria-label',slot.inicio+(slot.disponiveis<1?', esgotado':', disponível'))
     btn.title=slot.disponiveis<1?'Horário esgotado':'Selecionar '+slot.inicio
     btn.addEventListener('click',()=>{state.slot=slot.id;renderSlots();updateRecap();clearError()})
     root.append(btn)
   }
 }
 for(const btn of document.querySelectorAll('[data-day]'))btn.setAttribute('aria-pressed',String(btn.dataset.day===state.day))
 updateRecap()
}
function updateRecap(){
 const root=$('gf-recap');root.replaceChildren()
 const slot=state.slots.find(x=>x.id===state.slot)
 const payment=document.querySelector('input[name="pagamento"]:checked')?.value||''
 const rows=[
  ['Experiência',state.count+' aluno(s) • 10 fotos por aluno'],
  ['Valor da família',money(prices[state.count])],
  ['Dia e horário',slot?(slot.dia==='2026-12-12'?'Sábado, 12/12':'Domingo, 13/12')+' às '+slot.inicio:'Selecione um horário'],
  ['Pagamento',payment==='ja_paguei'?'Declarado pago · conferência pendente':payment==='a_pagar'?'Ainda não realizado':'Escolha a situação']
 ]
 for(const [name,value] of rows){
   const box=document.createElement('div')
   const label=document.createElement('span');label.textContent=name
   const content=document.createElement('strong');content.textContent=value
   box.append(label,content);root.append(box)
 }
}
async function api(action,values={},admin=false){
 const headers={'Content-Type':'application/json',apikey:PUBLIC_KEY}
 if(admin){
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2')
  const supa=createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}})
  const {data}=await supa.auth.getSession()
  const access=data?.session?.access_token
  if(!access)throw new Error('Entre na administração da Grand Focus para visualizar a prévia.')
  headers.Authorization='Bearer '+access
 }
 const response=await fetch(admin?URL_ADMIN:URL_API,{
  method:'POST',headers,
  body:JSON.stringify(admin?{action,slug:SLUG,...values}:{action,campaign_slug:SLUG,...values}),
  signal:AbortSignal.timeout(17000)
 })
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(data.error||'Não foi possível comunicar com o serviço. Tente novamente.')
 return data
}
function studentsData(){
 return [...document.querySelectorAll('.gf-student')].map(el=>({
  nome:el.querySelector('[data-student-name]').value.trim(),
  turma:el.querySelector('[data-student-class]').value.trim()
 }))
}
function validate(){
 const pagamento=document.querySelector('input[name="pagamento"]:checked')?.value
 if(!pagamento)throw new Error('Informe se já realizou o pagamento.')
 const alunos=studentsData()
 if(alunos.length!==state.count||alunos.some(a=>a.nome.length<3||a.nome.length>120))throw new Error('Preencha o nome completo de cada aluno.')
 if(!state.slot||!state.slots.some(x=>x.id===state.slot&&x.ativo&&x.disponiveis>0))throw new Error('Selecione um horário disponível para a família.')
 const responsavel=$('gf-responsavel').value.trim()
 const whatsapp=$('gf-whatsapp').value.replace(/\D/g,'')
 const email=$('gf-email').value.trim()
 if(responsavel.length<5)throw new Error('Informe nome e sobrenome do responsável.')
 if(whatsapp.length<10||whatsapp.length>13)throw new Error('Informe um WhatsApp válido, com DDD.')
 if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180))throw new Error('Revise o endereço de e-mail.')
 if(!$('gf-consent').checked)throw new Error('Confirme a autorização para contato e organização do agendamento.')
 return {pagamento,alunos,responsavel,whatsapp,email}
}
async function submit(event){
 event.preventDefault();clearError()
 if(preview){notify('Essa é uma prévia. Nenhuma inscrição foi enviada.');return}
 const button=$('gf-submit')
 let payload
 try{
  const data=validate()
  if($('gf-website').value.trim())throw new Error('Solicitação não aceita.')
  let idempotencia=sessionStorage.getItem('gf_natal_submission_id')
  if(!idempotencia){idempotencia=crypto.randomUUID();sessionStorage.setItem('gf_natal_submission_id',idempotencia)}
  payload={
   horario_id:state.slot,nome:data.responsavel,whatsapp:data.whatsapp,email:data.email,
   alunos:data.alunos,pagamento:data.pagamento,meio_pagamento:$('gf-paid-method').value,
   data_pagamento:$('gf-paid-date').value||null,
   familia:[...document.querySelectorAll('#gf-family-options input:checked')].map(x=>x.value).join(', '),
   observacao:$('gf-note').value.trim(),idempotencia,aceite:true,
   company_website:$('gf-website').value
  }
 }catch(error){notify(error.message);return}
 button.disabled=true;button.textContent='Registrando solicitação…'
 try{
  const result=await api('natal_inscrever',payload)
  $('gf-fada-form').hidden=true
  $('gf-success').hidden=false
  $('gf-ref').textContent=result.codigo
  $('gf-success-message').textContent=result.ja_pago_declarado
   ?'Você informou que já pagou. Não realize outro pagamento. Nossa equipe conferirá e confirmará o horário por WhatsApp.'
   :'Seu horário foi solicitado. A Grand Focus enviará as orientações de pagamento e confirmará o agendamento depois de identificar o recebimento.'
  $('gf-success').scrollIntoView({block:'start'})
  sessionStorage.removeItem('gf_natal_submission_id')
 }catch(error){
  notify(error.name==='TimeoutError'?'A conexão demorou. Confira com a equipe antes de enviar outra solicitação.':'Não foi possível enviar: '+error.message)
  // A mesma chave evita que uma nova tentativa gere inscrição duplicada.
  button.disabled=false;button.textContent='Solicitar meu horário'
  await loadSlots().catch(()=>{})
 }
}
async function loadSlots(){
 const data=preview?await api('natal_agenda',{},true):await api('natal_horarios')
 state.slots=Array.isArray(data.horarios)?data.horarios:[]
 if(!preview&&!data.disponivel){
  $('gf-closed').hidden=false;$('gf-fada-form').hidden=true
  $('gf-loading').hidden=true;return
 }
 if(preview){$('gf-preview').hidden=false;$('gf-submit').disabled=true;$('gf-submit').textContent='Prévia: inscrição desativada'}
 $('gf-loading').hidden=true;$('gf-closed').hidden=true;$('gf-fada-form').hidden=false
 renderSlots()
}
document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',()=>{state.count=Number(btn.dataset.count);renderStudents();clearError()}))
document.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',()=>{state.day=btn.dataset.day;state.slot=null;renderSlots();clearError()}))
document.querySelectorAll('input[name="pagamento"]').forEach(input=>input.addEventListener('change',()=>{
 $('gf-paid-details').hidden=input.value!=='ja_paguei' || !input.checked
 updateRecap();clearError()
}))
$('gf-letters').addEventListener('click',()=>{
 const active=document.body.classList.toggle('gf-large')
 $('gf-letters').setAttribute('aria-pressed',String(active))
 $('gf-letters').textContent=active?'A− Tamanho normal':'A+ Aumentar letras'
})
$('gf-fada-form').addEventListener('submit',submit)
renderStudents()
loadSlots().catch(error=>{$('gf-loading').hidden=true;$('gf-closed').hidden=false;$('gf-closed').textContent=error.message||'Não foi possível consultar a agenda.'})
