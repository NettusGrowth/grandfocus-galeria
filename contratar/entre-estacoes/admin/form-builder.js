/* Form builder: each event has its own versioned question model. */
const bRoot=document.getElementById('gf-builder');
const bList=document.getElementById('gf-builder-items');
const bStatus=document.getElementById('gf-builder-status');
const bSaveBtn=document.getElementById('gf-builder-save');
const bAddBtn=document.getElementById('gf-builder-add');
const bUnsaved=document.getElementById('gf-builder-unsaved');
const bColor=document.getElementById('gf-builder-color');
const bBackground=document.getElementById('gf-builder-bg');
const bTitle=document.getElementById('gf-builder-title');
const bIntro=document.getElementById('gf-builder-intro');
const bKinds={texto:'Resposta curta',paragrafo:'Parágrafo',numero:'Número',
 email:'E-mail',telefone:'Telefone',data:'Data',unica:'Escolha única',
 multipla:'Múltiplas escolhas',lista:'Lista suspensa',sim_nao:'Sim ou não'};
const bDraft={version:1,status:'rascunho',questions:[],loaded:false,dirty:false,expandedId:null};
function bEl(tag,cl,text){const e=document.createElement(tag);if(cl)e.className=cl;if(text!==undefined)e.textContent=String(text);return e;}
function bL(text,input){const l=bEl('label','gf-builder-label');l.append(bEl('span','',text),input);return l;}
function bInput(value,placeholder,max){const e=bEl('input');e.type='text';e.value=value||'';e.placeholder=placeholder||'';if(max)e.maxLength=max;return e;}
function bAction(text,callback,cl){const b=bEl('button',cl||'gf-builder-tool',text);b.type='button';b.addEventListener('click',callback);return b;}
function bOptions(entries,selected){const e=bEl('select');for(const [id,name] of entries){const opt=bEl('option','',name);opt.value=id;e.append(opt);}e.value=selected||entries[0]?.[0]||'';return e;}
function bNotice(message,error){bStatus.textContent=message;bStatus.dataset.kind=error?'error':'info';}
function bDirty(){bDraft.dirty=true;bUnsaved.textContent='Alterações não salvas';bUnsaved.dataset.pending='true';}
function bClean(){bDraft.dirty=false;bUnsaved.textContent='Nenhuma alteração pendente.';bUnsaved.dataset.pending='false';}
function bId(){return 'q_'+Array.from(crypto.getRandomValues(new Uint8Array(9)),x=>x.toString(16).padStart(2,'0')).join('');}
function bNew(overrides={}){return {id:bId(),titulo:'Nova pergunta',ajuda:'',tipo:'texto',obrigatoria:false,opcoes:[],condicao:null,...overrides};}
function bReorder(index,delta){
 const target=index+delta;if(target<0||target>=bDraft.questions.length)return;
 const [item]=bDraft.questions.splice(index,1);bDraft.questions.splice(target,0,item);
 bDraft.questions.forEach((q,i)=>{if(q.condicao&&!bDraft.questions.slice(0,i).some(v=>v.id===q.condicao.pergunta_id))q.condicao=null;});
 bDirty();bRender();
}
function bDuplicate(index){
 if(bDraft.questions.length>=30){bNotice('Limite de 30 perguntas.',true);return;}
 const q=bDraft.questions[index];
 const duplicated=bNew({...q,id:bId(),titulo:q.titulo+' (cópia)',opcoes:[...q.opcoes],condicao:q.condicao?{...q.condicao}:null});
 bDraft.questions.splice(index+1,0,duplicated);
 bDraft.expandedId=duplicated.id;
 bDirty();bRender();
}
function bDelete(index){
 if(!confirm('Excluir esta pergunta do modelo? As respostas de pedidos antigos serão preservadas.'))return;
 const [removed]=bDraft.questions.splice(index,1);
 bDraft.questions.forEach(q=>{if(q.condicao?.pergunta_id===removed.id)q.condicao=null;});
 bDirty();bRender();
}
function bRender(){
 bList.replaceChildren();
 if(!bDraft.questions.length){
   const empty=bEl('div','gf-builder-empty');
   empty.append(bEl('strong','','Nenhuma pergunta extra.'),bEl('p','','Clique em Adicionar pergunta para começar. Os dados essenciais da contratação continuarão disponíveis.'));
   bList.append(empty);return;
 }
 bDraft.questions.forEach((q,index)=>{
   const card=bEl('article','gf-builder-question');
   card.dataset.expanded=String(q.id===bDraft.expandedId);
   const top=bEl('div','gf-builder-question-top');
   const expand=bAction((index+1)+'. '+(q.titulo||'Nova pergunta')+'  '+(q.id===bDraft.expandedId?'⌃':'⌄'),()=>{
     bDraft.expandedId=bDraft.expandedId===q.id?null:q.id;bRender();
   },'gf-builder-question-title');
   expand.setAttribute('aria-expanded',String(card.dataset.expanded==='true'));
   top.append(expand);
   const tools=bEl('div','gf-builder-question-tools');
   const up=bAction('↑ Subir',()=>bReorder(index,-1));
   const down=bAction('↓ Descer',()=>bReorder(index,1));
   up.disabled=index===0;down.disabled=index===bDraft.questions.length-1;
   tools.append(up,down,bAction('Duplicar',()=>bDuplicate(index)),bAction('Excluir',()=>bDelete(index),'gf-builder-tool gf-builder-delete'));
   top.append(tools);card.append(top);
   const fields=bEl('div','gf-builder-fields');
   const title=bInput(q.titulo,'Ex.: Qual modalidade pratica?',180);
   title.addEventListener('input',()=>{q.titulo=title.value;bDirty();});
   fields.append(bL('Texto da pergunta',title));
   const type=bOptions(Object.entries(bKinds),q.tipo);
   type.addEventListener('change',()=>{
     q.tipo=type.value;
     if(!['unica','multipla','lista'].includes(q.tipo))q.opcoes=[];
     else if(q.opcoes.length<2)q.opcoes=['Opção 1','Opção 2'];
     bDraft.questions.forEach(dep=>{if(dep.condicao?.pergunta_id===q.id &&
       (!['unica','lista','sim_nao'].includes(q.tipo) || !(q.tipo==='sim_nao'?['Sim','Não']:q.opcoes).includes(dep.condicao.valor)))dep.condicao=null;});
     bDirty();bRender();
   });
   fields.append(bL('Tipo de resposta',type));
   const help=bInput(q.ajuda,'Ajuda opcional para a família',350);
   help.addEventListener('input',()=>{q.ajuda=help.value;bDirty();});
   fields.append(bL('Orientação (opcional)',help));
   const required=bEl('input');required.type='checkbox';required.checked=q.obrigatoria===true;
   required.addEventListener('change',()=>{q.obrigatoria=required.checked;bDirty();});
   fields.append(bL('Resposta obrigatória',required));
   if(['unica','multipla','lista'].includes(q.tipo)){
     const opts=bEl('textarea');opts.rows=4;opts.value=(q.opcoes||[]).join('\n');
     opts.placeholder='Uma alternativa por linha';
     opts.addEventListener('input',()=>{q.opcoes=opts.value.split('\n').map(x=>x.trim()).filter(Boolean);bDirty();});
     const label=bL('Alternativas (2 a 12, uma por linha)',opts);label.classList.add('gf-builder-full');fields.append(label);
   }
   const conditions=bEl('div','gf-builder-condition');
   conditions.append(bEl('strong','','Regra de exibição'));
   const available=bDraft.questions.slice(0,index).filter(x=>['unica','lista','sim_nao'].includes(x.tipo));
   const parent=bOptions([['','Sempre mostrar'],...available.map(x=>[x.id,x.titulo])],q.condicao?.pergunta_id);
   const value=bEl('select');
   function fillCondition(){
     value.replaceChildren();
     const current=bDraft.questions.find(x=>x.id===parent.value);
     const opts=current?(current.tipo==='sim_nao'?['Sim','Não']:current.opcoes):[];
     for(const val of opts){const opt=bEl('option','',val);opt.value=val;value.append(opt);}
     if(q.condicao?.pergunta_id===parent.value && opts.includes(q.condicao.valor))value.value=q.condicao.valor;
     value.disabled=!parent.value;
   }
   parent.addEventListener('change',()=>{
     q.condicao=parent.value?{pergunta_id:parent.value,valor:''}:null;
     fillCondition();if(q.condicao)q.condicao.valor=value.value;bDirty();
   });
   value.addEventListener('change',()=>{if(parent.value){q.condicao={pergunta_id:parent.value,valor:value.value};bDirty();}});
   fillCondition();
   conditions.append(bL('Mostrar somente se responder…',parent),bL('Alternativa',value));
   fields.append(conditions);card.append(fields);
   if(bDraft.status==='publicado'||bDraft.status==='encerrado')
     card.querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=true);
   bList.append(card);
 });
}
function bSnapshot(){
 return {aparencia:{
   cor:bColor.value.toUpperCase(),fundo:bBackground.value.toUpperCase(),
   titulo:bTitle.value.trim(),introducao:bIntro.value.trim()},
   perguntas:bDraft.questions.map((q,i)=>({
     id:q.id,titulo:q.titulo.trim(),ajuda:q.ajuda.trim(),tipo:q.tipo,
     obrigatoria:q.obrigatoria===true,
     opcoes:['unica','lista','multipla'].includes(q.tipo)?q.opcoes:[],
     condicao:q.condicao||null,ordem:i
   }))
 };
}
function bLoad(data){
 const model=data.evento?.formulario_modelo||{},appearance=model.aparencia||{};
 bDraft.version=Number(data.evento?.formulario_versao)||1;
 bDraft.status=data.evento?.status||'rascunho';
 bDraft.expandedId=null;
 bDraft.questions=(Array.isArray(model.perguntas)?model.perguntas:[]).map(q=>({...q,
    opcoes:Array.isArray(q.opcoes)?q.opcoes:[],condicao:q.condicao||null}));
 bColor.value=appearance.cor||'#4B0416';bBackground.value=appearance.fundo||'#F1EDF1';
 bTitle.value=appearance.titulo||'';bIntro.value=appearance.introducao||'';
 const locked=['publicado','encerrado'].includes(bDraft.status);
 bSaveBtn.disabled=locked;bAddBtn.disabled=locked;
 bRoot.querySelectorAll('.gf-builder-themes input,.gf-builder-themes textarea').forEach(e=>e.disabled=locked);
 bRender();bDraft.loaded=true;bClean();
 document.getElementById('gf-builder-preview-link').href='/contratar/'+encodeURIComponent(data.evento?.slug||'entre-estacoes')+'/?preview=1';
 bNotice(locked?'Campanha publicada ou encerrada: pause antes de editar.':'Editor pronto. Salve para atualizar a prévia.');
}
async function bSave(){
 if(!bDraft.loaded||bSaveBtn.disabled)return;
 bSaveBtn.disabled=true;bNotice('Salvando perguntas…');
 try{
   const out=await window.gfContratacaoAdminRequest('formulario_salvar',{modelo:bSnapshot(),versao:bDraft.version});
   bDraft.version=Number(out.versao);bClean();bNotice('Perguntas e aparência salvas. Abra a prévia para conferir.');
 }catch(error){bNotice(error.message||'Não foi possível salvar.',true);}
 finally{bSaveBtn.disabled=['publicado','encerrado'].includes(bDraft.status);}
}
bAddBtn.addEventListener('click',()=>{
 if(bDraft.questions.length>=30){bNotice('Máximo de 30 perguntas por evento.',true);return;}
 const fresh=bNew();bDraft.questions.push(fresh);bDraft.expandedId=fresh.id;bDirty();bRender();
 bList.lastElementChild?.scrollIntoView({block:'center'});
 bList.lastElementChild?.querySelector('input[type="text"]')?.focus();
});
bSaveBtn.addEventListener('click',bSave);
for(const input of [bColor,bBackground,bTitle,bIntro])input.addEventListener('input',bDirty);
window.addEventListener('gf-contratacao-admin-ready',async()=>{
 try{bLoad(await window.gfContratacaoAdminRequest('config'));}
 catch(error){bNotice(error.message||'Não foi possível abrir o editor.',true);}
});
window.addEventListener('beforeunload',event=>{if(bDraft.dirty){event.preventDefault();event.returnValue='';}});
