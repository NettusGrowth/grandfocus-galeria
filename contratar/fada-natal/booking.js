/* Especial de Natal: inscrição por família, sem checkout e sem pagamento automático. */
const SLUG='natal-fada-acucarada-2026'
const API='https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/'
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0'
const PREVIEW=new URLSearchParams(location.search).get('preview')==='1'
const PRICES={1:8000,2:14500,3:21500,4:28500}
const root=document.getElementById('gf-fada-booking')
const $=id=>document.getElementById(id)
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)
let slots=[],selectedDay='2026-12-12',mode='horario_marcado'
let idempotency=crypto.randomUUID(),busy=false,token=''
async function request(endpoint,action,payload={}){
 const response=await fetch(API+endpoint,{
  method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,...(token?{Authorization:'Bearer '+token}:{})},
  body:JSON.stringify({action,campaign_slug:SLUG,slug:SLUG,...payload}),signal:AbortSignal.timeout(15000)
 })
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(data.error||'Não foi possível carregar as informações.')
 return data
}
function e(tag,cls,txt){const x=document.createElement(tag);if(cls)x.className=cls;if(txt!=null)x.textContent=String(txt);return x}
function warning(text){$('gf-fada-message').textContent=text;$('gf-fada-message').hidden=false}
async function getAdminPreview(){
 const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2')
 const client=createClient('https://selnsjtumkxjrtnqofqx.supabase.co',KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}})
 const {data}=await client.auth.getSession()
 token=data?.session?.access_token||''
 if(!token)throw Error('Faça login como administrador para visualizar esta prévia.')
 return await request('contratacao-admin','natal_agenda')
}
function renderStudents(){
 const count=Number($('gf-fada-count').value)
 const area=$('gf-fada-students')
 const old=[...area.querySelectorAll('.gf-fada-student')].map(block=>({
  nome:block.querySelector('[data-nome]')?.value||'',turma:block.querySelector('[data-turma]')?.value||''
 }))
 area.replaceChildren()
 for(let i=0;i<count;i++){
  const field=e('fieldset','gf-fada-student')
  field.append(e('legend','','Aluno '+(i+1)))
  const label=e('label','','Nome do aluno *'),name=document.createElement('input')
  name.dataset.nome='1';name.required=true;name.maxLength=120;name.placeholder='Nome e sobrenome';name.value=old[i]?.nome||''
  label.append(name)
  const label2=e('label','','Turma (opcional)'),klass=document.createElement('input')
  klass.dataset.turma='1';klass.maxLength=80;klass.placeholder='Se souber';klass.value=old[i]?.turma||''
  label2.append(klass)
  field.append(label,label2);area.append(field)
 }
 $('gf-fada-total').textContent=money(PRICES[count])
 $('gf-fada-price-note').textContent=count+' aluno(s) • 10 fotografias temáticas por aluno • um horário para a família inteira.'
}
function paymentBranch(){
 const paid=root.querySelector('input[name="fada_pagamento"]:checked')?.value==='ja_paguei'
 $('gf-fada-paid-details').hidden=!paid
 $('gf-fada-payment-help').textContent=paid?
 'Não pague novamente. A equipe verificará o recebimento antes de confirmar sua participação.':
 'Não haverá cobrança nesta tela. Nossa equipe enviará as orientações para pagar antecipadamente e confirmar a vaga.'
}
function renderSlots(){
 const area=$('gf-fada-slots');area.replaceChildren()
 if(mode!=='horario_marcado'){
  area.append(e('p','gf-fada-hint','A equipe informará o atendimento por ordem de chegada.'))
  return
 }
 const daily=slots.filter(x=>x.dia===selectedDay&&x.ativo!==false)
 if(!daily.length){area.append(e('p','gf-fada-hint','Ainda não há horários cadastrados neste dia.'));return}
 const grid=e('div','gf-fada-slot-grid')
 for(const slot of daily){
  const available=Number(slot.disponiveis)>0
  const label=e('label','gf-fada-slot')
  label.dataset.available=String(available)
  const input=document.createElement('input')
  input.type='radio';input.name='fada_horario';input.value=slot.id;input.disabled=!available
  label.append(input,e('span','',slot.inicio),e('small','',available?'Disponível':'Esgotado'))
  grid.append(label)
 }
 area.append(grid)
}
function renderDays(){
 const area=$('gf-fada-days');area.replaceChildren()
 area.hidden=mode!=='horario_marcado'
 if(mode!=='horario_marcado'){renderSlots();return}
 for(const day of ['2026-12-12','2026-12-13']){
  const available=slots.filter(s=>s.dia===day&&s.ativo!==false&&Number(s.disponiveis)>0).length
  const button=e('button','gf-fada-day',day.endsWith('-12')?'Sábado, 12 de dezembro':'Domingo, 13 de dezembro')
  button.type='button';button.dataset.day=day;button.setAttribute('aria-pressed',String(day===selectedDay))
  button.append(e('small','',available+' vaga(s) livres'))
  button.addEventListener('click',()=>{
   selectedDay=day
   for(const b of area.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.day===day))
   renderSlots()
  })
  area.append(button)
 }
 renderSlots()
}
function render(){
 root.innerHTML=[
 '<section class="gf-fada-intro"><span class="gf-fada-eyebrow">FADA AÇUCARADA · GRAND FOCUS</span><h2>Especial Fotográfico de Natal</h2>',
 '<p>12 e 13 de dezembro de 2026 · Rua Santa Iria, 736, Centro, Ibaté/SP.</p>',
 '<p>10 fotografias temáticas por aluno: retratos com figurino, fotografias com a família e cenário de Natal.</p></section>',
 '<p class="gf-fada-preview" id="gf-fada-preview" hidden>Prévia administrativa. Nenhum cadastro, reserva ou pagamento será realizado.</p>',
 '<form id="gf-fada-form" class="gf-fada-form" novalidate>',
 '<fieldset class="gf-fada-panel"><legend>1. Você já realizou o pagamento das fotografias? *</legend>',
 '<p class="gf-fada-hint">Essa informação evita cobranças duplicadas.</p>',
 '<label class="gf-fada-choice"><input type="radio" name="fada_pagamento" value="ja_paguei" required><span><strong>Sim, já realizei o pagamento</strong><small>A equipe conferirá o pagamento anterior.</small></span></label>',
 '<label class="gf-fada-choice"><input type="radio" name="fada_pagamento" value="a_pagar" required><span><strong>Ainda não, quero contratar</strong><small>Receberei orientações para pagamento antecipado.</small></span></label>',
 '<p class="gf-fada-hint" id="gf-fada-payment-help">A declaração não equivale à confirmação de pagamento.</p>',
 '<div id="gf-fada-paid-details" class="gf-fada-paid-fields" hidden><label>Como você pagou?<select id="gf-fada-method"><option value="nao_sei">Não lembro / outro</option><option value="pix">Pix</option><option value="credito">Cartão de crédito</option><option value="outro">Outro meio</option></select></label>',
 '<label>Data aproximada (opcional)<input id="gf-fada-paid-date" type="date"></label></div></fieldset>',
 '<section class="gf-fada-panel"><h3>2. Quantos alunos da mesma família participarão?</h3>',
 '<label for="gf-fada-count">Quantidade de alunos *</label><select id="gf-fada-count"><option value="1">1 aluno · R$ 80,00</option><option value="2">2 alunos · R$ 145,00</option><option value="3">3 alunos · R$ 215,00</option><option value="4">4 alunos · R$ 285,00</option></select>',
 '<div class="gf-fada-students" id="gf-fada-students"></div>',
 '<div class="gf-fada-total"><span>Total da experiência</span><strong id="gf-fada-total">R$ 80,00</strong></div><p id="gf-fada-price-note" class="gf-fada-hint"></p></section>',
 '<section class="gf-fada-panel gf-fada-fields"><h3>3. Dados do responsável</h3>',
 '<label>Nome completo *<input id="gf-fada-name" autocomplete="name" required minlength="5" maxlength="120" placeholder="Nome e sobrenome"></label>',
 '<label>WhatsApp com DDD *<input id="gf-fada-phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="(16) 99999-9999"></label>',
 '<label>E-mail (opcional)<input id="gf-fada-email" type="email" maxlength="180" autocomplete="email"></label>',
 '<label>Quem participará das fotos em família? (opcional)<input id="gf-fada-family" maxlength="250" placeholder="Mãe, pai, irmãos..."></label>',
 '<label>Observações (opcional)<textarea id="gf-fada-notes" maxlength="1000" rows="3"></textarea></label></section>',
 '<section class="gf-fada-panel"><h3>4. Escolha o dia e o horário</h3>',
 '<p class="gf-fada-hint">Uma vaga é para a família inteira. O horário será confirmado após a conferência do pagamento.</p>',
 '<div id="gf-fada-days" class="gf-fada-days" role="group" aria-label="Dias disponíveis"></div>',
 '<div id="gf-fada-slots" aria-label="Horários disponíveis"></div>',
 '<button id="gf-fada-refresh" class="gf-fada-refresh" type="button">Atualizar horários</button></section>',
 '<section class="gf-fada-panel"><label class="gf-fada-consent"><input id="gf-fada-consent" type="checkbox" required><span>Confirmo que sou responsável pela inscrição e autorizo que a Grand Focus utilize estes dados para organizar a sessão, conferir o pagamento e me contatar sobre o agendamento. *</span></label>',
 '<p class="gf-fada-hint">Esta declaração não autoriza o uso publicitário das fotografias.</p>',
 '<div class="gf-fada-honey" aria-hidden="true"><input id="gf-fada-honey" tabindex="-1" autocomplete="off"></div>',
 '<p class="gf-fada-message" id="gf-fada-message" role="status" aria-live="polite" hidden></p>',
 '<button id="gf-fada-submit" class="gf-fada-submit" type="submit">Solicitar meu horário</button></section></form>',
 '<section id="gf-fada-success" class="gf-fada-success" hidden role="status" aria-live="polite"></section>'
 ].join('')
 $('gf-fada-count').addEventListener('change',renderStudents)
 for(const radio of root.querySelectorAll('input[name="fada_pagamento"]'))radio.addEventListener('change',paymentBranch)
 $('gf-fada-refresh').addEventListener('click',refresh)
 $('gf-fada-form').addEventListener('submit',submit)
 renderStudents();renderDays()
 if(PREVIEW){
  $('gf-fada-preview').hidden=false
  $('gf-fada-submit').disabled=true
  $('gf-fada-submit').textContent='Prévia — sem enviar cadastro'
 }
}
async function refresh(){
 const btn=$('gf-fada-refresh');btn.disabled=true
 try{
  const data=PREVIEW?await request('contratacao-admin','natal_agenda'):await request('contratacao-publica','natal_horarios')
  slots=Array.isArray(data.horarios)?data.horarios:[]
  mode=data.modo_agendamento||mode
  renderDays()
 }catch(error){warning(error.message||'Não foi possível carregar os horários.')}
 finally{btn.disabled=false}
}
async function submit(event){
 event.preventDefault()
 if(PREVIEW||busy)return
 const selected=root.querySelector('input[name="fada_horario"]:checked')
 const pay=root.querySelector('input[name="fada_pagamento"]:checked')
 if(!event.currentTarget.reportValidity())return
 if(!pay){warning('Selecione a situação do pagamento.');return}
 if(mode==='horario_marcado'&&!selected){warning('Selecione um horário disponível.');return}
 const phone=$('gf-fada-phone').value.replace(/\D/g,'')
 if(phone.length<10||phone.length>13){warning('Informe WhatsApp com DDD.');return}
 const students=[...root.querySelectorAll('.gf-fada-student')].map(f=>({
  nome:f.querySelector('[data-nome]').value.trim(),turma:f.querySelector('[data-turma]').value.trim()
 }))
 if(students.some(s=>s.nome.length<3)){warning('Preencha o nome de cada aluno.');return}
 busy=true
 const button=$('gf-fada-submit');button.disabled=true;button.textContent='Registrando…'
 try{
  const data=await request('contratacao-publica','natal_inscrever',{
   horario_id:mode==='horario_marcado'?selected?.value:null,
   nome:$('gf-fada-name').value.trim(),
   whatsapp:$('gf-fada-phone').value.trim(),
   email:$('gf-fada-email').value.trim(),
   alunos:students,pagamento:pay.value,
   meio_pagamento:pay.value==='ja_paguei'?$('gf-fada-method').value:'',
   data_pagamento:pay.value==='ja_paguei'?$('gf-fada-paid-date').value||null:null,
   familia:$('gf-fada-family').value.trim(),
   observacao:$('gf-fada-notes').value.trim(),
   idempotencia:idempotency,aceite:$('gf-fada-consent').checked,
   company_website:$('gf-fada-honey').value
  })
  const success=$('gf-fada-success')
  success.replaceChildren()
  success.append(e('h2','','Inscrição recebida!'),
   e('p','','Protocolo: '+(data.codigo||'—')),
   e('p','','Valor da experiência: '+money(Number(data.valor_centavos)||0)),
   e('p','',data.ja_pago_declarado
     ?'Você informou um pagamento anterior. Não pague novamente. A equipe conferirá o recebimento.'
     :'Nenhuma cobrança foi realizada nesta página. A equipe enviará as orientações de pagamento.'),
   e('p','','A escolha do horário ainda depende de confirmação da Grand Focus.'))
  $('gf-fada-form').hidden=true;success.hidden=false
  success.scrollIntoView({block:'start',behavior:'smooth'})
 }catch(error){
  warning(error.message||'Não conseguimos registrar a inscrição.')
  button.disabled=false;button.textContent='Solicitar meu horário'
  if(/horário|vaga/i.test(error.message||''))await refresh()
 }finally{busy=false}
}
export async function startNatal(){
 document.getElementById('contract-form').classList.add('hidden')
 document.querySelector('.hero').hidden=true
 try{
  let data
  if(PREVIEW){
   const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2')
   const supabase=createClient('https://selnsjtumkxjrtnqofqx.supabase.co',KEY,{
     auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
   })
   const result=await supabase.auth.getSession()
   token=result.data?.session?.access_token||''
   if(!token)throw Error('Faça login na administração da Grand Focus para ver a prévia.')
   data=await request('contratacao-admin','natal_agenda')
  }else data=await request('contratacao-publica','natal_horarios')
  document.getElementById('loading-state').classList.add('hidden')
  if(!PREVIEW&&!data.disponivel){
   document.getElementById('closed-state').classList.remove('hidden')
   document.getElementById('closed-message').textContent='O formulário de Natal ainda não está disponível. Aguarde a liberação pela Grand Focus.'
   return
  }
  root.hidden=false;render()
  slots=Array.isArray(data.horarios)?data.horarios:[]
  mode=data.modo_agendamento||mode
  renderDays()
  document.title='Especial Fotográfico de Natal · Fada Açucarada | Grand Focus'
 }catch(error){
  document.getElementById('loading-state').classList.add('hidden')
  document.getElementById('closed-state').classList.remove('hidden')
  document.getElementById('closed-message').textContent=PREVIEW?error.message:'Este formulário ainda não está disponível.'
 }
}
