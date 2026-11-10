-- Gente: teste transacional, sem pagamento e sem horário individual.
begin;
set local role service_role;
do $test$
declare
 admin_id uuid:='11111111-1111-4111-8111-111111111111'::uuid;
 campaign uuid;token uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
 token2 uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';r jsonb;
begin
 if has_function_privilege('anon',
  'public.gf_gente_solicitar_interesse(text,text,text,jsonb,text,uuid,boolean)','EXECUTE') then
   raise exception 'Endpoint Gente exposto diretamente aos visitantes.';end if;
 perform public.gf_contratacao_admin_criar_campanha(
  'Gente teste','2026-12-15','7896da46-5dd8-4d4e-ac50-36fda4966566'::uuid,
  'gente-que-danca-2026',admin_id);
 select id into campaign from public.gf_contratacao_eventos where slug='gente-que-danca-2026';
 update public.gf_contratacao_eventos
  set status='publicado',vendas_encerram_em=now()+interval '40 days'
 where id=campaign;
 r:=public.gf_gente_solicitar_interesse(
  'gente-que-danca-2026','Responsavel Teste','16999990000',
  '[{"nome":"Aluno de Teste","turma":""}]'::jsonb,'pix',token,true);
 if (r->>'valor_centavos')::int<>15000 then raise exception 'Preço de 1 criança incorreto.';end if;
 r:=public.gf_gente_solicitar_interesse(
  'gente-que-danca-2026','Responsavel Teste','16999990000',
  '[{"nome":"Aluno de Teste","turma":""}]'::jsonb,'pix',token,true);
 if r->>'reutilizado'<>'true' then raise exception 'Reenvio duplicou inscrição.';end if;
 r:=public.gf_gente_solicitar_interesse(
  'gente-que-danca-2026','Familia Exemplo','16999991111',
  '[{"nome":"Aluno Um"},{"nome":"Aluno Dois"},{"nome":"Aluno Tres"},{"nome":"Aluno Quatro"}]'::jsonb,
  'credito',token2,true);
 if (r->>'valor_centavos')::int<>60000 then raise exception 'Preço de 4 crianças incorreto.';end if;
 if (select count(*) from public.gf_contratacao_form_respostas where evento_contratacao_id=campaign)<>2
 then raise exception 'Quantidade de famílias deve ser exatamente 2.';end if;
 if exists(select 1 from public.gf_contratacao_form_respostas where evento_contratacao_id=campaign
  and pagamento_situacao <> 'pendente') then raise exception 'Pagamento presumido incorretamente.';end if;
 if exists(select 1 from public.gf_contratacao_form_respostas where evento_contratacao_id=campaign
  and horario_id is not null) then raise exception 'Acordo não define horários individuais.';end if;
end $test$;
rollback;
