-- Testa exclusividade de blocos consecutivos e prazo de retenção, sempre com ROLLBACK.
begin;
set local role service_role;
do $natal_hold$
declare
 v_admin uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 v_evento uuid;
 v_0800 uuid;
 v_0815 uuid;
 v_1230 uuid;
 v_result jsonb;
 v_token uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
 v_second uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
 v_third uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;
begin
 if has_function_privilege('anon',
  'public.gf_natal_reservar_temporariamente(text,uuid,integer,uuid)','EXECUTE')
 or has_function_privilege('authenticated',
  'public.gf_natal_liberar_reserva(text,uuid)','EXECUTE') then
   raise exception 'Funções temporárias expostas indevidamente.';
 end if;
 perform public.gf_contratacao_admin_criar_campanha(
  'Natal Teste 092',date '2026-12-12',
  '7896da46-5dd8-4d4e-ac50-36fda4966566', 'natal-fada-acucarada-2026',v_admin
 );
 select id into v_evento from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026';
 perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  date '2026-12-12',time '08:00',time '09:00',15,v_admin);
 perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  date '2026-12-12',time '12:15',time '12:45',15,v_admin);
 select id into v_0800 from public.gf_contratacao_horarios where evento_contratacao_id=v_evento and inicio='08:00';
 select id into v_0815 from public.gf_contratacao_horarios where evento_contratacao_id=v_evento and inicio='08:15';
 select id into v_1230 from public.gf_contratacao_horarios where evento_contratacao_id=v_evento and inicio='12:30';
 if public.gf_natal_intervalo_livre(v_evento,v_1230,2,null,null) then
   raise exception 'Reservou sessão além do fim de manhã.';
 end if;
 if not public.gf_natal_intervalo_livre(v_evento,v_0800,4,null,null) then
   raise exception 'Quatro blocos livres foram incorretamente recusados.';
 end if;
 update public.gf_contratacao_eventos set status='publicado' where id=v_evento;
 v_result:=public.gf_natal_reservar_temporariamente(
  'natal-fada-acucarada-2026',v_0800,3,v_token);
 if (v_result->>'duracao_minutos')::integer<>45 then raise exception 'Duração de 3 alunas incorreta.';end if;
 if (select expira_em-criado_em from public.gf_natal_holds where token=v_token)>interval '10 minutes 1 second' then
   raise exception 'Retenção maior do que 10 minutos.';
 end if;
 if public.gf_natal_intervalo_livre(v_evento,v_0815,1,null,null) then
   raise exception 'Permitiu invadir blocos do primeiro grupo.';
 end if;
 begin
  perform public.gf_natal_reservar_temporariamente('natal-fada-acucarada-2026',v_0815,1,v_second);
  raise exception 'Segunda família entrou em período já retido.';
 exception when others then
  if sqlerrm not like '%não comporta%' then raise;end if;
 end;
 -- Mesma família pode rever o horário sem estender artificialmente o prazo.
 v_result:=public.gf_natal_reservar_temporariamente(
  'natal-fada-acucarada-2026',v_0800,3,v_token);
 if (v_result->>'expira_em')::timestamptz<>
   (select expira_em from public.gf_natal_holds where token=v_token) then
   raise exception 'Prazo da retenção mudou inesperadamente.';
 end if;
 v_result:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_0800,'Responsável Natal Teste','16999998888','',
  '[{"nome":"Aluna Um","turma":"Ballet"},{"nome":"Aluna Dois","turma":"Jazz"},{"nome":"Aluna Três","turma":""}]'::jsonb,
  'a_pagar','',null,'Família','Reserva de teste',v_token,true
 );
 if (v_result->>'valor_centavos')::integer<>21500 then raise exception 'Preço familiar incorreto.';end if;
 if (select status from public.gf_natal_holds where token=v_token)<>'convertido' then
   raise exception 'Hold não convertido na inscrição.';
 end if;
 if public.gf_natal_intervalo_livre(v_evento,v_0815,1,null,null) then
   raise exception 'Formulário concluído liberou indevidamente intervalo vendido.';
 end if;
 v_result:=public.gf_natal_solicitar_horario(
  'natal-fada-acucarada-2026',v_0800,'Responsável Natal Teste','16999998888','',
  '[{"nome":"Aluna Um","turma":"Ballet"},{"nome":"Aluna Dois","turma":"Jazz"},{"nome":"Aluna Três","turma":""}]'::jsonb,
  'a_pagar','',null,'Família','Reserva de teste',v_token,true
 );
 if v_result->>'reutilizado'<>'true' then raise exception 'Reenvio não foi idempotente.';end if;
 -- A expiração é lógica no servidor: nenhuma rotina cron precisa liberar as vagas.
 v_result:=public.gf_natal_reservar_temporariamente(
  'natal-fada-acucarada-2026',v_1230,1,v_third);
 update public.gf_natal_holds set expira_em=now()-interval '1 minute' where token=v_third;
 if not public.gf_natal_intervalo_livre(v_evento,v_1230,1,null,null) then
   raise exception 'Retenção vencida continuou bloqueando vaga.';
 end if;
 -- Outro visitante consegue ocupar o mesmo espaço após vencimento.
 v_result:=public.gf_natal_reservar_temporariamente(
  'natal-fada-acucarada-2026',v_1230,1,v_second);
 if v_result->>'ok'<>'true' then raise exception 'Novo hold pós-expiração falhou.';end if;
 perform public.gf_natal_liberar_reserva('natal-fada-acucarada-2026',v_second);
 if not public.gf_natal_intervalo_livre(v_evento,v_1230,1,null,null) then
   raise exception 'Liberação antecipada não reabriu vaga.';
 end if;
end $natal_hold$;
rollback;
