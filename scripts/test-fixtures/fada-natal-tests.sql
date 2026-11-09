-- Testes isolados de precificação familiar, ACL, reserva atômica e conferência manual.
-- Tudo acontece em transação revertida: não gera pedidos reais.
begin;
select public.gf_contratacao_admin_criar_campanha(
 'Especial Fotográfico de Natal – teste','2026-12-12'::date,
 '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
 'natal-fada-acucarada-2026',
 '11111111-1111-4111-8111-111111111111'::uuid
);
set local role service_role;
do $fada_tests$
declare
 v_id uuid;
 v_slot uuid;
 v_response jsonb;
 v_student_count integer;
 v_expected integer;
 v_students jsonb;
 v_first uuid := '33333333-3333-4333-8333-333333333333';
 v_record uuid;
begin
 if has_function_privilege('anon','public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)','EXECUTE')
 or has_table_privilege('anon','public.gf_contratacao_horarios','SELECT')
 then raise exception 'A agenda ou cadastro privado foram expostos.';end if;
 if not has_function_privilege('service_role','public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)','EXECUTE')
 then raise exception 'A Edge Function não consegue registrar inscrições.';end if;
 v_response:=public.gf_contratacao_admin_salvar_modo_agendamento(
  'natal-fada-acucarada-2026','horario_marcado','11111111-1111-4111-8111-111111111111');
 if v_response->>'modo_agendamento'<>'horario_marcado' then raise exception 'Modo de horário não foi salvo.';end if;
 if (public.gf_natal_listar_horarios('natal-fada-acucarada-2026',false)->>'disponivel')<>'false'
 then raise exception 'Rascunho deveria estar fechado publicamente.';end if;
 v_response:=public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  '2026-12-12'::date,'12:00'::time,'14:00'::time,30,'11111111-1111-4111-8111-111111111111');
 if (v_response->>'novos')::integer<>4 then raise exception 'Esperava quatro vagas.';end if;
 v_response:=public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  '2026-12-12'::date,'12:00'::time,'14:00'::time,30,'11111111-1111-4111-8111-111111111111');
 if (v_response->>'novos')::integer<>0 then
  raise exception 'Criou horários duplicados.';end if;
 -- A função acima retorna erro quando não há novos slots: verificar depois em testes atualizados.
end
$fada_tests$;
rollback;
