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
const adminJs=read('contratar/fada-natal/admin.js')
const adminApi=read('supabase/functions/contratacao-admin/index.ts')
const publicApi=read('supabase/functions/contratacao-publica/index.ts')
const sql=read('supabase/sql/090_fada_natal_agenda_familias.sql')
assert.ok(html.includes('Você já realizou o pagamento?')&&html.includes('não a turma inteira')&&html.includes('Escolha o horário do ensaio')&&html.includes('id="gf-time-block"')&&
 html.includes('id="gf-fada-form"')&&html.includes('gf-submit'),'Formulário de Natal precisa das duas jornadas e do agendamento.')
assert.ok(publicJs.includes('1:8000,2:14500,3:21500,4:28500')&&
 publicJs.includes('natal_inscrever')&&publicJs.includes('natal_horarios')&&
 !publicJs.includes("action:'contratar'"),'Valor familiar e envio seguro devem ser separados do checkout.')
assert.ok(adminHtml.includes('id="gf-natal-schedule"')&&adminHtml.includes('id="gf-natal-build"')&&
 adminJs.includes('natal_gerar_horarios')&&adminJs.includes('natal_desativar_horario'),
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
const sql92=read('supabase/sql/092_fada_natal_reserva_consecutiva_temporaria.sql')
assert.ok(sql92.includes('gf_natal_holds')&&sql92.includes("interval '10 minutes'")&&
 sql92.includes('gf_natal_intervalo_livre')&&sql92.includes('gf_natal_reservar_temporariamente')&&
 sql92.includes('for update')&&sql92.includes('gf_natal_liberar_reserva'),
 'A retenção de 10 minutos deve ser garantida transacionalmente no banco.')
assert.ok(sql92.includes("v_preco:=case v_count when 1 then 8000 when 2 then 14500 when 3 then 21500 else 28500 end")&&
 sql92.includes('p_quantidade*15')&&
 sql92.includes('gf_natal_atualizar_agendamento')&&
 sql92.includes("revoke all on public.gf_natal_holds from public,anon,authenticated"),
 'A nova versão deve preservar preço familiar, escopo e política de permissões.')
assert.ok(!sql92.includes('drop table')&&!sql92.includes('truncate '),
 'A mudança não pode excluir histórico existente.')
const sql95=read('supabase/sql/095_fada_natal_envio_atomico_sem_cronometro.sql')
assert.ok(sql95.includes('gf_natal_solicitar_sem_cronometro')&&
 sql95.includes('for update')&&
 sql95.includes('gf_natal_reservar_temporariamente')&&
 sql95.includes('gf_natal_solicitar_horario'),
 'O envio deverá conferir, bloquear e cadastrar numa só transação.')
assert.ok(publicApi.includes("admin.rpc('gf_natal_solicitar_sem_cronometro'")&&
 !publicJs.includes('natal_seguranca_horario')&&
 !publicJs.includes('gf-hold-time')&&
 !html.includes('id="gf-hold"')&&
 !html.includes('id="gf-family-options"')&&
 !html.includes('id="gf-note"'),
 'O formulário não deve segurar horário antes do envio nem exibir campos opcionais desnecessários.')
const termosPage=read('contratar/fada-natal/termos.html')
const privacidadePage=read('contratar/fada-natal/privacidade.html')
const termosSource=read('contratar/fada-natal/termos.txt')
const privacidadeSource=read('contratar/fada-natal/privacidade.txt')
assert.ok(termosPage.includes('69.691.249/0001-97')&&
 privacidadePage.includes('69.691.249/0001-97')&&
 termosPage.includes('10 dias corridos')&&
 termosPage.includes('12 de dezembro')&&
 termosPage.includes('13 de dezembro')&&
 termosPage.includes('direito legal de arrependimento'),
 'Termos de Natal precisam informar fornecedor, oferta, entrega e direitos do consumidor.')
assert.ok(privacidadePage.includes('Crianças e adolescentes')&&
 privacidadePage.includes('Seus direitos')&&
 privacidadePage.includes('Não vendemos cadastros'),
 'Política de privacidade deve proteger dados de menores e explicar o tratamento.')
assert.ok(termosSource.includes('A escolha do horário no formulário é apenas uma preferência')&&
 !termosSource.includes('o retém por até 10 minutos')&&
 termosSource.includes('R$ 285,00')&&
 privacidadeSource.includes('menores')&&
 html.includes('href="/contratar/fada-natal/termos.html"')&&
 html.includes('href="/contratar/fada-natal/privacidade.html"')&&
 html.includes('id="gf-consent"'),
 'Formulário deve disponibilizar documentos e colher aceite antes de enviar.')
const genteHtml=read('contratar/gente-que-danca/index.html')
const genteJs=read('contratar/gente-que-danca/gente.js')
const genteSql=read('supabase/sql/096_gente_que_danca_inscricoes.sql')
assert.ok(redirects.some(x=>x.source==='/contratar/gente-que-danca-2026/'&&x.destination==='/contratar/gente-que-danca/index.html'),'Rota pública da Gente que Dança ausente.')
assert.ok(genteHtml.includes('R$ 150,00')&&genteHtml.includes('15 de dezembro de 2026')&&
 genteHtml.includes('id="gente-form"')&&genteHtml.includes('Cartão de crédito')&&
 genteHtml.includes('Pix')&&!genteHtml.includes('5 fotografias'),'Formulário Gente deve seguir somente as condições reais do acordo.')
const genteAgendaSql=read('supabase/sql/101_gente_reserva_familia_15min_desconto.sql')
assert.ok(genteJs.includes("api('gente_inscrever'")&&genteJs.includes("api('gente_horarios'")&&
 genteJs.includes("price=n=>n===2?27000:15000")&&
 genteAgendaSql.includes('gf_gente_solicitar_agendamento')&&
 genteAgendaSql.includes('gf_gente_intervalo_livre')&&
 genteAgendaSql.includes('15:00')===false &&
 genteHtml.includes('18h às 22h')&&
 genteHtml.includes('id="gente-times"')&&
 genteHtml.includes('R$ 30 de desconto')&&
 genteHtml.includes('Especial de Natal')&&
 genteHtml.includes('Galeria Grand Focus')&&
 genteHtml.includes('Solicitar horário e continuar')&&
 genteHtml.includes('data-count="1"')&&genteHtml.includes('data-count="2"')&&
 !genteHtml.includes('data-count="3"')&&!genteHtml.includes('data-count="4"')&&
 !genteJs.includes('natal_horarios')&&
 publicApi.includes("students.length>2")&&
 publicApi.includes("quantidade>2"),
 'Gente precisa de horários reais, desconto familiar e cadastro atômico.')
assert.ok(read('contratar/entre-estacoes/admin/index.html').includes('data-workspace-tab="financeiro"')&&
 read('contratar/planilha/planilha.js').includes("setInterval")&&
 read('contratar/admin/manager.js').includes("card.tabIndex = 0"),
 'Admin deve separar Financeiro, oferecer planilha e cartões acessíveis.')

console.log('Fada e Gente: formulários, admin e regras da parceria validados.')
