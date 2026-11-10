-- Executado após a migração 101 em banco de CI. Nenhuma inscrição persiste.
begin;
do $test$
declare e uuid; h uuid; hnext uuid; late uuid; token uuid:=gen_random_uuid();r jsonb;listing jsonb;
begin
 select id into strict e from public.gf_contratacao_eventos where slug='gente-que-danca-2026' for update;
 update public.gf_contratacao_eventos set status='publicado' where id=e;
 if (select count(*) from public.gf_contratacao_horarios where evento_contratacao_id=e and dia='2026-12-15')<>16
 then raise exception 'Precisamos de 16 blocos de 15 minutos';end if;
 select id into strict h from public.gf_contratacao_horarios where evento_contratacao_id=e and inicio='18:00';
 select id into strict hnext from public.gf_contratacao_horarios where evento_contratacao_id=e and inicio='18:15';
 select id into strict late from public.gf_contratacao_horarios where evento_contratacao_id=e and inicio='21:00';
 listing:=public.gf_gente_listar_inicios(4);
 if jsonb_array_length(listing->'horarios')<1 then raise exception 'Horário inicial para quatro alunos não apareceu';end if;
 if not public.gf_gente_intervalo_livre(e,late,4,null) then raise exception '21:00–22:00 precisa comportar 4 bailarinos';end if;
 r:=public.gf_gente_solicitar_agendamento('gente-que-danca-2026',h,
 'Responsavel Exemplo','16999887766',
 '[{"nome":"Bailarina Um","turma":""},{"nome":"Bailarina Dois","turma":""}]'::jsonb,
 'pix',token,true);
 if (r->>'valor_centavos')::int<>27000 or r->>'fim'<>'18:30'
 then raise exception 'Valor ou intervalo familiar incorreto: %',r;end if;
 if public.gf_gente_intervalo_livre(e,hnext,1,null) then raise exception 'Sobreposição indevidamente liberada';end if;
 begin
  perform public.gf_gente_solicitar_agendamento('gente-que-danca-2026',hnext,
    'Outro Responsavel','16999887767','[{"nome":"Outro Aluno","turma":""}]'::jsonb,
    'credito',gen_random_uuid(),true);
  raise exception 'Dupla reserva aceita';
 exception when others then
  if sqlerrm='Dupla reserva aceita' or sqlerrm not like '%acabou de ser reservado%'
  then raise;end if;
 end;
 r:=public.gf_gente_solicitar_agendamento('gente-que-danca-2026',h,
 'Responsavel Exemplo','16999887766',
 '[{"nome":"Bailarina Um","turma":""},{"nome":"Bailarina Dois","turma":""}]'::jsonb,
 'pix',token,true);
 if r->>'reutilizado'<>'true' then raise exception 'Retry criou outra reserva';end if;
 if has_function_privilege('anon',
  'public.gf_gente_solicitar_agendamento(text,uuid,text,text,jsonb,text,uuid,boolean)','EXECUTE')
 then raise exception 'RPC está pública e precisa ser restrita';end if;
end $test$;
rollback;
