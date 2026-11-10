-- Planilha operacional: colunas, edição e pagamento são trilhas separadas.
begin;
set local role service_role;
do $check$
declare e uuid;u uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 h uuid;r public.gf_contratacao_form_respostas%rowtype;result jsonb;
begin
 select id into strict e from public.gf_contratacao_eventos where slug='gente-que-danca-2026';
 update public.gf_contratacao_eventos set status='publicado' where id=e;
 select id into strict h from public.gf_contratacao_horarios
  where evento_contratacao_id=e and inicio='18:00';
 result:=public.gf_gente_solicitar_agendamento('gente-que-danca-2026',h,
 'Responsavel Original','16999998888',
 '[{"nome":"Bailarina Primeira","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
 'pix',gen_random_uuid(),true);
 select * into strict r from public.gf_contratacao_form_respostas
 where evento_contratacao_id=e and responsavel_nome='Responsavel Original';
 result:=public.gf_contratacao_admin_configurar_planilha(e,u,
 '[{"id":"col_1234abcd","titulo":"Figurino","cor":"dourado"},{"id":"col_aabbccdd","titulo":"Entrega","cor":"azul"}]'::jsonb);
 if jsonb_array_length(result->'colunas')<>2 then raise exception 'Colunas não salvas';end if;
 result:=public.gf_contratacao_admin_editar_resposta(e,r.id,u,
  'Responsavel Atualizado','16988887777',r.bailarina_nome,
  '[{"nome":"Bailarina Mudada","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
  '{"col_1234abcd":"Preto"}'::jsonb,'verde','Entregar em galeria individual');
 if result->>'ok'<>'true' then raise exception 'Não editou';end if;
 if (select valor_informado_centavos from public.gf_contratacao_form_respostas where id=r.id)<>27000
 then raise exception 'A edição modificou o valor a receber';end if;
 if (select horario_id from public.gf_contratacao_form_respostas where id=r.id) is distinct from h
 then raise exception 'A edição modificou o agendamento';end if;
 begin
  perform public.gf_contratacao_admin_editar_resposta(e,r.id,u,
  'Responsavel Atualizado','16988887777',r.bailarina_nome,
  '[{"nome":"Uma Bailarina","turma":""}]'::jsonb,
  '{}'::jsonb,'sem','');
  raise exception 'Modificação indevida de quantidade aceita';
 exception when others then
  if sqlerrm='Modificação indevida de quantidade aceita' or sqlerrm not like '%quantidade%'
  then raise;end if;
 end;
 begin
  perform public.gf_contratacao_admin_editar_resposta(e,r.id,u,
  'Responsavel Atualizado','16988887777',r.bailarina_nome,
  '[{"nome":"Bailarina Mudada","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
  '{"col_admin_fake":"Indevido"}'::jsonb,'sem','');
  raise exception 'Coluna não autorizada aceita';
 exception when others then
  if sqlerrm='Coluna não autorizada aceita' or sqlerrm not like '%coluna%'
  then raise;end if;
 end;
 result:=public.gf_contratacao_admin_registrar_pagamento_externo(
  e,r.id,'pago_manual',27000,'pix','PIX TESTE 12345',
  'Valor conferido em teste',true,u);
 if (select valor_recebido_centavos from public.gf_contratacao_form_respostas where id=r.id)<>27000
 then raise exception 'Pagamento confirmado deveria estar registrado';end if;
 perform public.gf_contratacao_admin_editar_resposta(e,r.id,u,
  'Responsavel Atualizado','16988887777','',
  '[{"nome":"Bailarina Atualizada","turma":""},{"nome":"Bailarina Segunda","turma":""}]'::jsonb,
  '{"col_1234abcd":"Vestido vermelho"}'::jsonb,'rosa','Dado revisado');
 if (select valor_recebido_centavos from public.gf_contratacao_form_respostas where id=r.id)<>27000
 then raise exception 'Edição alterou pagamento registrado';end if;
 begin
  perform public.gf_contratacao_admin_arquivar_registro(e,'formulario',r.id,true,u);
  raise exception 'Arquivou registro com pagamento';
 exception when others then
  if sqlerrm='Arquivou registro com pagamento' or sqlerrm not like '%financeiro%'
  then raise;end if;
 end;
 if has_function_privilege('anon','public.gf_contratacao_admin_configurar_planilha(uuid,uuid,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.gf_contratacao_admin_editar_resposta(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text)','EXECUTE')
 then raise exception 'Dados administrativos ficaram públicos';end if;
end $check$;
rollback;
