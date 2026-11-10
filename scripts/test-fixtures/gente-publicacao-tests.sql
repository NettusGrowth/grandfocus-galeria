-- Bootstrap e publicação sem checkout, CI temporário.
begin;
set local role service_role;
do $test$
declare campaign uuid;user_id uuid:='11111111-1111-4111-8111-111111111111';
 result jsonb;
begin
 select id into strict campaign from public.gf_contratacao_eventos where slug='gente-que-danca-2026';
 if (select status from public.gf_contratacao_eventos where id=campaign)<>'rascunho' then
   raise exception 'A campanha deve começar em rascunho.';end if;
 if (select count(*) from public.gf_contratacao_pacotes
  where evento_contratacao_id=campaign and preco_centavos=15000 and ativo)<>1 then
   raise exception 'Pacote de R$ 150 por criança não encontrado.';end if;
 if (select count(*) from public.escolas where nome='Gente que Dança')<>1 then
   raise exception 'Escola parceira foi duplicada.';end if;
 if has_function_privilege('anon',
  'public.gf_gente_admin_publicar(text,uuid)','EXECUTE') then
   raise exception 'Publicação da campanha exposta sem autenticação';end if;
 result:=public.gf_gente_admin_publicar('gente-que-danca-2026',user_id);
 if result->>'status'<>'publicado' then raise exception 'Admin não publicou Gente.';end if;
 if (select count(*) from public.gf_contratacao_auditoria
  where evento_contratacao_id=campaign and acao='gente_publicado_sem_checkout')<>1 then
   raise exception 'Auditoria de publicação ausente';end if;
end $test$;
rollback;
