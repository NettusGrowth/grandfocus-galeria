// Gente que Dança · 15/12/2026 · horários fixos 18h–22h.
// O clique num horário não reserva; o servidor confirma os blocos no envio.
const API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-publica'
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const SLUG='gente-que-danca-2026'
const $=id=>document.getElementById(id)
let count=1,submitting=false,open=false,loading=false,chosen=null,available=[],requestSeq=0
let expanded=false
// Oferta pública Natal 2026: somente 1 ou 2 bailarinos. Cadastros antigos
// e função histórica do banco permanecem inalterados.
const price=n=>n===2?27000:15000
const scheduleEnd=22*60
const scheduleStart=18*60
const formatTime=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')
function maskWhatsapp(value){
 let digits=String(value||'').replace(/\D/g,'')
 if(digits.startsWith('55')&&digits.length>11)digits=digits.slice(2)
 digits=digits.slice(0,11)
 if(!digits)return ''
 if(digits.length<=2)return '('+digits
 const ddd='('+digits.slice(0,2)+')'
 const tail=digits.slice(2)
 if(tail.length<=4)return ddd+' '+tail
 if(tail.length<=8 && digits.length<=10)
  return ddd+' '+tail.slice(0,4)+'-'+tail.slice(4)
 if(tail.length<=5)return ddd+' '+tail
 if(tail.length<=9)return ddd+' '+tail.slice(0,5)+'-'+tail.slice(5)
 return ddd+' '+tail.slice(0,5)+'-'+tail.slice(5,9)
}
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)
function alertField(el,message){
 $('form-error').textContent=message;$('form-error').hidden=false
 document.querySelectorAll('.question.invalid').forEach(x=>x.classList.remove('invalid'))
 if(el){
  const q=el.closest('.question')
  if(q){q.classList.add('invalid');q.scrollIntoView({block:'center',behavior:'smooth'})}
  el.focus({preventScroll:true})
 }else $('form-error').scrollIntoView({block:'center',behavior:'smooth'})
}
function clearError(){
 $('form-error').hidden=true
 document.querySelectorAll('.question.invalid').forEach(x=>x.classList.remove('invalid'))
}
function draw(){
 const root=$('students')
 const values=[...root.querySelectorAll('input')].map(x=>x.value)
 root.replaceChildren()
 for(let i=0;i<count;i++){
  const label=document.createElement('label')
  label.className='student-label'
  label.textContent=count===1?'Nome completo do(a) bailarino(a) *':'Nome completo do(a) bailarino(a) '+(i+1)+' *'
  const input=document.createElement('input')
  input.id='student-'+i;input.type='text';input.maxLength=120;input.required=true
  input.placeholder='Nome e sobrenome';input.value=values[i]||''
  input.autocomplete='off'
  label.append(input);root.append(label)
 }
 for(const b of document.querySelectorAll('[data-count]'))
  b.setAttribute('aria-pressed',String(Number(b.dataset.count)===count))
 $('total').textContent=money(price(count))
 $('discount-caption').textContent=count*15+' minutos de ensaio'+(count===2?' · R$ 30 de desconto para irmãos':'')
 $('gente-duration').textContent=count===2
  ?'2 bailarinos(as) · 30 minutos consecutivos'
  :'1 bailarino(a) · 15 minutos de atendimento'
}
async function api(action,extra={}){
 const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},
  body:JSON.stringify({action,campaign_slug:SLUG,...extra}),signal:AbortSignal.timeout(18000)})
 const data=await res.json().catch(()=>({}))
 if(!res.ok){const e=new Error(data.error||'Não foi possível consultar o sistema.');e.status=res.status;throw e}
 return data
}
function drawTimes(){
 const root=$('gente-times');root.replaceChildren()
 if(loading){
  const p=document.createElement('p');p.className='hint schedule-loading'
  p.textContent='Consultando horários disponíveis...';root.append(p);return
 }
 if(!available.length){
  const p=document.createElement('p');p.className='schedule-empty'
  p.textContent='Não há horários disponíveis para este atendimento. Fale com a Grand Focus pelo WhatsApp.'
  root.append(p);return
 }
 // O servidor é a ÚNICA fonte de disponibilidade. A grade completa é
 // visualização, nunca uma segunda lógica de ocupação.
 const ids=expanded?available.map(s=>s.id):[
  available[0]?.id,available[Math.floor((available.length-1)/2)]?.id,available.at(-1)?.id
 ].filter((id,i,arr)=>id&&arr.indexOf(id)===i)
 if(chosen&&!ids.includes(chosen))ids.push(chosen)
 const displayed=expanded
  ?Array.from({length:(scheduleEnd-scheduleStart)/15},(_,i)=>{
    const start=formatTime(scheduleStart+i*15)
    return {start,slot:available.find(s=>s.inicio===start)||null}
   })
  :available.filter(slot=>ids.includes(slot.id)).map(slot=>({start:slot.inicio,slot}))
 for(const entry of displayed){
  const slot=entry.slot
  const b=document.createElement('button')
  b.type='button';b.className='time-option';b.dataset.time=entry.start
  b.disabled=submitting||!slot
  if(slot){
   b.dataset.slotId=slot.id
   b.textContent=slot.inicio+' – '+slot.fim
   b.setAttribute('aria-pressed',String(slot.id===chosen))
   b.setAttribute('aria-label','Início às '+slot.inicio+' e término às '+slot.fim)
   b.addEventListener('click',()=>{
    if(submitting)return
    chosen=slot.id;clearError()
    $('gente-schedule-hint').textContent='Selecionado: '+slot.inicio+' às '+slot.fim+
     '. Sua solicitação será enviada à Grand Focus ao concluir.'
    drawTimes()
   })
  }else{
   b.textContent=entry.start+' · indisponível'
   b.setAttribute('aria-label','Horário '+entry.start+' indisponível para este atendimento')
   b.setAttribute('aria-pressed','false')
  }
  root.append(b)
 }
 if(available.length>3){
  const more=document.createElement('button');more.type='button'
  more.className='times-more'
  more.textContent=expanded?'Mostrar menos horários':'Ver todos os horários, inclusive indisponíveis'
  more.disabled=submitting
  more.addEventListener('click',()=>{expanded=!expanded;drawTimes()})
  root.append(more)
 }
}
async function loadTimes(silent=false){
 const seq=++requestSeq
 if(!silent){loading=true;drawTimes()}
 try{
  const data=await api('gente_horarios',{quantidade:count})
  if(seq!==requestSeq)return
  open=data?.disponivel===true
  available=Array.isArray(data?.horarios)?data.horarios:[]
  if(chosen&&!available.some(x=>x.id===chosen)){
   chosen=null
   $('gente-schedule-hint').textContent='Esse horário ficou indisponível. Escolha outro livre.'
  }
  $('closed').hidden=open
  $('gente-form').hidden=!open
 }catch(e){
  if(seq!==requestSeq)return
  if(!silent||!open){
   $('closed').hidden=false
   $('closed').textContent='Não foi possível consultar a agenda. Atualize a página ou entre em contato com a Grand Focus.'
   $('gente-form').hidden=true;open=false
  }
 }finally{
  if(seq===requestSeq){loading=false;drawTimes()}
 }
}
function token(){
 let x=sessionStorage.getItem('gf_gente_submission_id')
 if(!x){x=crypto.randomUUID();sessionStorage.setItem('gf_gente_submission_id',x)}
 return x
}
function validate(){
 const name=$('name'),phone=$('whatsapp')
 if(name.value.trim().length<5){alertField(name,'Informe o nome completo do responsável.');return null}
 const tel=phone.value.replace(/\D/g,'')
 if(tel.length!==10&&tel.length!==11){alertField(phone,'Informe um WhatsApp válido com DDD.');return null}
 const alunos=[...$('students').querySelectorAll('input')].map(i=>i.value.trim())
 for(let i=0;i<alunos.length;i++)
  if(alunos[i].length<3){alertField($('student-'+i),'Informe o nome completo de cada bailarino(a).');return null}
 if(!chosen||!available.some(s=>s.id===chosen)){
  const target=$('gente-schedule-question');target.tabIndex=-1
  alertField(target,'Escolha um horário para os(as) bailarinos(as) da sua família.');return null
 }
 const pay=document.querySelector('input[name="preferencia"]:checked')
 if(!pay){alertField(document.querySelector('input[name="preferencia"]'),'Escolha como prefere pagar.');return null}
 if(!$('responsibility').checked){alertField($('responsibility'),'Confirme sua responsabilidade pela inscrição.');return null}
 if(!$('accept').checked){alertField($('accept'),'Leia e aceite os Termos e a Política de Privacidade.');return null}
 return {nome:name.value.trim(),whatsapp:tel,alunos:alunos.map(nome=>({nome,turma:''})),
  preferencia:pay.value,horario_id:chosen}
}
async function send(ev){
 ev.preventDefault();if(submitting)return
 clearError()
 if(!open){alertField(null,'As inscrições não estão disponíveis neste momento.');return}
 if($('website').value.trim())return
 const data=validate();if(!data)return
 submitting=true
 const button=$('submit');button.disabled=true;button.textContent='Registrando horário...'
 drawTimes()
 try{
  const result=await api('gente_inscrever',{...data,idempotencia:token(),aceite:true,company_website:''})
  sessionStorage.removeItem('gf_gente_submission_id')
  $('gente-form').hidden=true
  $('reference').textContent=result.codigo
  const previousSlot=available.find(slot=>slot.id===chosen)
  const end=result.fim||previousSlot?.fim||'a confirmar pela equipe'
  $('schedule-success-detail').textContent='Horário solicitado: '+result.inicio+' às '+end+
   ' · '+count+' bailarino(a)(s) · Valor '+money(result.valor_centavos)
  $('success').hidden=false
  $('success').scrollIntoView({block:'start',behavior:'smooth'})
 }catch(error){
  if(error.name==='TimeoutError'){
   alertField(null,'A conexão demorou. Confira com a Grand Focus antes de tentar novamente.')
  }else if(error.status===409){
   alertField(null,error.message||'Esse horário não está mais livre. Escolha outro.')
  }else alertField(null,error.message||'Não foi possível registrar o horário.')
  await loadTimes(true)
 }finally{
  submitting=false;button.disabled=false
  button.textContent='Solicitar horário e continuar'
  drawTimes()
 }
}
document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',()=>{
 if(submitting)return
 const n=Number(btn.dataset.count)
 if(![1,2].includes(n)||n===count)return
 count=n;chosen=null;expanded=false
 $('gente-schedule-hint').textContent=count===2
  ?'Escolha um início para os dois bailarinos. O sistema reservará 30 minutos consecutivos.'
  :'Escolha um início para o ensaio de 15 minutos.'
 draw();clearError();void loadTimes()
}))
$('gente-form').addEventListener('submit',send)
$('whatsapp').addEventListener('input',event=>{
 const field=event.currentTarget
 field.value=maskWhatsapp(field.value)
})
document.addEventListener('input',e=>{if(e.target.closest('#gente-form'))clearError()})
draw()
void loadTimes()
setInterval(()=>{if(open&&!submitting&&!loading&&!document.hidden)void loadTimes(true)},30000)
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&!submitting)void loadTimes(true)
})
