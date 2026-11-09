// Navegação simplificada por área: uma tarefa por tela.
const adminWorkspace=document.getElementById('admin-area')
const workspaceTabs=[...document.querySelectorAll('[data-workspace-tab]')]
const workspaceSections=[...adminWorkspace.querySelectorAll('[data-workspace-page]')]
const builderPanels=[...document.querySelectorAll('[data-builder-pane]')]
function openWorkspace(area,changeHash=false){
  const view=['respostas','perguntas','aparencia','evento'].includes(area)?area:'respostas'
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
