import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {brl,normalizeFinance,financeTotals,filterFinance,statusGroup,due,exportFinanceCSV} from './finance-core.js';

const BASE='https://selnsjtumkxjrtnqofqx.supabase.co';
const KEY='sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0';
const client=createClient(BASE,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);
const state={all:[],campaigns:[],view:[],status:'geral',loading:false,partial:[],lastLoaded:null};
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
const values=()=>({school:$('school').value,campaign:$('campaign').value,type:$('type').value,
 method:$('method').value,query:$('query').value,from:$('from').value,to:$('to').value,status:state.status});
function opt(select,value,label){const o=new Option(label,value);select.add(o);}
async function request(action,fields={},token){
 const response=await fetch(BASE+'/functions/v1/contratacao-admin',{
  method:'POST',
  headers:{apikey:KEY,'Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify({action,...fields}),signal:AbortSignal.timeout(25000)
 });
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(json.error||'Não foi possível consultar o financeiro.');
 return json;
}
function summary(){
 const totals=financeTotals(state.view);
 $('stat-closed').textContent=brl(totals.closed);
 $('stat-received').textContent=brl(totals.received);
 $('stat-due').textContent=brl(totals.due);
 $('result-count').textContent=state.view.length+' registro(s) · '+totals.activeCount+' contrato(s) ativo(s) · '+totals.reviewCount+' aguardando conferência';
 const warnings=[];
 if(totals.missingValue)warnings.push(totals.missingValue+' registro(s) ativo(s) sem valor definido; não entram na soma do valor fechado.');
 if(totals.received>totals.closed)warnings.push('O recebido excede o valor fechado neste filtro: confira os lançamentos e os valores informados.');
 if(state.partial.length)warnings.push('Atenção: consulta incompleta em '+state.partial.length+' campanha(s): '+state.partial.join(', ')+'. Os totais podem estar subestimados.');
 $('financial-warning').hidden=!warnings.length;
 $('financial-warning').textContent=warnings.join(' ');
}
function recordStatus(r){const s=statusGroup(r);return ({
 confirmado:'Confirmado',parcial:'Parcial',pendente:'Pendente',
 conferir:'A conferir',cancelado:r.archived?'Arquivado':r.state==='reembolsado'?'Reembolsado':'Cancelado / expirado'
})[s];}
function appendCell(tr,text,cls){const c=element('td',text,cls);tr.append(c);return c;}
function buildRows(){
 const body=$('records');body.replaceChildren();
 if(!state.view.length){const tr=element('tr');const td=appendCell(tr,'Nenhum registro encontrado. Experimente limpar os filtros.','empty');td.colSpan=9;body.append(tr);return;}
 const frag=document.createDocumentFragment();
 for(const r of [...state.view].sort((a,b)=>String(b.date).localeCompare(String(a.date)))){
  const tr=element('tr');
  const person=appendCell(tr,null);person.append(element('strong',r.name),element('small',r.dancer || 'Sem nome de bailarina'));
  const school=appendCell(tr,null);school.append(element('strong',r.school),element('small',r.campaign));
  appendCell(tr,r.package);
  appendCell(tr,r.value==null?'A conferir':brl(r.value),'amount');
  appendCell(tr,brl(r.paid),'amount value-positive');
  appendCell(tr,brl(due(r)),'amount value-due');
  const status=appendCell(tr,null);status.append(element('span',recordStatus(r),'pill '+statusGroup(r)));
  const appointment=appendCell(tr,null);appointment.append(element('span',r.schedule||'—'));if(r.scheduleState)appointment.append(element('small',r.scheduleState));
  const action=appendCell(tr,null);
  const link=element('a',r.source==='formulario'?'Abrir ficha ↗':'Ver pedido ↗','row-link');
  link.href=r.source==='formulario'?
   '/contratar/planilha/?campanha='+encodeURIComponent(r.slug)+(r.archived?'&situacao=arquivados':'')+'&editar='+encodeURIComponent(r.id):
   '/contratar/'+encodeURIComponent(r.slug)+'/admin/#respostas';
  link.title='Abrir registro na administração para conferir ou corrigir o pagamento';
  action.append(link);frag.append(tr);
 }
 body.append(frag);
}
function apply(){
 state.view=filterFinance(state.all,values());
 summary();buildRows();
}
function updateSelects(){
 const existingSchool=$('school').value,existingCampaign=$('campaign').value;
 $('school').length=1;$('campaign').length=1;
 const schoolMap=new Map(state.campaigns.map(c=>[c.escola_id,c.escola_nome]));
 for(const [id,name] of [...schoolMap].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'pt-BR')))if(id)opt($('school'),id,name);
 for(const c of state.campaigns.filter(c=>!$('school').value||c.escola_id===$('school').value)
   .sort((a,b)=>a.nome_publico.localeCompare(b.nome_publico,'pt-BR')))opt($('campaign'),c.slug,c.nome_publico+' · '+c.escola_nome);
 if([...$('school').options].some(o=>o.value===existingSchool))$('school').value=existingSchool;
 if([...$('campaign').options].some(o=>o.value===existingCampaign))$('campaign').value=existingCampaign;
 updateCampaignSelect();
}
function updateCampaignSelect(){
 const old=$('campaign').value;$('campaign').length=1;
 for(const c of state.campaigns.filter(c=>!$('school').value||c.escola_id===$('school').value)
  .sort((a,b)=>String(a.nome_publico).localeCompare(String(b.nome_publico),'pt-BR')))
   opt($('campaign'),c.slug,c.nome_publico+' · '+c.escola_nome);
 if([...$('campaign').options].some(o=>o.value===old))$('campaign').value=old;
 apply();
}
async function load(){
 if(state.loading)return;
 state.loading=true;$('refresh').disabled=true;
 $('loading-panel').hidden=false;$('error-panel').hidden=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw new Error('Faça login em /contratar/admin/ antes de abrir o Financeiro.');
  const token=session.access_token;
  // A API exige role admin/super_admin no servidor; nenhum dado é consultado sem sessão autorizada.
  const [active,archived]=await Promise.all([
   request('listar_campanhas',{},token),
   request('listar_campanhas',{incluir_ocultas:true},token)
  ]);
  const campaigns=[...(active.campanhas||[]),...(archived.campanhas||[])];
  const unique=[...new Map(campaigns.map(c=>[c.id,c])).values()];
  const results=Array(unique.length);
  let next=0;
  async function worker(){
   while(next<unique.length){
    const i=next++,c=unique[i];
    try{const payload=await request('central_listar',{slug:c.slug},token);
      results[i]={rows:normalizeFinance(c,payload),truncated:Boolean(payload.resultados_possivelmente_truncados)};
    }catch(error){results[i]={error:error.message};}
   }
  }
  await Promise.all(Array.from({length:Math.min(4,unique.length)},()=>worker()));
  state.campaigns=unique;
  state.all=results.flatMap(x=>x?.rows||[]);
  state.partial=results.flatMap((x,i)=>x?.error?[unique[i].nome_publico+' ('+x.error+')']:x?.truncated?[unique[i].nome_publico+' (mais de 1.000 registros)']:[]);
  updateSelects();
  $('dashboard').hidden=false;state.lastLoaded=new Date();
  $('updated').textContent='Atualizado às '+state.lastLoaded.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  apply();
 }catch(error){
  $('error-panel').textContent=error.message;
  $('error-panel').hidden=false;
 }finally{state.loading=false;$('refresh').disabled=false;$('loading-panel').hidden=true;}
}
for(const id of ['campaign','type','method','from','to'])$(id).addEventListener('change',apply);
$('school').addEventListener('change',updateCampaignSelect);
$('query').addEventListener('input',apply);
document.querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{
 state.status=button.dataset.status;
 document.querySelectorAll('[data-status]').forEach(b=>b.classList.toggle('on',b===button));
 apply();
}));
$('reset').addEventListener('click',()=>{
 for(const id of ['school','campaign','type','method','from','to','query'])$(id).value='';
 state.status='geral';document.querySelectorAll('[data-status]').forEach(b=>b.classList.toggle('on',b.dataset.status==='geral'));
 updateCampaignSelect();
});
$('refresh').addEventListener('click',load);
$('export').addEventListener('click',()=>{
 const csv=exportFinanceCSV(state.view);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=element('a');
 a.href=url;a.download='Grand_Focus_Financeiro_'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
if(typeof BroadcastChannel==='function'){
 const channel=new BroadcastChannel('gf-contratacao-sync');
 channel.onmessage=()=>{if(!document.hidden)void load();};
}
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden && (!state.lastLoaded || Date.now()-state.lastLoaded.getTime()>15000))void load();
});
setInterval(()=>{if(!document.hidden)void load();},30000);
void load();
