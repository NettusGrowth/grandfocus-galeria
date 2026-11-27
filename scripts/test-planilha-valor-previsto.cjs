'use strict'
const fs=require('node:fs')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const {pathToFileURL}=require('node:url')
const path=require('node:path')
const html=fs.readFileSync('dist/contratar/planilha/index.html','utf8')
const source=fs.readFileSync('dist/contratar/planilha/planilha.js','utf8')
const edge=fs.readFileSync('supabase/functions/contratacao-admin/index.ts','utf8')
const migration=fs.readFileSync('supabase/sql/105_planilha_valor_previsto_ajustavel.sql','utf8')
let tests=0
function yes(x,msg){assert.ok(x,msg);tests++}
function eq(a,b,msg){assert.deepEqual(a,b,msg);tests++}
for(const id of ['value-dialog','value-form','value-amount','value-reason','value-save','value-before','value-received','value-error'])
 yes(html.includes('id="'+id+'"'),'Modal control missing '+id)
yes(source.includes("data.role==='super_admin'"),'Editable cell restricted to Super Admin')
yes(source.includes("r.source==='formulario'&&!r.archived"),'Archived and online rows are immutable')
yes(source.includes("request('planilha_ajustar_valor_previsto'"),'Must use server action')
yes(source.includes("notifyFinance('valor_previsto')"),'Financial dashboard notified')
yes(source.includes('valor_anterior_centavos:r.originalValue'),'Optimistic concurrency check')
yes(source.includes("valor_novo_centavos:novo,motivo"),'Reason and new value posted')
yes(source.includes("originalValue:r.valor_informado_centavos==null?null:Number(r.valor_informado_centavos)"),'Null old amount kept')
yes(edge.includes("case 'planilha_ajustar_valor_previsto'"),'Endpoint registered')
yes(edge.includes("if(role!=='super_admin')"),'Server endpoint denies non-superadmin')
yes(edge.includes('perfil_role:perfilRole'),'Role provided by authenticated server')
yes(edge.includes("admin.rpc('gf_contratacao_admin_ajustar_valor_previsto'"),'Server writes through audited RPC')
yes(migration.includes("role = 'super_admin'"),'RPC checks role')
yes(migration.includes("valor_informado_centavos = p_valor_novo_centavos"),'Correct financial field updated')
yes(migration.includes("valor_informado_centavos is distinct from p_valor_anterior_centavos"),'Concurrent changes rejected')
yes(migration.includes("'valor_previsto_ajustado_planilha'"),'Audit event')
yes(!migration.includes("set valor_recebido_centavos"),'No payment updates')
yes(!migration.includes("set pagamento_situacao"),'No payment status changes')
yes(migration.includes("revoke all on function")&&migration.includes("to service_role"),'Only service role may call RPC')
const fStart=source.indexOf('function parseMoneyCentsBRL(')
const fEnd=source.indexOf('function openValueEdit(',fStart)
yes(fStart>0&&fEnd>fStart,'Money parser available')
const ctx={}
vm.runInNewContext(source.slice(fStart,fEnd)+';globalThis.parse=parseMoneyCentsBRL',ctx,{timeout:1000})
for(const [input,expected] of [['0',0],['0,00',0],['80',8000],['80,5',8050],['80,50',8050],['1.234,50',123450],['1000000,00',100000000],['1.000.000,00',100000000],['',null],['-15',null],['1,999',null],['abc',null],['1,2.3',null],['1000001',null],['1.000.000,01',null]]){
 eq(ctx.parse(input),expected,'BRL parsing '+input)
}
async function run(){
 const financeSrc=fs.readFileSync('dist/contratar/admin/financeiro/finance-core.js','utf8')
 const core=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(financeSrc))
 const campaign={id:'camp',slug:'evento',nome_publico:'Evento'}
 const baseline={respostas:[{id:'form1',responsavel_nome:'Teste',valor_informado_centavos:8000,valor_recebido_centavos:2000,pagamento_situacao:'parcial'}]}
 const adjusted={respostas:[{...baseline.respostas[0],valor_informado_centavos:6500}]}
 const rowsOld=core.normalizeFinance(campaign,baseline)
 const rowsNew=core.normalizeFinance(campaign,adjusted)
 eq(core.financeTotals(rowsOld).closed,8000,'Previous estimated total')
 eq(core.financeTotals(rowsNew).closed,6500,'Revised estimated total')
 eq(core.financeTotals(rowsOld).received,2000,'Original payment')
 eq(core.financeTotals(rowsNew).received,2000,'Payment unchanged')
 eq(core.financeTotals(rowsNew).due,4500,'Remaining amount recalculated')
 const afterPaid={respostas:[{...adjusted.respostas[0],valor_informado_centavos:1500}]}
 eq(core.financeTotals(core.normalizeFinance(campaign,afterPaid)).due,0,'Overpaid never creates negative due')
 console.log('PASS planilha Valor previsto: '+tests+' assertions, server role and audit checks, BRL parser and Financeiro Geral formulas.')
}
run().catch(e=>{console.error(e);process.exitCode=1})
