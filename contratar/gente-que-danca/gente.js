const API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/contratacao-publica'
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const SLUG='gente-que-danca-2026'
const $=id=>document.getElementById(id)
let count=1,submitting=false,open=false
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)
function alertField(el,message){
 $('form-error').textContent=message;$('form-error').hidden=false
 if(el){
  const q=el.closest('.question')
  if(q){q.classList.add('invalid');q.scrollIntoView({block:'center',behavior:'smooth'})}
  el.focus({preventScroll:true})
 }else $('form-error').scrollIntoView({block:'center',behavior:'smooth'})
}
function clearError(){
 $('form-error').hidden=true
 document.querySelectorAll('.question.invalid').forEach(e=>e.classList.remove('invalid'))
}
function draw(){
 const root=$('students')
 const values=[...root.querySelectorAll('input')].map(x=>x.value)
 root.replaceChildren()
 for(let i=0;i<count;i++){
  const label=document.createElement('label')
  label.className='student-label'
  label.textContent=count===1?'Nome completo da criança *':'Nome completo da criança '+(i+1)+' *'
  const input=document.createElement('input')
  input.id='student-'+i;input.type='text';input.maxLength=120;input.required=true
  input.placeholder='Nome e sobrenome';input.value=values[i]||''
  input.autocomplete='off'
  label.append(input);root.append(label)
 }
 for(const b of document.querySelectorAll('[data-count]'))b.setAttribute('aria-pressed',String(Number(b.dataset.count)===count))
 $('total').textContent=money(count*15000)
}
async function api(action,extra={}){
 const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},
  body:JSON.stringify({action,campaign_slug:SLUG,...extra}),signal:AbortSignal.timeout(20000)})
 const data=await res.json().catch(()=>({}))
 if(!res.ok){const e=new Error(data.error||'Erro ao enviar os dados.');e.status=res.status;throw e}
 return data
}
function token(){
 let x=sessionStorage.getItem('gf_gente_submission_id')
 if(!x){x=crypto.randomUUID();sessionStorage.setItem('gf_gente_submission_id',x)}
 return x
}
function validate(){
 const name=$('name'),phone=$('whatsapp')
 if(name.value.trim().length<5)return alertField(name,'Informe o nome completo do responsável.'),null
 const tel=phone.value.replace(/\D/g,'')
 if(tel.length<10||tel.length>13)return alertField(phone,'Informe o WhatsApp com DDD.'),null
 const alunos=[...$('students').querySelectorAll('input')].map(i=>i.value.trim())
 for(let i=0;i<alunos.length;i++)if(alunos[i].length<3)return alertField($('student-'+i),'Informe o nome completo da criança.'),null
 const checked=document.querySelector('input[name="preferencia"]:checked')
 if(!checked)return alertField(document.querySelector('input[name="preferencia"]'),'Escolha como prefere pagar.'),null
 if(!$('responsibility').checked)return alertField($('responsibility'),'Confirme sua responsabilidade pela inscrição.'),null
 if(!$('accept').checked)return alertField($('accept'),'Leia e aceite os Termos e a Política de Privacidade.'),null
 return {nome:name.value.trim(),whatsapp:tel,alunos:alunos.map(nome=>({nome,turma:''})),preferencia:checked.value}
}
async function send(ev){
 ev.preventDefault();if(submitting)return
 clearError()
 if(!open)return alertField(null,'Inscrições ainda não disponíveis.')
 if($('website').value.trim())return
 const data=validate();if(!data)return
 submitting=true;const button=$('submit')
 button.disabled=true;button.textContent='Enviando...'
 try{
  const result=await api('gente_inscrever',{...data,idempotencia:token(),aceite:true,company_website:''})
  sessionStorage.removeItem('gf_gente_submission_id')
  $('gente-form').hidden=true
  $('reference').textContent=result.codigo
  $('success').hidden=false
  $('success').scrollIntoView({block:'start',behavior:'smooth'})
 }catch(error){
  if(error.name==='TimeoutError'){
   alertField(null,'A conexão demorou. Confira com a Grand Focus antes de reenviar.')
  }else alertField(null,error.message||'Não foi possível registrar sua inscrição.')
 }finally{
  submitting=false;button.disabled=false;button.textContent='Enviar minha inscrição'
 }
}
document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',()=>{
 count=Number(btn.dataset.count);draw();clearError()
}))
$('gente-form').addEventListener('submit',send)
document.addEventListener('input',e=>{if(e.target.closest('#gente-form'))clearError()})
draw()
api('gente_status').then(data=>{
 open=data?.disponivel===true
 if(!open){$('closed').hidden=false;$('gente-form').hidden=true}
}).catch(()=>{
 open=false;$('closed').hidden=false;$('gente-form').hidden=true
 $('closed').textContent='Não foi possível consultar a campanha. Atualize a página ou entre em contato com a Grand Focus.'
})
