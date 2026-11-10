-- Grand Focus 360. Verificação isolada: nenhuma pessoa/lead/pagamento real criado.
begin;
set local role service_role;
do $tests$
declare
 v_first uuid;
 v_second uuid;
 v_source uuid:='11111111-1111-4111-8111-111111111111'::uuid;
begin
 if (select count(*) from public.crm_pipelines
    where nome in ('Parcerias com Escolas','Famílias e Ensaios'))<>2 then
   raise exception 'Funis B2B e B2C não foram registrados.';
 end if;
 if (select count(*) from public.crm_etapas e join public.crm_pipelines p on p.id=e.pipeline_id
     where p.nome='Parcerias com Escolas')<>8 then
   raise exception 'Etapas B2B ausentes.';
 end if;
 if (select count(*) from public.crm_etapas e join public.crm_pipelines p on p.id=e.pipeline_id
     where p.nome='Famílias e Ensaios')<>7 then
   raise exception 'Etapas B2C ausentes.';
 end if;
 if has_table_privilege('anon','public.gf_contatos','SELECT')
    or has_table_privilege('anon','public.gf_form_alunos','SELECT')
    or has_table_privilege('authenticated','public.gf_integracao_outbox','SELECT')
    or has_table_privilege('authenticated','public.gf_integracao_outbox','INSERT') then
   raise exception 'Dados pessoais ou outbox foram expostos ao público.';
 end if;
 if not has_table_privilege('service_role','public.gf_contatos','INSERT')
    or not has_table_privilege('service_role','public.gf_integracao_outbox','INSERT') then
   raise exception 'Service role sem permissão para processar integração.';
 end if;
 if not exists(
   select 1 from information_schema.columns
   where table_schema='public' and table_name='crm_leads' and column_name='contato_id'
 ) then raise exception 'Campo de contato canônico ausente no CRM.';end if;
 if not exists(
   select 1 from information_schema.columns
   where table_schema='public' and table_name='crm_leads' and column_name='escola_id'
 ) then raise exception 'Campo de escola operacional ausente no CRM.';end if;
 insert into public.gf_contatos(nome,telefone,telefone_normalizado)
   values('Responsavel de Teste','(16) 99999-0000','16999990000') returning id into v_first;
 insert into public.gf_contatos(nome,telefone,telefone_normalizado)
   values('Bailarina de Teste','(16) 99999-0000','16999990000') returning id into v_second;
 if v_first=v_second or
    (select count(*) from public.gf_contatos where telefone_normalizado='16999990000')<>2 then
   raise exception 'Contatos diferentes com telefone familiar foram unidos.';
 end if;
 insert into public.gf_financeiro_fontes(fonte_tipo,fonte_id,status_conferencia)
 values('contratacao_formulario',v_source,'pendente')
 on conflict(fonte_tipo,fonte_id) do nothing;
 insert into public.gf_financeiro_fontes(fonte_tipo,fonte_id,status_conferencia)
 values('contratacao_formulario',v_source,'pendente')
 on conflict(fonte_tipo,fonte_id) do nothing;
 if (select count(*) from public.gf_financeiro_fontes
      where fonte_tipo='contratacao_formulario' and fonte_id=v_source)<>1 then
   raise exception 'Fonte financeira duplicada.';
 end if;
 insert into public.gf_integracao_outbox(chave_idempotencia,evento,origem_tipo,origem_id)
  values('teste:evento:1','formulario_recebido','teste',v_source)
  on conflict(chave_idempotencia) do nothing;
 insert into public.gf_integracao_outbox(chave_idempotencia,evento,origem_tipo,origem_id)
  values('teste:evento:1','formulario_recebido','teste',v_source)
  on conflict(chave_idempotencia) do nothing;
 if (select count(*) from public.gf_integracao_outbox
     where chave_idempotencia='teste:evento:1')<>1 then
   raise exception 'Outbox não protege contra tentativas repetidas.';
 end if;
 if (select count(*) from public.gf_contratacao_form_respostas)<>0 then
   raise exception 'Migração de teste afetou inscrições existentes.';
 end if;
end $tests$;
rollback;
