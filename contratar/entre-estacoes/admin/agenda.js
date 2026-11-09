/* Agenda modular da Grand Focus: o modo é escolhido por campanha.
 * Nenhuma reserva ou pagamento real é criado na tela administrativa.
 */
const section=document.getElementById('gf-natal-schedule')
const isNatal=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'')==='natal-fada-acucarada-2026'
if(!isNatal)document.querySelector('.gf-agenda-chooser').hidden=true
const list=document.getElementById('gf-natal-slots-admin')
const notice=document.getElementById('gf-natal-notice')
const modeNote=document.getElementById('gf-mode-note')
const scheduleForm=document.getElementById('gf-natal-build')
let currentMode='ordem_chegada'
let persistedMode='ordem_chegada'
let loaded=false

function uiText(element,value){element.textContent=value}
function api(action,fields={}){
 if(typeof window.gfContratacaoAdminRequest!=='function')
  throw new Error('Entre como administrador para editar a agenda.')
 return window.gfContratacaoAdminRequest(action,fields)
}
function renderState(mode){
 if(!isNatal){section.hidden=true;return}
 currentMode=mode
 section.hidden=mode!=='horario_marcado'
 modeNote.textContent=mode==='horario_marcado'
  ?(mode===persistedMode
    ?'Horário marcado: crie as vagas abaixo. Uma reserva ativa impede que outra família escolha a mesma vaga.'
    :'Clique em “Salvar configurações” antes de criar os horários.')
  :'Ordem de chegada: as famílias não precisarão selecionar uma hora individual. Clique em “Salvar configurações” para aplicar.'
 if(mode==='horario_marcado' && persistedMode===mode && loaded)void refreshSlots()
}
const dateInput=document.getElementById('gf-natal-date')
window.addEventListener('gf-contratacao-modo-carregado',event=>{
 persistedMode=event.detail?.modo==='horario_marcado'?'horario_marcado':'ordem_chegada'
 const selected=document.querySelector('input[name="gf-scheduling-mode"]:checked')?.value||persistedMode
 if(event.detail?.data_evento && !dateInput.value) dateInput.value=event.detail.data_evento
 renderState(selected)
})
window.addEventListener('gf-contratacao-modo-salvo',event=>{
 persistedMode=event.detail?.modo==='horario_marcado'?'horario_marcado':'ordem_chegada'
 renderState(persistedMode)
})
for(const input of document.querySelectorAll('input[name="gf-scheduling-mode"]'))
 input.addEventListener('change',()=>renderState(input.value))
window.addEventListener('gf-contratacao-admin-ready',()=>{
 loaded=true
 if(currentMode==='horario_marcado')void refreshSlots()
})

function el(tag,className,text){
 const element=document.createElement(tag)
 if(className)element.className=className
 if(text!=null)element.textContent=String(text)
 return element
}
const brDate=(date)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return String(date||'Data')
 const [y,m,d]=date.split('-')
 return d+'/'+m+'/'+y
}
async function refreshSlots(){
 if(persistedMode!=='horario_marcado')return
 list.replaceChildren(el('p','','Atualizando disponibilidade…'))
 try{
  const response=await api('agenda_listar')
  const slots=Array.isArray(response.horarios)?response.horarios:[]
  list.replaceChildren()
  if(!slots.length){
   list.append(el('p','gf-agenda-empty','Ainda não há horários cadastrados. Defina a primeira faixa acima e clique em “Criar horários”.'))
   return
  }
  for(const slot of slots){
   const occupied=Math.max(0,Number(slot.ocupados)||0)
   const capacity=Math.max(1,Number(slot.capacidade)||1)
   const state=slot.ativo!==true?'Desativado':occupied>=capacity?'Ocupado':'Disponível'
   const card=el('article','gf-agenda-slot')
   card.dataset.state=slot.ativo!==true?'disabled':occupied>=capacity?'busy':'free'
   const main=el('div','gf-agenda-slot-main')
   main.append(el('strong','gf-agenda-slot-date',brDate(slot.dia)+' · '+slot.inicio),
       el('span','gf-agenda-slot-duration',(slot.duracao_minutos||'—')+' min por atendimento'))
   const badge=el('span','gf-agenda-slot-state',state)
   card.append(main,badge)
   if(slot.ativo===true){
     const remove=el('button','gf-agenda-slot-disable','Desativar')
     remove.type='button'
     remove.setAttribute('aria-label','Desativar horário '+brDate(slot.dia)+' às '+slot.inicio)
     remove.addEventListener('click',async()=>{
       if(!confirm('Desativar '+brDate(slot.dia)+' às '+slot.inicio+'? Isso só é permitido se não houver reserva ativa.'))return
       remove.disabled=true
       try{
         await api('agenda_desativar_horario',{horario_id:slot.id})
         uiText(notice,'Horário desativado. Reservas existentes são preservadas.')
         await refreshSlots()
       }catch(error){uiText(notice,error.message||'Não foi possível desativar o horário.');remove.disabled=false}
     })
     card.append(remove)
   }
   list.append(card)
  }
  const free=slots.filter(s=>s.ativo===true && Number(s.disponiveis)>0).length
  uiText(notice,slots.length+' horários cadastrados · '+free+' ainda disponíveis. Não confirme pagamentos por esta tela.')
 }catch(error){
  list.replaceChildren(el('p','gf-agenda-error',error.message||'Erro ao carregar os horários.'))
 }
}
scheduleForm.addEventListener('submit',async event=>{
 event.preventDefault()
 if(currentMode!=='horario_marcado')return
 if(persistedMode!=='horario_marcado'){
   uiText(notice,'Salve primeiro o modo “Horário marcado” em “Salvar configurações”.')
   return
 }
 const day=dateInput.value
 const start=document.getElementById('gf-natal-start').value
 const end=document.getElementById('gf-natal-end').value
 const duration=Number(document.getElementById('gf-natal-duration').value)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!start||!end||
    end<=start||!Number.isSafeInteger(duration)||duration<5||duration>90){
   uiText(notice,'Confira o dia, o início, o término e a duração de cada atendimento.')
   return
 }
 const button=document.getElementById('gf-natal-build-button')
 button.disabled=true
 try{
  const response=await api('agenda_gerar_horarios',{
   dia:day,inicio:start,fim:end,duracao_minutos:duration
  })
  uiText(notice,'Agenda atualizada: '+(response.novos||0)+' novos horários criados.')
  await refreshSlots()
 }catch(error){uiText(notice,error.message||'Não foi possível criar os horários.')}
 finally{button.disabled=false}
})
document.getElementById('gf-natal-refresh').addEventListener('click',refreshSlots)
