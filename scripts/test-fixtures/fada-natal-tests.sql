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
 begin
  perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
   '2026-12-12'::date,'12:00'::time,'14:00'::time,30,'11111111-1111-4111-8111-111111111111');
  raise exception 'Permitiu gerar slots iguais novamente.';
 exception when others then
  if sqlerrm not like '%Nenhum horário novo%' then raise;end if;
 end;
 -- Abrir exclusivamente nesta transação de teste; a produção permanece em rascunho.
 update public.gf_contratacao_eventos set status='publicado'
 where slug='natal-fada-acucarada-2026';
 for v_student_count in 1..4 loop
  select id into v_slot from public.gf_contratacao_horarios
   where dia='2026-12-12' and evento_contratacao_id=(
    select id from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026'
   ) order by inicio offset (v_student_count-1) limit 1;
  v_students:=(
   select jsonb_agg(jsonb_build_object('nome','Aluno de Teste '||g.n,'turma','Ballet'))
   from generate_series(1,v_student_count) as g(n)
  );
  v_expected:=case v_student_count when 1 then 8000 when 2 then 14500
    when 3 then 21500 else 28500 end;
  v_response:=public.gf_natal_solicitar_horario(
   'natal-fada-acucarada-2026',v_slot,'Responsável de Teste','16999999999','',
   v_students,case when v_student_count=1 then 'ja_paguei' else 'a_pagar' end,
   case when v_student_count=1 then 'pix' else '' end,null,
   'Família de Teste','','33333333-3333-4333-8333-333333333333'::uuid,
   true
  );
  if (v_response->>'valor_centavos')::integer <> v_expected then
   raise exception 'Valor familiar incorreto para % alunos',v_student_count;end if;
  if (v_response->>'ja_pago_declarado')::boolean <> (v_student_count=1) then
   raise exception 'Declaração de pagamento foi alterada.';end if;
 end loop;
 -- A consulta pública não deve expor os nomes, telefones ou situação de pagamento.
 v_response:=public.gf_natal_listar_horarios('natal-fada-acucarada-2026',false);
 if (v_response->>'disponivel')<>'true' or
   (select count(*) from jsonb_array_elements(v_response->'horarios') j where (j->>'disponiveis')::int=0)<>4
 then raise exception 'Quatro slots deveriam estar ocupados.';end if;
 select id into v_id from public.gf_contratacao_form_respostas
   where origem_chave='fada-natal-2026:33333333-3333-4333-8333-333333333333';
 if v_id is null then raise exception 'Resposta do site não foi registrada.';end if;
 if (select pagamento_situacao from public.gf_contratacao_form_respostas where id=v_id)<>'nao_conferido'
 then raise exception 'Pagamento declarado virou confirmado automaticamente.';end if;
 begin
  perform public.gf_natal_atualizar_agendamento('natal-fada-acucarada-2026',v_id,
   'confirmado','11111111-1111-4111-8111-111111111111');
  raise exception 'Permitiu confirmar antes de conferir o pagamento.';
 exception when others then
  if sqlerrm not like '%Confira e registre o pagamento integral%' then raise;end if;
 end;
 select id into v_slot from public.gf_contratacao_horarios
  where dia='2026-12-12' and inicio='12:00';
 begin
  perform public.gf_natal_solicitar_horario(
   'natal-fada-acucarada-2026',v_slot,'Outra Responsável','16911111111','',
   '[{"nome":"Outra Aluna","turma":"Ballet"}]'::jsonb,'a_pagar','',null,'','',
   '44444444-4444-4444-8444-444444444444',true);
  raise exception 'Duas famílias conseguiram ocupar o mesmo horário.';
 exception when others then
  if sqlerrm not like '%outra família%' then raise;end if;
 end;
 -- Conferência oficial pelo administrador; a declaração da família não basta.
 perform public.gf_contratacao_admin_registrar_pagamento_externo(
  (select id from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026'),
  v_id,'pago_manual',8000,'pix','PIX_SIMULADO_123',
  'Conferência fictícia revertida ao final',true,
  '11111111-1111-4111-8111-111111111111');
 v_response:=public.gf_natal_atualizar_agendamento('natal-fada-acucarada-2026',v_id,
  'confirmado','11111111-1111-4111-8111-111111111111');
 if v_response->>'status'<>'confirmado' then raise exception 'Confirmação administrativa não funcionou.';end if;
 if (select count(*) from public.gf_contratacao_pedidos where
   evento_contratacao_id=(select id from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026'))>0
 then raise exception 'A inscrição não deve criar pedidos de checkout.';end if;
end
$fada_tests$;
rollback;
