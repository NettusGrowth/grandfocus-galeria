// Navegação simplificada por área: uma tarefa por tela.
const adminWorkspace=document.getElementById('admin-area')
const workspaceTabs=[...document.querySelectorAll('[data-workspace-tab]')]
const workspaceSections=[...adminWorkspace.querySelectorAll('[data-workspace-page]')]
const builderPanels=[...document.querySelectorAll('[data-builder-pane]')]
function openWorkspace(area,changeHash=false){
  const view=['respostas','perguntas','financeiro','aparencia','evento'].includes(area)?area:'perguntas'
  adminWorkspace.dataset.workspaceView=view
  workspaceTabs.forEach(tab=>{
    const active=tab.dataset.workspaceTab===view
    tab.setAttribute('aria-pressed',String(active))
  })
  workspaceSections.forEach(el=>{
    el.hidden=!(el.dataset.workspacePage||'').split(/\s+/).includes(view)
  })
  builderPanels.forEach(el=>{
    el.hidden=el.dataset.builderPane!==view
  })
  const builderHeading=document.getElementById('gf-builder-heading')
  const builderExplainer=document.getElementById('gf-builder-explainer')
  if(builderHeading)builderHeading.textContent=view==='aparencia'?'Aparência do formulário':'Perguntas do formulário'
  if(builderExplainer)builderExplainer.textContent=view==='aparencia'
    ?'Personalize cores, título e mensagem de boas-vindas. Salve antes de abrir a prévia.'
    :'Edite os campos que cada família deve preencher. Clique em uma pergunta para alterar as opções.'
  if(changeHash)history.replaceState(null,'','#'+view)
  if(changeHash){
    window.scrollTo({top:0,behavior:'instant'})
    document.querySelector('[data-workspace-tab="'+view+'"]')?.focus({preventScroll:true})
  }
}
workspaceTabs.forEach(btn=>btn.addEventListener('click',()=>openWorkspace(btn.dataset.workspaceTab,true)))
window.addEventListener('hashchange',()=>{
  const key=location.hash.replace('#','')
  openWorkspace(key==='gf-central'?'respostas':key==='gf-builder'?'perguntas':key,false)
})
const initial=location.hash.replace('#','')
openWorkspace(initial==='gf-central'?'respostas':initial==='gf-builder'?'perguntas':initial,false)
window.gfOpenAdminWorkspace=openWorkspace

/* Navegação com fechamento externo e Esc, semelhante a apps com menus contextuais. */
const optionsMenu=document.querySelector('details.gf-workspace-more')
if(optionsMenu){
 document.addEventListener('pointerdown',event=>{
  if(optionsMenu.open&&!optionsMenu.contains(event.target))optionsMenu.open=false
 })
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&optionsMenu.open)optionsMenu.open=false
 })
 optionsMenu.querySelectorAll('a,button').forEach(el=>el.addEventListener('click',()=>{
  optionsMenu.open=false
 }))
}
const financeSheet=document.getElementById('gf-finance-sheet')
if(financeSheet){
 const slug=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'entre-estacoes')
 financeSheet.href='/contratar/planilha/?campanha='+encodeURIComponent(slug)
}
const sheetLink=document.getElementById('gf-open-sheet')
if(sheetLink){
 const slug=decodeURIComponent(location.pathname.split('/').filter(Boolean)[1]||'entre-estacoes')
 sheetLink.href='/contratar/planilha/?campanha='+encodeURIComponent(slug)
}
