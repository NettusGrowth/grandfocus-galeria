// Gente que Dança · 15/12/2026 · horários fixos 18h–22h.
// O clique num horário não reserva; o servidor confirma os blocos no envio.
const API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-publica'
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const SLUG='gente-que-danca-2026'
const $=id=>document.getElementById(id)
let count=1,submitting=false,open=false,loading=false,chosen=null,available=[],requestSeq=0
let expanded=false
const price=n=>15000+(n-1)*12000
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
 $('discount-caption').textContent=count*15+' minutos de ensaio'+(count>1?' · desconto de '+money((count-1)*3000):'')
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
  const p=document.createElement('p');p.className='hint';p.textContent='Consultando horários disponíveis...';root.append(p);return
 }
 if(!available.length){
  const p=document.createElement('p');p.className='hint'
  p.textContent='Não há horários disponíveis para essa quantidade. Fale com a Grand Focus.'
  root.append(p);return
 }
 const ids=expanded?available.map(x=>x.id):[
  available[0]?.id,available[Math.floor((available.length-1)/2)]?.id,
  available[available.length-1]?.id
 ].filter((id,i,a)=>id&&a.indexOf(id)===i)
 if(chosen&&!ids.includes(chosen))ids.push(chosen)
 for(const slot of available.filter(x=>ids.includes(x.id))){
  const b=document.createElement('button')
  b.type='button';b.className='time-option'
  b.disabled=submitting
  b.dataset.slotId=slot.id
  b.textContent=slot.inicio+' – '+slot.fim
  b.setAttribute('aria-pressed',String(slot.id===chosen))
  b.setAttribute('aria-label','Início às '+slot.inicio+' e término às '+slot.fim)
  b.addEventListener('click',()=>{
   if(submitting)return
   chosen=slot.id;clearError()
   $('gente-schedule-hint').textContent='Selecionado: '+slot.inicio+' às '+slot.fim+
    '. Seu horário será reservado ao enviar.'
   drawTimes()
  })
  root.append(b)
 }
 if(available.length>3){
  const more=document.createElement('button');more.type='button';more.className='times-more'
  more.textContent=expanded?'Mostrar menos horários':'Ver todos os horários livres'
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
 if(tel.length<10||tel.length>13){alertField(phone,'Informe o WhatsApp com DDD.');return null}
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
  $('schedule-success-detail').textContent='Horário: '+result.inicio+' às '+result.fim+
   ' · '+count+' bailarino(a)(s) · Total '+money(result.valor_centavos)
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
  button.textContent='Reservar horário e enviar inscrição'
  drawTimes()
 }
}
document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',()=>{
 if(submitting)return
 const n=Number(btn.dataset.count);if(n===count)return
 count=n;chosen=null;expanded=false
 $('gente-schedule-hint').textContent='Selecione o início do horário para '+count+' bailarino(a)(s).'
 draw();clearError();void loadTimes()
}))
$('gente-form').addEventListener('submit',send)
document.addEventListener('input',e=>{if(e.target.closest('#gente-form'))clearError()})
draw()
void loadTimes()
setInterval(()=>{if(open&&!submitting&&!loading&&!document.hidden)void loadTimes(true)},30000)
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&!submitting)void loadTimes(true)
})
