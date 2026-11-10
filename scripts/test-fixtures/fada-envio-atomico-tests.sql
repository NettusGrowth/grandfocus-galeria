-- 095 · Envio único, sem hold anterior e sem relógio. ROLLBACK obrigatório.
begin;
set local role service_role;
do $natal_sem_contador$
declare
 admin_id uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 campanha uuid; horario uuid; invadido uuid; horario_domingo uuid;
 v_token uuid:='11111111-1111-4111-8111-111111111119'::uuid;
 v_token2 uuid:='22222222-2222-4222-8222-222222222229'::uuid;
 v_token3 uuid:='33333333-3333-4333-8333-333333333339'::uuid;
 resultado jsonb;
begin
 if has_function_privilege('anon',
   'public.gf_natal_solicitar_sem_cronometro(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)',
   'EXECUTE') or has_function_privilege('authenticated',
   'public.gf_natal_solicitar_sem_cronometro(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)',
   'EXECUTE') then raise exception 'Envio atômico não pode estar exposto à API pública.';end if;

 perform public.gf_contratacao_admin_criar_campanha(
  'Natal 095 teste',date '2026-12-12',
  '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
  'natal-fada-acucarada-2026',admin_id
 );
 select id into strict campanha from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026';
 perform public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026',date '2026-12-12',time '08:00',time '09:00',15,admin_id);
 perform public.gf_natal_gerar_horarios(
  'natal-fada-acucarada-2026',date '2026-12-13',time '09:00',time '10:00',15,admin_id);
 select id into strict horario from public.gf_contratacao_horarios
  where evento_contratacao_id=campanha and dia='2026-12-12' and inicio='08:00';
 select id into strict invadido from public.gf_contratacao_horarios
  where evento_contratacao_id=campanha and dia='2026-12-12' and inicio='08:15';
 select id into strict horario_domingo from public.gf_contratacao_horarios
  where evento_contratacao_id=campanha and dia='2026-12-13' and inicio='09:00';
 update public.gf_contratacao_eventos set status='publicado',
  vendas_encerram_em=now()+interval '10 days'
  where id=campanha;
 if (select count(*) from public.gf_natal_holds where evento_contratacao_id=campanha)>0 then
  raise exception 'Houve retenção antes do envio';end if;
 resultado:=public.gf_natal_solicitar_sem_cronometro(
  'natal-fada-acucarada-2026',horario,
  'Responsavel Teste','16999998888','',
  '[{"nome":"Bailarina Primeira","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
  'a_pagar','',null,'','',v_token,true);
 if (resultado->>'valor_centavos')::integer<>14500 then
  raise exception 'Preço da família com duas alunas incorreto.';end if;
 if (select count(*) from public.gf_natal_holds
  where token=v_token and status='convertido')<>1 then
  raise exception 'O envio deve converter o hold na mesma transação.';end if;
 if public.gf_natal_intervalo_livre(campanha,invadido,1,null,null) then
  raise exception 'Horário seguinte não foi bloqueado pela primeira família.';end if;
 begin
  perform public.gf_natal_solicitar_sem_cronometro(
   'natal-fada-acucarada-2026',invadido,
   'Outra Familia','16999997777','',
   '[{"nome":"Aluna Terceira","turma":""}]'::jsonb,
   'a_pagar','',null,'','',v_token2,true);
  raise exception 'Segunda família invadiu o horário já solicitado.';
 exception when others then
  if sqlerrm not like '%não comporta%' then raise;end if;
 end;
 resultado:=public.gf_natal_solicitar_sem_cronometro(
  'natal-fada-acucarada-2026',horario,
  'Responsavel Teste','16999998888','',
  '[{"nome":"Bailarina Primeira","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
  'a_pagar','',null,'','',v_token,true);
 if resultado->>'reutilizado'<>'true' then
  raise exception 'Retry de envio deve devolver o mesmo registro.';end if;
 resultado:=public.gf_natal_solicitar_sem_cronometro(
  'natal-fada-acucarada-2026',horario_domingo,
  'Responsavel Quatro','16999996666','',
  '[{"nome":"Aluno Um","turma":""},{"nome":"Aluno Dois","turma":""},{"nome":"Aluno Tres","turma":""},{"nome":"Aluno Quatro","turma":""}]'::jsonb,
  'ja_paguei','',null,'','',v_token3,true);
 if (resultado->>'valor_centavos')::integer<>28500 then
  raise exception 'Preço de quatro alunos incorreto.';end if;
 if (select count(*) from public.gf_natal_holds
  where evento_contratacao_id=campanha and status='ativo')<>0 then
  raise exception 'Envio deixou vaga em pré-reserva ativa.';end if;
 if (select count(*) from public.gf_contratacao_form_respostas
   where evento_contratacao_id=campanha)<>2 then
  raise exception 'Resultado deveria conter somente duas famílias.';end if;
end $natal_sem_contador$;
rollback;
