/* Renderização segura das perguntas adicionais, por campanha e com versão.
   Tudo é montado por createElement/textContent, sem HTML injetável. */
let activeModel={perguntas:[],aparencia:{}}
let activeVersion=1
let questionRoot=null
const $=(tag,cl,text)=>{const x=document.createElement(tag);if(cl)x.className=cl;if(text!==undefined)x.textContent=String(text);return x}
function rawAnswer(q){
  const card=questionRoot?.querySelector('[data-question-id="'+q.id+'"]')
  if(!card || card.hidden)return null
  if(q.tipo==='multipla')return Array.from(card.querySelectorAll('input:checked')).map(x=>x.value)
  if(['unica','sim_nao'].includes(q.tipo))return card.querySelector('input:checked')?.value||''
  return card.querySelector('input,select,textarea')?.value?.trim()||''
}
function chosen(q){
  const v=rawAnswer(q)
  return Array.isArray(v)?v.length>0:!!v
}
function showQuestion(q){
  if(!q.condicao?.pergunta_id)return true
  const parent=activeModel.perguntas.find(x=>x.id===q.condicao.pergunta_id)
  if(!parent)return false
  return rawAnswer(parent)===q.condicao.valor
}
function updateVisibility(){
  for(const question of activeModel.perguntas){
    const card=questionRoot?.querySelector('[data-question-id="'+question.id+'"]')
    if(card){card.hidden=!showQuestion(question)}
  }
}
export function setFormPresentation(evento){
  const design=evento.formulario_modelo?.aparencia||{}
  const color=String(design.cor||'#4B0416'),background=String(design.fundo||'#F1EDF1')
  if(/^#[0-9a-f]{6}$/i.test(color))document.body.style.setProperty('--form-accent',color)
  if(/^#[0-9a-f]{6}$/i.test(background))document.body.style.setProperty('--form-background',background)
  const title=String(design.titulo||'').trim()
  const intro=String(design.introducao||'').trim()
  if(title)document.getElementById('campaign-title').textContent=title
  const customIntro=document.getElementById('gf-custom-intro')
  if(customIntro){
    customIntro.textContent=intro
    customIntro.hidden=!intro
  }
}
export function renderCustomQuestions(evento){
  activeModel=evento.formulario_modelo||{perguntas:[],aparencia:{}}
  activeVersion=Number(evento.formulario_versao)||1
  questionRoot=document.getElementById('gf-custom-questions')
  questionRoot.replaceChildren()
  const questions=Array.isArray(activeModel.perguntas)?activeModel.perguntas:[]
  if(!questions.length){questionRoot.hidden=true;return}
  questionRoot.hidden=false
  questionRoot.append($('h3','gf-custom-title','Perguntas adicionais da escola'))
  questionRoot.append($('p','gf-custom-description','Responda às perguntas abaixo. Os campos com * são obrigatórios.'))
  for(const q of questions){
    const card=$('div','gf-custom-question');card.dataset.questionId=q.id
    const label=$('span','gf-custom-label',q.titulo+(q.obrigatoria?' *':''))
    const hint=q.ajuda?$('p','gf-custom-help',q.ajuda):null
    const inputId='gf-question-'+q.id
    if(['unica','sim_nao','multipla'].includes(q.tipo)){
      card.append(label)
      const options=q.tipo==='sim_nao'?['Sim','Não']:q.opcoes||[]
      const group=$('div','gf-custom-options')
      for(const [i,opt] of options.entries()){
        const line=$('label','gf-custom-option')
        const input=$('input')
        input.type=q.tipo==='multipla'?'checkbox':'radio'
        input.name=inputId
        input.value=opt;input.id=inputId+'-'+i
        line.append(input,$('span','',opt));group.append(line)
      }
      card.append(group)
    }else{
      const control=q.tipo==='paragrafo'?$('textarea'):(q.tipo==='lista'?$('select'):$('input'))
      control.id=inputId
      control.setAttribute('aria-label',q.titulo)
      if(control.tagName==='INPUT'){
        control.type=({numero:'number',data:'date',email:'email',telefone:'tel'}[q.tipo]||'text')
        if(q.tipo==='numero')control.step='any'
        if(q.tipo==='telefone')control.inputMode='tel'
        if(q.tipo==='email')control.inputMode='email'
        control.maxLength=q.tipo==='paragrafo'?1000:250
      }
      if(control.tagName==='TEXTAREA'){control.rows=4;control.maxLength=1000}
      if(q.tipo==='lista'){
        const empty=$('option','','Selecione uma alternativa');empty.value='';control.append(empty)
        for(const opt of q.opcoes||[]){const option=$('option','',opt);option.value=opt;control.append(option)}
      }
      const field=$('label','gf-custom-field')
      field.append(label,control);card.append(field)
    }
    if(hint)card.append(hint)
    questionRoot.append(card)
  }
  questionRoot.addEventListener('input',updateVisibility)
  questionRoot.addEventListener('change',updateVisibility)
  updateVisibility()
}
export function collectCustomAnswers(){
  const answers={}
  for(const q of activeModel.perguntas||[]){
    if(!showQuestion(q))continue
    const value=rawAnswer(q)
    const answered=Array.isArray(value)?value.length>0:!!value
    if(q.obrigatoria&&!answered){
      const focus=questionRoot.querySelector('[data-question-id="'+q.id+'"]')
      focus?.scrollIntoView({behavior:'auto',block:'center'})
      focus?.querySelector('input,select,textarea')?.focus()
      throw new Error('Responda à pergunta obrigatória: '+q.titulo)
    }
    if(!answered)continue
    if(q.tipo==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw new Error('Confira o e-mail informado na pergunta: '+q.titulo)
    if(q.tipo==='telefone' && !/^\d{10,13}$/.test(value.replace(/\D/g,'')))
      throw new Error('Confira o telefone da pergunta: '+q.titulo)
    if(q.tipo==='numero' && (!Number.isFinite(Number(value)) || !/^-?\d{1,12}(\.\d{1,4})?$/.test(value)))
      throw new Error('Informe um número válido em: '+q.titulo)
    answers[q.id]=value
  }
  return {versao:activeVersion,respostas:answers}
}
export function customQuestionsAreValid(){
  collectCustomAnswers()
  return true
}
