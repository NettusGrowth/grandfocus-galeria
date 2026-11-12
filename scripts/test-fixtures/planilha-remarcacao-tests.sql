-- Regressão da remarcação: execução apenas no PostgreSQL temporário do CI.
-- Nenhuma mudança persiste: toda a suíte está em BEGIN/ROLLBACK.
begin;
set local role service_role;
do $test$
declare
 admin_id uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 gente uuid; natal uuid;inicio_g uuid;novo_g uuid;ocupado_g uuid;
 outro_g uuid; r_g uuid; r_outro uuid;
 sabado uuid;domingo uuid;r_n uuid;token_n uuid:=gen_random_uuid();
 retorno jsonb;lista jsonb;oldPaid integer;oldStatus text;v uuid;
begin
 select id into strict gente from public.gf_contratacao_eventos
  where slug='gente-que-danca-2026' for update;
 update public.gf_contratacao_eventos set status='publicado' where id=gente;
 select id into strict inicio_g from public.gf_contratacao_horarios
  where evento_contratacao_id=gente and inicio='18:00';
 select id into strict novo_g from public.gf_contratacao_horarios
  where evento_contratacao_id=gente and inicio='18:30';
 select id into strict ocupado_g from public.gf_contratacao_horarios
  where evento_contratacao_id=gente and inicio='19:00';
 retorno:=public.gf_gente_solicitar_agendamento('gente-que-danca-2026',inicio_g,
  'Responsavel Remarcar','16999998888',
  '[{"nome":"Bailarina Primeira"},{"nome":"Bailarina Segunda"}]'::jsonb,
  'pix',gen_random_uuid(),true);
 select id into strict r_g from public.gf_contratacao_form_respostas
  where evento_contratacao_id=gente and responsavel_nome='Responsavel Remarcar';
 retorno:=public.gf_gente_solicitar_agendamento('gente-que-danca-2026',ocupado_g,
  'Responsavel Terceiro','16988887777','[{"nome":"Bailarina Terceira"}]'::jsonb,
  'pix',gen_random_uuid(),true);
 select id into strict r_outro from public.gf_contratacao_form_respostas
  where evento_contratacao_id=gente and responsavel_nome='Responsavel Terceiro';
 lista:=public.gf_planilha_horarios_remarcacao('gente-que-danca-2026',r_g,admin_id);
 if (select x->>'disponivel' from jsonb_array_elements(lista->'horarios') x
     where x->>'id'=ocupado_g::text)<>'false' then
  raise exception 'Horário ocupado foi mostrado como disponível';end if;
 if (select x->>'disponivel' from jsonb_array_elements(lista->'horarios') x
     where x->>'id'=novo_g::text)<>'true' then
  raise exception 'Horário livre não apareceu';end if;
 select valor_recebido_centavos,agendamento_status into oldPaid,oldStatus
 from public.gf_contratacao_form_respostas where id=r_g;
 retorno:=public.gf_planilha_editar_com_remarcacao(
  gente,r_g,admin_id,'Responsavel Corrigido','16999998888',
  'Bailarina Primeira, Bailarina Segunda',
  '[{"nome":"Bailarina Primeira"},{"nome":"Bailarina Segunda"}]'::jsonb,
  '{}'::jsonb,'verde','Solicitou novo horário',inicio_g,novo_g
 );
 if retorno->'remarcacao'->>'alterado'<>'true'
  or (select horario_id from public.gf_contratacao_form_respostas where id=r_g)<>novo_g
  or (select responsavel_nome from public.gf_contratacao_form_respostas where id=r_g)<>'Responsavel Corrigido'
 then raise exception 'Remarcação e edição atômica da Gente falhou';end if;
 if (select valor_recebido_centavos from public.gf_contratacao_form_respostas where id=r_g)<>oldPaid
  or (select agendamento_status from public.gf_contratacao_form_respostas where id=r_g)<>oldStatus
 then raise exception 'Remarcação alterou pagamento ou confirmação';end if;
 if not public.gf_gente_intervalo_livre(gente,inicio_g,1,null) then
  raise exception 'Horário anterior da Gente não foi liberado';end if;
 begin
  perform public.gf_planilha_editar_com_remarcacao(
   gente,r_g,admin_id,'Nome que não pode salvar','16999998888',
   'Bailarina Primeira, Bailarina Segunda',
   '[{"nome":"Bailarina Primeira"},{"nome":"Bailarina Segunda"}]'::jsonb,
   '{}'::jsonb,'rosa','Não pode salvar',novo_g,ocupado_g);
  raise exception 'Permitiu conflito entre famílias';
 exception when others then
  if sqlerrm not like '%O horário foi ocupado%'
   then raise;end if;
 end;
 if (select responsavel_nome from public.gf_contratacao_form_respostas where id=r_g)
   <>'Responsavel Corrigido' then
  raise exception 'Rollback da edição em horário ocupado falhou';end if;
 begin
  perform public.gf_planilha_remarcar_agendamento('gente-que-danca-2026',
   r_g,inicio_g,ocupado_g,admin_id);
  raise exception 'Permitiu substituir alteração de outro admin';
 exception when others then
  if sqlerrm not like '%Outro administrador já alterou%' then raise;end if;
 end;
 if (select count(*) from public.gf_contratacao_auditoria
  where acao='agendamento_remarcado_planilha' and evento_contratacao_id=gente
   and detalhes->>'resposta_id'=r_g::text)<>1 then
  raise exception 'Remarcação da Gente sem trilha de auditoria';end if;

 select id into strict natal from public.gf_contratacao_eventos
 where slug='natal-fada-acucarada-2026' for update;
 perform public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026','2026-12-12','08:00','09:00',15,admin_id);
 perform public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026','2026-12-13','09:00','10:00',15,admin_id);
 update public.gf_contratacao_eventos set status='publicado',
  vendas_encerram_em=now()+interval '7 days' where id=natal;
 select id into strict sabado from public.gf_contratacao_horarios
 where evento_contratacao_id=natal and dia='2026-12-12' and inicio='08:00';
 select id into strict domingo from public.gf_contratacao_horarios
 where evento_contratacao_id=natal and dia='2026-12-13' and inicio='09:00';
 perform public.gf_natal_reservar_temporariamente(
  'natal-fada-acucarada-2026',sabado,2,token_n);
 retorno:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',sabado,
  'Responsavel Natal Teste','16999998888','',
  '[{"nome":"Criança Um"},{"nome":"Criança Dois"}]'::jsonb,
  'a_pagar','',null,'','',token_n,true);
 select id into strict r_n from public.gf_contratacao_form_respostas
 where evento_contratacao_id=natal and responsavel_nome='Responsavel Natal Teste';
 -- Usar as mesmas RPCs da equipe. A conferência exige referência,
 -- método e auditoria, mesmo num teste que será revertido por ROLLBACK.
 perform public.gf_contratacao_admin_registrar_pagamento_externo(
  natal,r_n,'pago_manual',14500,'pix','PIX_REMARCACAO_TESTE',
  'Pagamento conferido na fixture transacional',true,admin_id);
 perform public.gf_natal_atualizar_agendamento(
  'natal-fada-acucarada-2026',r_n,'confirmado',admin_id);
 lista:=public.gf_planilha_horarios_remarcacao('natal-fada-acucarada-2026',r_n,admin_id);
 if not exists(select 1 from jsonb_array_elements(lista->'horarios') x
  where x->>'id'=domingo::text and x->>'disponivel'='true') then
   raise exception 'Data alternativa Fada não foi oferecida';end if;
 retorno:=public.gf_planilha_remarcar_agendamento('natal-fada-acucarada-2026',
  r_n,sabado,domingo,admin_id);
 if retorno->>'alterado'<>'true'
  or (select horario_id from public.gf_contratacao_form_respostas where id=r_n)<>domingo
  or (select pagamento_situacao from public.gf_contratacao_form_respostas where id=r_n)<>'pago_manual'
  or (select agendamento_status from public.gf_contratacao_form_respostas where id=r_n)<>'confirmado'
 then raise exception 'Mudança de dia Fada não preservou confirmação e pagamento';end if;
 if not public.gf_natal_intervalo_livre(natal,sabado,2,null,null) then
  raise exception 'A reserva antiga do Natal não foi liberada';end if;
 if has_function_privilege('anon','public.gf_planilha_remarcar_agendamento(text,uuid,uuid,uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.gf_planilha_horarios_remarcacao(text,uuid,uuid)','EXECUTE')
 then raise exception 'RPC de remarcação não pode ser pública';end if;
end $test$;
rollback;
