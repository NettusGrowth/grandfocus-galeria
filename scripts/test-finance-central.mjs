import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../contratar/admin/financeiro/finance-core.js',import.meta.url),'utf8');
const {normalizeFinance,financeTotals,filterFinance,statusGroup,due,exportFinanceCSV}=
  await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const campaign={id:'c1',slug:'natal',nome_publico:'Natal',escola_id:'e1',escola_nome:'Fada'};
const payload={pedidos:[
 {id:'p1',status:'pago',valor_total_centavos:15900,valor_pago_centavos:15900,responsavel_nome:'Ana',participantes:[{nome:'Lia',pacote:'Completo'}]},
 {id:'p2',status:'pagamento_pendente',valor_total_centavos:7900,valor_pago_centavos:0,responsavel_nome:'Bia'},
 {id:'p3',status:'reembolsado',valor_total_centavos:11900,valor_pago_centavos:11900,responsavel_nome:'Reembolso'},
],respostas:[
 {id:'f1',pagamento_situacao:'nao_conferido',valor_informado_centavos:8000,valor_recebido_centavos:0,responsavel_nome:'Carol',pagamento_preferido:'pix'},
 {id:'f2',pagamento_situacao:'parcial',valor_informado_centavos:15000,valor_recebido_centavos:5000,responsavel_nome:'Dani',pagamento_metodo:'pix'},
 {id:'f3',pagamento_situacao:'pago_manual',valor_informado_centavos:14500,valor_recebido_centavos:14500,responsavel_nome:'Eva'},
 {id:'f4',pagamento_situacao:'cancelado',valor_informado_centavos:8000,valor_recebido_centavos:0,responsavel_nome:'Cancelada'},
],horarios:[]};
const rows=normalizeFinance(campaign,payload);
const totals=financeTotals(rows);
assert.equal(rows.length,7);
assert.equal(totals.closed,15900+7900+8000+15000+14500);
assert.equal(totals.received,15900+5000+14500);
assert.equal(totals.due,7900+8000+10000);
assert.equal(statusGroup(rows.find(r=>r.id==='f1')),'conferir');
assert.equal(statusGroup(rows.find(r=>r.id==='f2')),'parcial');
assert.equal(statusGroup(rows.find(r=>r.id==='p3')),'cancelado');
assert.equal(due(rows.find(r=>r.id==='p3')),0);
assert.equal(filterFinance(rows,{school:'e1',status:'a-receber'}).length,3);
assert.equal(filterFinance(rows,{school:'e2',status:'geral'}).length,0);
assert.equal(filterFinance(rows,{method:'pix',status:'geral'}).length,2);
assert.equal(filterFinance(rows,{query:'lia',status:'geral'}).length,1);
const csv=exportFinanceCSV([{...rows[0],name:'=HYPERLINK("x")'}]);
assert.match(csv,/"'=HYPERLINK/);
assert.match(csv,/Valor fechado/);
console.log('Financeiro central: conciliação, filtros, cancelados, preferências e CSV OK.');
