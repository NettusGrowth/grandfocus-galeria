/* Grand Focus | Experiência de Natal Fada Açucarada.
   A campanha conserva modo próprio: ordem de chegada OU horário marcado.
   Checkout permanece desativado. Nenhuma declaração do cliente confirma pagamento. */
const BASE='https://selnsjtumkxjrtnqofqx.supabase.co';
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0';
const SLUG='natal-fada-acucarada-2026';
const VALUES=[0,8000,14500,21500,28500];
const BRL=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const make=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!=null)e.textContent=String(value);return e;};
const moneyState={slot:null,mode:'horario_marcado',active:false};
async function request(path,body,token=null){
 const headers={'Content-Type':'application/json',apikey:KEY};
 if(token)headers.Authorization='Bearer '+token;
 const res=await fetch(BASE+'/functions/v1/'+path,{
  method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
 });
 const payload=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error(payload.error||'Não foi possível acessar a agenda.');
 return payload;
}
async function adminPreview(){
 const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
 const client=createClient(BASE,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const {data:{session}}=await client.auth.getSession();
 if(!session?.access_token)throw new Error('Entre na área administrativa para visualizar esta prévia.');
 return request('contratacao-admin',{action:'agenda_listar',slug:SLUG},session.access_token);
}
export async function mount({preview=false}={}){
 const shell=document.querySelector('.page-shell');
 shell.querySelector('.hero').classList.add('hidden');
 document.getElementById('loading-state').classList.add('hidden');
 document.getElementById('closed-state').classList.add('hidden');
 document.getElementById('contract-form').classList.add('hidden');
 document.title='Natal Fada Açucarada | Grand Focus Fotografia';
 const area=make('section','gf-natal-public');
 shell.querySelector('.gf-reader-toolbar').after(area);
 area.innerHTML=[
 '<header class="gf-natal-public-hero"><p class="gf-natal-kicker">GRAND FOCUS · ESTÚDIO FADA AÇUCARADA</p>',
 '<h1>Um Natal para guardar na memória.</h1>',
 '<p>12 e 13 de dezembro de 2026 · Ibaté, São Paulo</p>',
 '<p>São 10 fotografias temáticas por aluno, com retratos individuais e registros em família.</p></header>',
 '<div class="gf-natal-price-banner"><span>Uma experiência para toda a família</span>',
 '<strong id="fada-total">R$ 80,00</strong><small id="fada-subtotal">1 aluno · 10 fotografias</small></div>',
 '<p id="fada-status" class="gf-natal-status" role="status" aria-live="polite">Carregando disponibilidade…</p>',
 '<form id="fada-form" novalidate>',
 '<section class="gf-natal-section"><span class="gf-natal-section-number">01 · PAGAMENTO</span>',
 '<h2>Você já pagou pelas fotografias?</h2><p>Se já realizou o pagamento, não precisa pagar novamente. A equipe conferirá a informação.</p>',
 '<div class="gf-natal-radio-list">',
 '<label><input type="radio" name="fada-pagamento" value="ja_paguei" required>',
 '<span><strong>Sim, já paguei</strong><small>Vou identificar meu pagamento anterior.</small></span></label>',
 '<label><input type="radio" name="fada-pagamento" value="a_pagar" required checked>',
 '<span><strong>Ainda não, quero contratar</strong><small>Quero solicitar a experiência e receber as orientações de pagamento.</small></span></label></div>',
 '<div id="fada-paid-extra" class="gf-natal-fields" hidden>',
 '<label>Meio de pagamento usado<select id="fada-method"><option value="nao_sei">Não sei informar</option>',
 '<option value="pix">Pix</option><option value="credito">Cartão de crédito</option><option value="outro">Outro</option></select></label>',
 '<label>Data aproximada do pagamento<input id="fada-paid-date" type="date"></label></div></section>',
 '<section class="gf-natal-section"><span class="gf-natal-section-number">02 · FAMÍLIA</span>',
 '<h2>Quantos alunos participarão?</h2><p>A mesma experiência, com preço especial conforme o número de alunos da família.</p>',
 '<label>Quantidade de alunos *<select id="fada-count" required><option value="1">1 aluno — R$ 80,00</option>',
 '<option value="2">2 alunos — R$ 145,00</option><option value="3">3 alunos — R$ 215,00</option>',
 '<option value="4">4 alunos — R$ 285,00</option></select></label><div id="fada-students"></div></section>',
 '<section class="gf-natal-section"><span class="gf-natal-section-number">03 · RESPONSÁVEL</span>',
 '<h2>Com quem podemos falar?</h2><div class="gf-natal-fields">',
 '<label>Nome completo *<input id="fada-name" autocomplete="name" required maxlength="120"></label>',
 '<label>WhatsApp com DDD *<input id="fada-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(16) 99999-9999" required></label>',
 '<label>E-mail (opcional)<input id="fada-email" type="email" autocomplete="email" maxlength="180"></label>',
 '<label>Fotos com familiares?<select id="fada-family"><option value="">A definir</option>',
 '<option value="Sim">Sim</option><option value="Não">Somente alunos</option></select></label></div>',
 '<label>Informações adicionais (opcional)<textarea id="fada-notes" rows="3" maxlength="1000"></textarea></label></section>',
 '<section class="gf-natal-section"><span class="gf-natal-section-number">04 · AGENDA</span>',
 '<h2 id="fada-schedule-title">Escolha o atendimento</h2>',
 '<p id="fada-schedule-description">Buscando horários…</p>',
 '<div id="fada-times" role="group" aria-label="Horários disponíveis"></div>',
 '<button type="button" id="fada-refresh" class="btn btn-secondary">Atualizar disponibilidade</button></section>',
 '<section class="gf-natal-section"><span class="gf-natal-section-number">05 · REVISÃO</span>',
 '<h2>Confira seu pedido</h2><div class="gf-natal-final"><span>Total desta família</span>',
 '<strong id="fada-final">R$ 80,00</strong></div>',
 '<p id="fada-payment-note">A reserva só será confirmada após a conferência do pagamento.</p>',
 '<label class="gf-natal-consent"><input id="fada-accept" type="checkbox" required>',
 '<span>Declaro que posso realizar esta inscrição e que compreendo que o horário solicitado dependerá de disponibilidade e confirmação do pagamento.</span></label>',
 '<button type="submit" class="btn btn-primary" id="fada-submit" disabled>Solicitar agendamento</button>',
 '<p id="fada-feedback" role="alert" aria-live="assertive" hidden></p></section></form>'
 ].join('');
 const root=id=>area.querySelector('#'+id);
 const form=root('fada-form'),studentList=root('fada-students'),count=root('fada-count');
 const idempotencia=crypto.randomUUID();
 let schedule=null;
 function renderStudents(){
  const n=Number(count.value),sum=VALUES[n];
  root('fada-total').textContent=BRL(sum);root('fada-final').textContent=BRL(sum);
  root('fada-subtotal').textContent=n+' aluno'+(n===1?'':'s')+' · '+n*10+' fotografias';
  studentList.replaceChildren();
  for(let i=1;i<=n;i++){
   const block=make('fieldset','gf-natal-student');
   block.append(make('legend','',i+'º aluno'));
   const name=make('label','','Nome completo *'),student=make('input');
   student.type='text';student.name='student_name';student.maxLength=120;student.required=true;
   name.append(student);
   const turmalabel=make('label','','Turma (opcional)'),turma=make('input');
   turma.name='student_class';turma.maxLength=80;turmalabel.append(turma);
   block.append(name,turmalabel);studentList.append(block);
  }
 }
 function syncPaid(){
  const paid=form.querySelector('[name="fada-pagamento"]:checked')?.value==='ja_paguei';
  root('fada-paid-extra').hidden=!paid;
  root('fada-payment-note').textContent=paid
   ?'Você não receberá uma segunda cobrança. Seu pagamento anterior será conferido pela equipe Grand Focus.'
   :'O pagamento ainda não é realizado por este formulário. Sua reserva dependerá da confirmação do pagamento.';
 }
 count.addEventListener('change',renderStudents);
 for(const input of form.querySelectorAll('[name="fada-pagamento"]'))input.addEventListener('change',syncPaid);
 renderStudents();syncPaid();
 function dayLabel(day){
  if(day==='2026-12-12')return 'Sábado, 12 de dezembro';
  if(day==='2026-12-13')return 'Domingo, 13 de dezembro';
  return String(day||'Data').split('-').reverse().join('/');
 }
 function renderTimeChoices(){
  const group=root('fada-times');group.replaceChildren();
  moneyState.slot=null;
  moneyState.mode=schedule?.modo_agendamento||'horario_marcado';
  if(moneyState.mode==='ordem_chegada'){
   root('fada-schedule-title').textContent='Atendimento por ordem de chegada';
   root('fada-schedule-description').textContent='Esta campanha não possui horário individual. A Grand Focus informará as orientações de chegada.';
   root('fada-refresh').hidden=true;
   return;
  }
  root('fada-schedule-title').textContent='Escolha seu dia e horário';
  root('fada-schedule-description').textContent='As vagas livres são exibidas abaixo. A solicitação é provisória até a confirmação do pagamento.';
  root('fada-refresh').hidden=preview;
  const slots=Array.isArray(schedule?.horarios)?schedule.horarios.filter(x=>x.ativo):[];
  if(!slots.length){group.append(make('p','gf-natal-no-slots','Ainda não há horários cadastrados para esta experiência.'));return;}
  const days=[...new Set(slots.map(x=>x.dia))];
  for(const day of days){
   const section=make('section','gf-natal-day');
   section.append(make('h3','',dayLabel(day)));
   const grid=make('div','gf-natal-time-grid');
   for(const slot of slots.filter(s=>s.dia===day)){
    const available=Number(slot.disponiveis)>0;
    const button=make('button','gf-natal-time',slot.inicio);
    button.type='button';button.disabled=!available;
    button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label',dayLabel(day)+' às '+slot.inicio+(available?' livre':' ocupado'));
    button.addEventListener('click',()=>{
     moneyState.slot=slot.id;
     for(const sibling of group.querySelectorAll('.gf-natal-time'))sibling.setAttribute('aria-pressed','false');
     button.setAttribute('aria-pressed','true');
    });
    grid.append(button);
   }
   section.append(grid);group.append(section);
  }
 }
 async function loadSlots(){
  try{
   schedule=preview?await adminPreview():await request('contratacao-publica',{action:'natal_horarios',campaign_slug:SLUG});
   moneyState.active=Boolean(schedule.disponivel);
   renderTimeChoices();
   root('fada-status').textContent=preview
    ?'Prévia administrativa: as escolhas são demonstrativas. Nenhum cadastro, pagamento ou horário real será criado.'
    :schedule.disponivel?'':'A campanha ainda está em preparação e não recebe inscrições.';
   root('fada-submit').disabled=preview||!schedule.disponivel;
   root('fada-submit').textContent=preview||!schedule.disponivel?'Inscrição ainda não liberada':'Solicitar agendamento';
  }catch(error){
   root('fada-status').textContent=error.message||'Não foi possível carregar a agenda.';
   root('fada-submit').disabled=true;
  }
 }
 root('fada-refresh').addEventListener('click',loadSlots);
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(preview||!moneyState.active)return;
  if(!form.checkValidity()){form.reportValidity();return;}
  if(moneyState.mode==='horario_marcado'&&!moneyState.slot){
   root('fada-feedback').hidden=false;
   root('fada-feedback').textContent='Escolha um horário disponível antes de continuar.';
   return;
  }
  const payload={
   idempotencia,horario_id:moneyState.mode==='horario_marcado'?moneyState.slot:null,
   nome:root('fada-name').value.trim(),whatsapp:root('fada-phone').value.trim(),
   email:root('fada-email').value.trim(),
   alunos:[...studentList.querySelectorAll('.gf-natal-student')].map(block=>({
    nome:block.querySelector('[name="student_name"]').value.trim(),
    turma:block.querySelector('[name="student_class"]').value.trim()
   })),
   pagamento:form.querySelector('[name="fada-pagamento"]:checked').value,
   meio_pagamento:root('fada-method').value,
   data_pagamento:root('fada-paid-date').value||null,
   familia:root('fada-family').value,
   observacao:root('fada-notes').value.trim(),
   aceite:root('fada-accept').checked,company_website:''
  };
  const button=root('fada-submit');button.disabled=true;button.textContent='Enviando…';
  try{
   const response=await request('contratacao-publica',{action:'natal_inscrever',campaign_slug:SLUG,...payload});
   form.hidden=true;
   const success=make('section','gf-natal-success');
   success.append(make('h2','','Solicitação recebida!'));
   success.append(make('p','',response.mensagem||'A Grand Focus recebeu seu cadastro.'));
   success.append(make('p','','Referência: '+String(response.codigo||'—').toUpperCase()));
   success.append(make('p','','Valor desta família: '+BRL(Number(response.valor_centavos)||0)));
   success.append(make('p','','Seu horário ainda depende de confirmação. Se já pagou, não efetue outro pagamento.'));
   area.append(success);success.scrollIntoView({block:'start'});
  }catch(error){
   root('fada-feedback').hidden=false;
   root('fada-feedback').textContent=error.message||'Não foi possível concluir o cadastro.';
   button.disabled=false;button.textContent='Solicitar agendamento';
   await loadSlots();
  }
 });
 await loadSlots();
}
