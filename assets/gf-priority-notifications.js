/* Grand Focus | Central de notificações de alto valor
   RLS: os registros só são consultáveis por administradores.
   Realtime com consulta periódica como contingência, sem consultas de fotos.
*/
let _gfNotifDados=[];
let _gfNotifLidas=new Set();
let _gfNotifConhecidas=new Set();
let _gfNotifIniciada=false;
let _gfNotifTemBase=false;
let _gfNotifCarregando=false;
let _gfNotifPendente=false;
let _gfNotifUltimaConsulta=0;
let _gfNotifInicializadoEm=0;
let _gfNotifTimer=null;
let _gfNotifAudio=null;
let _gfNotifSomLigado=true;
let _gfNotifAudioLiberado=false;
function _gfNotifAdmin(){return !!currentUser&&['admin','super_admin'].includes(meuPerfil?.role);}
function _gfNotifIcone(tipo){return /pagamento/.test(tipo)?'💚':tipo==='selecao_enviada'?'📸':'📝';}
function _gfNotifData(iso){return new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
function _gfNotifSomPreferencia(){try{return localStorage.getItem('gf-prio-som')!=='off';}catch{return true;}}
function _gfNotifDestravarAudio(){
  if(!_gfNotifAdmin()||!_gfNotifSomLigado||_gfNotifAudioLiberado)return;
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    _gfNotifAudio=_gfNotifAudio||new Audio();
    _gfNotifAudio.resume().then(()=>{_gfNotifAudioLiberado=_gfNotifAudio.state==='running';}).catch(()=>{});
  }catch(e){console.debug('Notificações: áudio indisponível',e);}
}
function _gfNotifTocarSom(){
  if(!_gfNotifSomLigado||!_gfNotifAudioLiberado||document.visibilityState==='hidden')return;
  try{
    const ctx=_gfNotifAudio;
    if(!ctx||ctx.state!=='running')return;
    const agora=ctx.currentTime;
    [660,880].forEach((freq,i)=>{
      const inicio=agora+i*.14,osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type='sine';osc.frequency.setValueAtTime(freq,inicio);
      gain.gain.setValueAtTime(.0001,inicio);
      gain.gain.exponentialRampToValueAtTime(.055,inicio+.016);
      gain.gain.exponentialRampToValueAtTime(.0001,inicio+.14);
      osc.connect(gain);gain.connect(ctx.destination);
      osc.start(inicio);osc.stop(inicio+.16);
    });
  }catch(e){console.debug('Notificações: falha no som',e);}
}
function _gfNotifAlternarSom(){
  _gfNotifSomLigado=!_gfNotifSomLigado;
  try{localStorage.setItem('gf-prio-som',_gfNotifSomLigado?'on':'off');}catch{}
  if(_gfNotifSomLigado)_gfNotifDestravarAudio();
  _gfNotifAtualizarSom();
}
function _gfNotifAtualizarSom(){
  const botao=document.getElementById('gf-notif-som');
  if(!botao)return;
  botao.style.display=_gfNotifAdmin()?'inline-flex':'none';
  botao.dataset.off=String(!_gfNotifSomLigado);
  botao.textContent=_gfNotifSomLigado?'♫ Som ligado':'♩ Som desligado';
  botao.title='Alertas sonoros somente com a galeria aberta e após interação com a página';
}
function _gfNotifParar(){
  if(_gfNotifTimer)clearInterval(_gfNotifTimer);
  _gfNotifTimer=null;
  _gfNotifDados=[];_gfNotifLidas=new Set();_gfNotifConhecidas=new Set();
  _gfNotifIniciada=false;_gfNotifTemBase=false;_gfNotifCarregando=false;_gfNotifPendente=false;
  _gfNotifUltimaConsulta=0;_gfNotifInicializadoEm=0;
  const badge=document.getElementById('gf-notif-numero');
  if(badge){badge.style.display='none';badge.textContent='';}
  const dot=document.getElementById('sino-dot');
  if(dot)dot.style.display='none';
  const summary=document.getElementById('gf-notif-total');
  if(summary)summary.textContent='';
  const som=document.getElementById('gf-notif-som');
  if(som)som.style.display='none';
  _gfNotifAudioLiberado=false;
  if(_gfNotifAudio){_gfNotifAudio.close().catch(()=>{});_gfNotifAudio=null;}
  document.getElementById('gf-prio-toasts')?.replaceChildren();
  document.getElementById('sino-drop')?.classList.remove('gf-notif-admin');
}
function _gfNotifIniciarSino(){
  if(!_gfNotifAdmin())return;
  _gfNotifSomLigado=_gfNotifSomPreferencia();
  document.getElementById('sino-drop')?.classList.add('gf-notif-admin');
  _gfNotifAtualizarSom();
  if(!_gfNotifIniciada){
    _gfNotifIniciada=true;
    _gfNotifInicializadoEm=Date.now();
    _gfNotifTimer=setInterval(()=>{
      if(document.visibilityState!=='hidden'&&_gfNotifAdmin())_gfNotifAtualizar(false);
    },30000);
  }
  _gfNotifAtualizar(false);
}
async function _gfNotifAtualizar(forcar=false){
  if(!_gfNotifAdmin())return;
  if(_gfNotifCarregando){_gfNotifPendente=_gfNotifPendente||forcar;return;}
  if(!forcar&&Date.now()-_gfNotifUltimaConsulta<14000)return;
  _gfNotifCarregando=true;
  _gfNotifUltimaConsulta=Date.now();
  const userId=currentUser.id;
  try{
    const {data,error}=await db.from('gf_notificacoes_prioritarias')
      .select('id,tipo,titulo,mensagem,referencia_id,referencia_tipo,prioridade,valor_centavos,criado_em')
      .order('criado_em',{ascending:false}).limit(80);
    if(error)throw error;
    if(!_gfNotifAdmin()||currentUser.id!==userId)return;
    const registros=Array.isArray(data)?data:[];
    const ids=registros.map(x=>x.id);
    const resposta=ids.length?await db.from('gf_notificacoes_prioritarias_lidas').select('notificacao_id')
      .eq('user_id',userId).in('notificacao_id',ids):{data:[],error:null};
    if(resposta.error)throw resposta.error;
    if(!_gfNotifAdmin()||currentUser.id!==userId)return;
    const lidas=new Set((resposta.data||[]).map(x=>x.notificacao_id));
    const anterior=_gfNotifConhecidas;
    const primeira=!_gfNotifTemBase;
    const novos=registros.filter(r=>!primeira&&!anterior.has(r.id)&&!lidas.has(r.id)
      &&new Date(r.criado_em).getTime()>=_gfNotifInicializadoEm-1000);
    _gfNotifConhecidas=new Set(registros.map(x=>x.id));
    _gfNotifTemBase=true;
    _gfNotifLidas=lidas;
    _gfNotifDados=registros;
    _gfNotifDesenhar();
    if(novos.length){
      const escolhidos=novos.sort((a,b)=>b.prioridade-a.prioridade||b.criado_em.localeCompare(a.criado_em)).slice(0,2);
      escolhidos.reverse().forEach(x=>_gfNotifMostrarPopup(x));
      _gfNotifTocarSom();
    }
  }catch(e){
    console.warn('Notificações prioritárias: falha de consulta',e);
    const lista=document.getElementById('sino-lista');
    if(lista&&!_gfNotifDados.length)lista.innerHTML='<li class="gf-notif-empty">Não foi possível atualizar as notificações. Tentaremos novamente automaticamente.</li>';
    _gfNotifUltimaConsulta=0;
  }finally{
    _gfNotifCarregando=false;
    if(_gfNotifPendente){_gfNotifPendente=false;_gfNotifAtualizar(true);}
  }
}
function _gfNotifDesenhar(){
  const lista=document.getElementById('sino-lista');
  if(!lista)return;
  const itens=[..._gfNotifDados].sort((a,b)=>
    Number(_gfNotifLidas.has(a.id))-Number(_gfNotifLidas.has(b.id))||
    b.prioridade-a.prioridade||b.criado_em.localeCompare(a.criado_em));
  const unread=_gfNotifDados.filter(x=>!_gfNotifLidas.has(x.id)).length;
  const badge=document.getElementById('gf-notif-numero');
  if(badge){badge.style.display=unread?'inline-flex':'none';badge.textContent=unread>99?'99+':String(unread);}
  const dot=document.getElementById('sino-dot');
  if(dot)dot.style.display=unread?'block':'none';
  const contador=document.getElementById('gf-notif-total');
  if(contador)contador.textContent=unread?unread+' nova'+(unread>1?'s':''):'Em dia';
  lista.innerHTML=itens.length?itens.map(x=>'<li style="padding:0;border:0;"><button type="button" class="gf-notif-row" data-read="'+_gfNotifLidas.has(x.id)+'" onclick="_gfNotifAbrir(\''+x.id+'\')">'+
    '<span class="gf-notif-row-icon" data-type="'+x.tipo+'">'+_gfNotifIcone(x.tipo)+'</span>'+
    '<span class="gf-notif-row-main"><span class="gf-notif-row-title">'+esc(x.titulo)+'</span>'+
    '<span class="gf-notif-row-message">'+esc(x.mensagem)+'</span>'+
    '<span class="gf-notif-row-time">'+esc(_gfNotifData(x.criado_em))+'</span></span>'+
    (!_gfNotifLidas.has(x.id)?'<span class="gf-notif-row-unread"></span>':'')+'</button></li>').join('')
    :'<li class="gf-notif-empty">Tudo em dia! Novas seleções, cadastros e pagamentos aparecerão aqui.</li>';
}
async function _gfNotifMarcar(id){
  if(!_gfNotifAdmin()||_gfNotifLidas.has(id)||!_gfNotifDados.some(n=>n.id===id))return;
  _gfNotifLidas.add(id);_gfNotifDesenhar();
  const {error}=await db.from('gf_notificacoes_prioritarias_lidas').upsert({
    notificacao_id:id,user_id:currentUser.id
  },{onConflict:'notificacao_id,user_id',ignoreDuplicates:true});
  if(error){console.warn('Não foi possível salvar notificação lida',error);_gfNotifLidas.delete(id);_gfNotifDesenhar();}
}
async function _gfNotifMarcarTodas(){
  if(!_gfNotifAdmin()){_notifMarcarTodasLidas();return;}
  const {error}=await db.rpc('gf_notificacoes_marcar_todas');
  if(error){toast('Não foi possível marcar como lidas. Tente novamente.');return;}
  _gfNotifDados.forEach(x=>_gfNotifLidas.add(x.id));
  _gfNotifDesenhar();
}
function _gfNotifAbrir(id){
  if(!_gfNotifAdmin())return;
  const n=_gfNotifDados.find(x=>x.id===id);
  if(!n)return;
  _gfNotifMarcar(id);
  document.getElementById('sino-drop')?.classList.remove('open');
  _gfNotifFecharPopup(id);
  if(n.referencia_tipo==='selecao'&&n.referencia_id){
    setAdminTab('selecao');abrirSelecaoDetalhe(n.referencia_id);
  }else if(n.referencia_tipo==='formulario'){
    window.open('/contratar/planilha/','_blank','noopener,noreferrer');
  }else if(n.referencia_tipo==='pedido'){
    window.open('/contratar/admin/','_blank','noopener,noreferrer');
  }else{
    setAdminTab('auditoria');iniciarAuditoriaAdmin();
  }
}
function _gfNotifFecharPopup(id){
  const el=document.getElementById('gf-prio-toast-'+id);
  if(el)el.remove();
}
function _gfNotifMostrarPopup(n){
  const pilha=document.getElementById('gf-prio-toasts');
  if(!pilha||document.getElementById('gf-prio-toast-'+n.id))return;
  const toastEl=document.createElement('div');
  toastEl.id='gf-prio-toast-'+n.id;
  toastEl.className='gf-prio-toast';
  toastEl.dataset.type=n.tipo;
  const duracao=n.tipo.includes('pagamento')?11000:9000;
  toastEl.style.setProperty('--gf-notif-duration',duracao+'ms');
  toastEl.setAttribute('role','status');
  toastEl.innerHTML='<span class="gf-prio-toast-ico">'+_gfNotifIcone(n.tipo)+'</span>'+
    '<span class="gf-prio-toast-body"><span class="gf-prio-toast-tag">GRAND FOCUS · NOTIFICAÇÃO</span>'+
    '<span class="gf-prio-toast-title">'+esc(n.titulo)+'</span>'+
    '<span class="gf-prio-toast-message">'+esc(n.mensagem)+'</span>'+
    '<span class="gf-prio-toast-action">Toque para abrir →</span></span>'+
    '<button class="gf-prio-toast-close" type="button" title="Fechar" aria-label="Fechar aviso">×</button>'+
    '<span class="gf-prio-toast-progress"></span>';
  toastEl.addEventListener('click',e=>{
    if(e.target.closest('.gf-prio-toast-close')){e.stopPropagation();_gfNotifFecharPopup(n.id);return;}
    _gfNotifAbrir(n.id);
  });
  pilha.appendChild(toastEl);
  while(pilha.children.length>3)pilha.firstElementChild.remove();
  setTimeout(()=>_gfNotifFecharPopup(n.id),duracao);
}
function _gfNotifRealtime(){
  if(!_gfNotifAdmin())return;
  // Realtime chega com RLS; recarregamos pelo mesmo canal autenticado do sino.
  _gfNotifAtualizar(true);
}
document.addEventListener('pointerdown',_gfNotifDestravarAudio,{passive:true});
window.addEventListener('focus',()=>{
  if(_gfNotifAdmin()&&Date.now()-_gfNotifUltimaConsulta>6000)_gfNotifAtualizar(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&_gfNotifAdmin())_gfNotifAtualizar(true);
});
