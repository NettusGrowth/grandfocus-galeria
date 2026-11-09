-- Teste isolado: nenhuma sessão adicional deve começar durante outra sessão.
-- Usamos a campanha e perfis fictícios do ambiente PostgreSQL temporário.
begin;
set local role service_role;
do $check_slots$
declare
 v_evento uuid;
 v_usuario uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 v_res jsonb;
begin
 perform public.gf_contratacao_admin_criar_campanha(
  'Natal Teste de Sobreposições',date '2026-12-12',
  '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
  'natal-fada-acucarada-2026',v_usuario);
 select id into v_evento from public.gf_contratacao_eventos
  where slug='natal-fada-acucarada-2026';
 if v_evento is null then raise exception 'Campanha de teste não foi criada.';end if;
 v_res:=public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
   date '2026-12-12',time '14:00',time '14:30',30,v_usuario);
 if (v_res->>'novos')::integer<>1 then raise exception 'Sessão inicial faltando.';end if;
 begin
  perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
    date '2026-12-12',time '14:20',time '14:50',30,v_usuario);
  raise exception 'Falha: permitiu criar uma faixa que se sobrepõe.';
 exception when others then
  if sqlerrm not like '%se sobrepõe%' then raise; end if;
 end;
 begin
  perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
    date '2026-12-12',time '13:45',time '14:15',30,v_usuario);
  raise exception 'Falha: permitiu uma faixa que começa antes mas se sobrepõe.';
 exception when others then
  if sqlerrm not like '%se sobrepõe%' then raise; end if;
 end;
 v_res:=public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
   date '2026-12-12',time '14:30',time '15:00',30,v_usuario);
 if (v_res->>'novos')::integer<>1 then
  raise exception 'Sessões consecutivas sem sobreposição foram bloqueadas.';end if;
 if (select count(*) from public.gf_contratacao_horarios where evento_contratacao_id=v_evento)<>2
 then raise exception 'A agenda contém horários incorretos.';end if;
 if has_function_privilege('anon','public.gf_natal_gerar_horarios(text,date,time,time,integer,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.gf_natal_gerar_horarios(text,date,time,time,integer,uuid)','EXECUTE') then
   raise exception 'A função ficou exposta a visitantes.';
 end if;
end;
$check_slots$;
rollback;
