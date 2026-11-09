-- Agendamento genérico: teste transacional, sem persistir inscrições.
begin;
-- Usa role real da Edge Function e nunca concede permissão para visitantes.
set local role service_role;
do $slots$
declare
 v_actor uuid:='11111111-1111-4111-8111-111111111111';
 v_school uuid:='7896da46-5dd8-4d4e-ac50-36fda4966566';
 v_result jsonb;v_slot uuid;v_first jsonb;v_id uuid;v_count integer;
begin
 if has_table_privilege('anon','public.gf_contratacao_horarios','SELECT')
    or has_table_privilege('authenticated','public.gf_contratacao_horarios','SELECT')
    or has_function_privilege('anon','public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.gf_contratacao_admin_salvar_modo_agendamento(text,text,uuid)','EXECUTE')
 then raise exception 'Acesso público indevido aos agendamentos.';end if;

 v_result:=public.gf_contratacao_admin_criar_campanha(
   'Natal Fada Açucarada 2026','2026-12-12'::date,v_school,
   'natal-fada-acucarada-2026',v_actor);
 if v_result->>'status'<>'rascunho' then raise exception 'Campanha não começou em rascunho.';end if;

 -- Por padrão, todo novo evento usa ordem de chegada.
 if (select modo_agendamento from public.gf_contratacao_eventos
     where slug='natal-fada-acucarada-2026')<>'ordem_chegada' then
  raise exception 'Modo padrão incorreto.';end if;

 v_result:=public.gf_contratacao_admin_salvar_modo_agendamento(
  'natal-fada-acucarada-2026','horario_marcado',v_actor);
 if v_result->>'modo_agendamento'<>'horario_marcado' then
  raise exception 'Não foi possível mudar o agendamento.';end if;
 begin
  perform public.gf_contratacao_admin_salvar_modo_agendamento(
   'natal-fada-acucarada-2026','invalidado',v_actor);
  raise exception 'Aceitou modo inválido.';
 exception when others then
  if sqlerrm not like '%modo de agendamento válido%' then raise;end if;
 end;
 begin
  perform public.gf_contratacao_admin_salvar_modo_agendamento(
   'natal-fada-acucarada-2026','ordem_chegada',
   '22222222-2222-4222-8222-222222222222'::uuid);
  raise exception 'Permitiu que usuário comum mudasse o modo.';
 exception when others then
  if sqlerrm not like '%Acesso administrativo necessário%' then raise;end if;
 end;

 v_result:=public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026','2026-12-12'::date,'14:00'::time,'15:00'::time,20,v_actor);
 if (v_result->>'novos')::integer<>3 then raise exception 'Esperados 3 horários de 20 minutos.';end if;
 v_result:=public.gf_natal_listar_horarios('natal-fada-acucarada-2026',true);
 if jsonb_array_length(v_result->'horarios')<>3 then raise exception 'Agenda não listou os três horários.';end if;
 select id into v_slot from public.gf_contratacao_horarios
  where dia='2026-12-12' and inicio='14:00' and evento_contratacao_id=
     (select id from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026');

 -- Simula publicação somente dentro de uma transação revertida.
 update public.gf_contratacao_eventos set status='publicado'
  where slug='natal-fada-acucarada-2026';
 v_first:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_slot,'Responsável de Teste','16988887777',
  'teste@example.com','[{"nome":"Aluno de Teste","turma":"Ballet"}]'::jsonb,
  'ja_paguei','pix',null,'Com família','Teste de vaga',gen_random_uuid(),true);
 if v_first->>'ja_pago_declarado'<>'true' or
   (select count(*) from public.gf_contratacao_form_respostas
       where origem='formulario_site' and pagamento_situacao='nao_conferido')<>1 then
  raise exception 'Declaração de pagamento não pode marcar recebimento.';
 end if;
 begin
  perform public.gf_natal_solicitar_horario(
   'natal-fada-acucarada-2026',v_slot,'Outra Responsável','16988886666',
   '', '[{"nome":"Segunda Aluna","turma":"Jazz"}]'::jsonb,
   'a_pagar','',null,'','',gen_random_uuid(),true);
  raise exception 'Permitiu duas famílias no mesmo horário.';
 exception when others then
  if sqlerrm not like '%acabou de ser escolhido%' then raise;end if;
 end;
 begin
  perform public.gf_contratacao_admin_salvar_modo_agendamento(
   'natal-fada-acucarada-2026','ordem_chegada',v_actor);
  raise exception 'Permitiu retirar horários com inscrições ativas.';
 exception when others then
  if sqlerrm not like '%reservas ativas%' then raise;end if;
 end;
 select id into v_id from public.gf_contratacao_form_respostas
  where origem='formulario_site' and responsavel_nome='Responsável de Teste';
 perform public.gf_contratacao_admin_registrar_pagamento_externo(
  (select id from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026'),
  v_id,'pago_manual',8000,'pix','PIX_TESTE_12345',
  'Simulação sem movimentação bancária',true,v_actor);
 v_result:=public.gf_natal_atualizar_agendamento(
  'natal-fada-acucarada-2026',v_id,'confirmado',v_actor);
 if v_result->>'status'<>'confirmado' then raise exception 'Conferência não confirmou o atendimento.';end if;
 if (select count(*) from public.gf_contratacao_form_respostas
     where agendamento_status='confirmado' and origem='formulario_site')<>1 then
  raise exception 'Confirmação de horário ausente.';end if;

 -- Outra campanha independente pode usar chegada sem hora.
 v_result:=public.gf_contratacao_admin_criar_campanha(
  'Evento sem agendamento','2026-12-12'::date,v_school,'outro-evento-teste',v_actor);
 if (select modo_agendamento from public.gf_contratacao_eventos
     where slug='outro-evento-teste')<>'ordem_chegada' then
   raise exception 'Outra campanha não deveria herdar horário marcado.';end if;
end
$slots$;
rollback;
