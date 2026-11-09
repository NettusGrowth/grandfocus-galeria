import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=path=>fs.readFileSync(path,'utf8')
const redirects=JSON.parse(read('vercel.json')).rewrites
const a=redirects.findIndex(r=>r.source==='/contratar/natal-fada-acucarada-2026/')
const b=redirects.findIndex(r=>r.source==='/contratar/:slug/')
assert.ok(a>=0&&b>a,'A rota do Natal deve estar antes do fallback genérico.')
assert.equal(redirects[a].destination,'/contratar/fada-natal/index.html')
assert.ok(redirects.some(r=>r.source==='/contratar/:slug/'&&r.destination==='/contratar/entre-estacoes/index.html'),
 'Outras campanhas devem continuar usando o formulário existente.')
const html=read('contratar/fada-natal/index.html')
const publicJs=read('contratar/fada-natal/fada.js')
const adminHtml=read('contratar/entre-estacoes/admin/index.html')
const adminJs=read('contratar/entre-estacoes/admin/agenda.js')
const adminApi=read('supabase/functions/contratacao-admin/index.ts')
const publicApi=read('supabase/functions/contratacao-publica/index.ts')
const sql=read('supabase/sql/090_fada_natal_agenda_familias.sql')
assert.ok(html.includes('Você já realizou o pagamento?')&&html.includes('Escolha um horário disponível')&&
 html.includes('id="gf-fada-form"')&&html.includes('gf-submit'),'Formulário de Natal precisa das duas jornadas e do agendamento.')
assert.ok(publicJs.includes('1:8000,2:14500,3:21500,4:28500')&&
 publicJs.includes('natal_inscrever')&&publicJs.includes('natal_horarios')&&
 !publicJs.includes("action:'contratar'"),'Valor familiar e envio seguro devem ser separados do checkout.')
assert.ok(adminHtml.includes('id="gf-natal-schedule"')&&adminHtml.includes('id="gf-natal-build"')&&
 adminJs.includes('agenda_gerar_horarios')&&adminJs.includes('agenda_desativar_horario'),
 'A equipe deve editar intervalos e consultar ocupação sem código.')
assert.ok(adminApi.includes("case 'natal_agenda'")&&adminApi.includes("case 'natal_gerar_horarios'")&&
 adminApi.includes("case 'natal_atualizar_agendamento'")&&adminApi.includes("const REAL_PAYMENTS_ENABLED = false"),
 'Agenda administrativa deve continuar autenticada, sem liberar checkout real.')
assert.ok(publicApi.includes("case 'natal_horarios'")&&
 publicApi.includes("case 'natal_inscrever'")&&publicApi.includes("const REAL_PAYMENTS_ENABLED = false")&&
 publicApi.includes('gf_contratacao_registrar_tentativa'),
 'Inscrições usam controles de segurança; contratação InfinitePay continua desativada.')
assert.ok(sql.includes('for update')&&sql.includes('gf_natal_solicitar_horario')&&
 sql.includes('v_preco:=case v_count when 1 then 8000 when 2 then 14500 when 3 then 21500 else 28500 end')&&
 sql.includes("pagamento_situacao")&&sql.includes("revoke all on function")&&
 sql.includes('gf_natal_atualizar_agendamento'),'Agendamento precisa travar vagas, validar preços e proteger pagamentos.')
assert.ok(sql.includes('alter table public.gf_contratacao_horarios enable row level security')&&
 sql.includes('revoke all on public.gf_contratacao_horarios from public,anon,authenticated'),
 'Horários internos devem estar protegidos por RLS e permissões explícitas.')
assert.ok(!sql.includes('delete from public.gf_contratacao_pedidos')&&
 !sql.includes('drop table')&&
 !sql.includes('truncate '),'Não apagar histórico de clientes/pedidos.')
console.log('Fada Natal: verificações de segurança, preços, rotas e controle administrativo aprovadas.')
