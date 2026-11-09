-- Suíte isolada: Natal Fada Açucarada. Sempre rollback.
begin;
set local role service_role;
do $test_natal$
declare
 v_evento uuid;
 v_slot uuid;
 v_second uuid;
 v_resposta uuid;
 v_admin uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 v_return jsonb;
 v_slots jsonb;
 v_count integer;
begin
 if has_function_privilege('anon',
  'public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)','EXECUTE')
  or has_function_privilege('authenticated',
  'public.gf_natal_gerar_horarios(text,date,time,time,integer,uuid)','EXECUTE') then
  raise exception 'Uma função da agenda ficou exposta fora do serviço.';
 end if;
 perform public.gf_contratacao_admin_criar_campanha(
  'Natal Teste',date '2026-12-12',
  '7896da46-5dd8-4d4e-ac50-36fda4966566',
  'natal-fada-acucarada-2026',v_admin);
 select id into v_evento from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026';
 if v_evento is null then raise exception 'Campanha fixture não criada.';end if;
 v_return:=public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026',date '2026-12-12',time '14:00',time '14:40',20,v_admin);
 if v_return->>'novos'<>'2' then raise exception 'Grade esperada 2 slots.';end if;
 v_slots:=public.gf_natal_listar_horarios('natal-fada-acucarada-2026',true);
 if jsonb_array_length(v_slots->'horarios')<>2 then raise exception 'Agenda administrativa deve listar 2 horários.';end if;
 v_slots:=public.gf_natal_listar_horarios('natal-fada-acucarada-2026',false);
 if v_slots->>'disponivel'<>'false' then raise exception 'Campanha em rascunho visível ao público.';end if;
 select id into v_slot from public.gf_contratacao_horarios where evento_contratacao_id=v_evento and inicio='14:00';
 select id into v_second from public.gf_contratacao_horarios where evento_contratacao_id=v_evento and inicio='14:20';
 update public.gf_contratacao_eventos set status='publicado' where id=v_evento;
 v_return:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_slot,'Responsavel Teste Natal','16999998888','',
  '[{"nome":"Criança Um","turma":"Ballet"},{"nome":"Criança Dois","turma":"Jazz"}]'::jsonb,
  'ja_paguei','pix',date '2026-11-09','Mãe','Acompanhante de Natal',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 if v_return->>'valor_centavos'<>'14500' or v_return->>'ja_pago_declarado'<>'true' then
  raise exception 'Preço familiar / caminho já pago incorreto.';
 end if;
 select id into v_resposta from public.gf_contratacao_form_respostas
 where origem_chave='fada-natal-2026:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v_resposta is null or
  (select pagamento_situacao from public.gf_contratacao_form_respostas where id=v_resposta)<>'nao_conferido' or
  (select valor_recebido_centavos from public.gf_contratacao_form_respostas where id=v_resposta)<>0 then
  raise exception 'Declaração de pagamento não pode virar comprovante.';
 end if;
 v_return:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_slot,'Responsavel Teste Natal','16999998888','',
  '[{"nome":"Criança Um","turma":"Ballet"},{"nome":"Criança Dois","turma":"Jazz"}]'::jsonb,
  'ja_paguei','pix',date '2026-11-09','Mãe','Acompanhante de Natal',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 if v_return->>'reutilizado'<>'true' then raise exception 'Reenvio idempotente precisa reutilizar registro.';end if;
 begin
  perform public.gf_natal_solicitar_horario(
   'natal-fada-acucarada-2026',v_slot,'Outra Responsavel Teste','16988887777','',
   '[{"nome":"Criança Terceira","turma":"Ballet"}]'::jsonb,
   'a_pagar','',null,'','', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  raise exception 'Permitiu duas famílias no mesmo horário.';
 exception when others then
  if sqlerrm not like '%acabou de ser escolhido%' then raise;end if;
 end;
 begin
  perform public.gf_natal_atualizar_agendamento(
   'natal-fada-acucarada-2026',v_resposta,'confirmado',v_admin);
  raise exception 'Confirmou horário sem conferir pagamento.';
 exception when others then
  if sqlerrm not like '%Confira e registre o pagamento%' then raise;end if;
 end;
 perform public.gf_contratacao_admin_registrar_pagamento_externo(
  v_evento,v_resposta,'pago_manual',14500,'pix',
  'RECIBO_SIMULADO_NATAL','Recebimento validado em teste',true,v_admin);
 perform public.gf_natal_atualizar_agendamento('natal-fada-acucarada-2026',v_resposta,'confirmado',v_admin);
 if (select agendamento_status from public.gf_contratacao_form_respostas where id=v_resposta)<>'confirmado' then
  raise exception 'Confirmação manual falhou.';
 end if;
 v_return:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_second,'Outra Responsavel Teste','16988887777','',
  '[{"nome":"Criança Um","turma":""},{"nome":"Criança Dois","turma":""},{"nome":"Criança Três","turma":""}]'::jsonb,
  'a_pagar','',null,'Pai','',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 if v_return->>'valor_centavos'<>'21500' then raise exception 'Preço de 3 alunos incorreto.';end if;
 select id into v_resposta from public.gf_contratacao_form_respostas
  where origem_chave='fada-natal-2026:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if (select pagamento_situacao from public.gf_contratacao_form_respostas where id=v_resposta)<>'pendente'
 then raise exception 'Cadastro sem pagamento deve ficar pendente.';end if;
 perform public.gf_natal_atualizar_agendamento('natal-fada-acucarada-2026',v_resposta,'cancelado',v_admin);
 v_slots:=public.gf_natal_listar_horarios('natal-fada-acucarada-2026',true);
 if (select (elem->>'disponiveis')::integer from jsonb_array_elements(v_slots->'horarios') elem
  where elem->>'inicio'='14:20')<>1 then raise exception 'Cancelamento não liberou o horário.';end if;
 if not exists (select 1 from public.gf_contratacao_auditoria where acao='agendamento_natal_confirmado')
 then raise exception 'Faltou auditoria da confirmação.';end if;
end $test_natal$;
rollback;