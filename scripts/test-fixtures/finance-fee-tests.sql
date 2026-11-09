-- Teste isolado da taxa de referência, com mesmas permissões do backend.
begin;
set local role service_role;
do $fee_test$
declare
 v_user uuid := '11111111-1111-4111-8111-111111111111';
 v_initial integer;
 v_out jsonb;
begin
 if has_function_privilege('anon',
 'public.gf_contratacao_admin_salvar_taxa_liquida(text,integer,uuid)','EXECUTE')
 or has_function_privilege('authenticated',
 'public.gf_contratacao_admin_salvar_taxa_liquida(text,integer,uuid)','EXECUTE') then
  raise exception 'Taxa financeira exposta ao público.';
 end if;
 select taxa_credito_a_vista_bps into v_initial
 from public.gf_contratacao_eventos where slug='entre-estacoes';
 if v_initial<>420 then raise exception 'Referência inicial esperada: 4,20 por cento.';end if;
 v_out:=public.gf_contratacao_admin_salvar_taxa_liquida('entre-estacoes',315,v_user);
 if v_out->>'ok'<>'true' or
    (select taxa_credito_a_vista_bps from public.gf_contratacao_eventos where slug='entre-estacoes')<>315 then
  raise exception 'Alteração de taxa não foi salva.';
 end if;
 if not exists (
  select 1 from public.gf_contratacao_auditoria
   where acao='taxa_credito_referencia_alterada'
     and detalhes->>'anterior_bps'='420'
     and detalhes->>'nova_bps'='315'
 ) then raise exception 'Alteração de taxa não foi auditada.';end if;
 begin
  perform public.gf_contratacao_admin_salvar_taxa_liquida('entre-estacoes',3000,v_user);
  raise exception 'Aceitou taxa acima de 20 por cento.';
 exception when others then
  if sqlerrm not like '%entre 0 e 20%' then raise;end if;
 end;
 begin
  perform public.gf_contratacao_admin_salvar_taxa_liquida(
    'entre-estacoes',420,'22222222-2222-4222-8222-222222222222'::uuid);
  raise exception 'Usuário não autorizado conseguiu alterar taxa.';
 exception when others then
  if sqlerrm not like '%Apenas administradores%' then raise;end if;
 end;
end $fee_test$;
rollback;
