-- 094 · Teste de publicação manual com bloqueios legais e sem checkout.
-- PostgreSQL temporário, sempre ROLLBACK.
begin;
set local role service_role;
do $manual$
declare
 a uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 e uuid;
 res jsonb;
begin
 if has_function_privilege('anon','public.gf_natal_admin_publicar(text,uuid)','EXECUTE')
   or has_function_privilege('authenticated','public.gf_natal_admin_publicar(text,uuid)','EXECUTE') then
  raise exception 'Publicação administrativa está exposta ao público.';
 end if;
 perform public.gf_contratacao_admin_criar_campanha(
  'Natal Teste Publicação Manual',date '2026-12-12',
  '7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
  'natal-fada-acucarada-2026',a
 );
 select id into e from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026';
 begin
  perform public.gf_natal_admin_publicar('natal-fada-acucarada-2026',a);
  raise exception 'Permitiu publicar sem termos e condições.';
 exception when others then
  if sqlerrm not like '%prazo de inscrições%' and sqlerrm not like '%Confira escola%' then raise;end if;
 end;
 perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  date '2026-12-12',time '08:00',time '08:30',15,a);
 perform public.gf_natal_gerar_horarios('natal-fada-acucarada-2026',
  date '2026-12-13',time '09:00',time '09:30',15,a);
 update public.gf_contratacao_eventos set
  evento_id='c8ea425b-a082-40ae-9a27-79db870f5075',
  data_evento='2026-12-12',local='Local de teste',
  vendas_encerram_em=now()+interval '12 hours',
  whatsapp_atendimento='16999998888',
  fornecedor_nome='Fornecedor Teste',fornecedor_documento='12345678901',
  fornecedor_email='teste@example.com',
  termos_versao='1',termos_conteudo=repeat('Termos da experiência. ',8),
  privacidade_versao='1',privacidade_url='https://example.com/privacidade',
  privacidade_conteudo=repeat('Política de privacidade. ',8)
 where id=e;
 res:=public.gf_natal_admin_publicar('natal-fada-acucarada-2026',a);
 if res->>'status'<>'publicado' then raise exception 'Publicação manual falhou.';end if;
 if (select status from public.gf_contratacao_eventos where id=e)<>'publicado' then
  raise exception 'Campanha não foi publicada.';
 end if;
 if not exists(select 1 from public.gf_contratacao_auditoria
  where evento_contratacao_id=e and acao='natal_publicado_sem_checkout') then
  raise exception 'Faltou auditoria da publicação.';
 end if;
end $manual$;
rollback;
