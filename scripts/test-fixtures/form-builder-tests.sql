-- Testa o editor usando exatamente as permissões service_role.
-- A transação é revertida: nenhuma pergunta ou resposta de teste persiste.
begin;
set local role service_role;
do $form_test$
declare
 v_version integer;
 v_new jsonb;
 v_model jsonb;
 v_saved jsonb;
 v_count integer;
begin
 if has_function_privilege('anon','public.gf_contratacao_admin_salvar_formulario(text,jsonb,integer,uuid)','EXECUTE') or
    has_function_privilege('authenticated','public.gf_contratacao_admin_salvar_formulario(text,jsonb,integer,uuid)','EXECUTE') then
    raise exception 'Função de edição exposta a visitantes.';
 end if;
 select formulario_versao into v_version from public.gf_contratacao_eventos
 where slug='entre-estacoes';
 if v_version is null then raise exception 'Campanha do teste não encontrada.'; end if;
 v_model := jsonb_build_object(
   'aparencia',jsonb_build_object('cor','#4B0416','fundo','#F1EDF1','titulo','Sessão de Teste','introducao','Responda com atenção.'),
   'perguntas',jsonb_build_array(
     jsonb_build_object('id','q_12345678','titulo','Modalidade','tipo','unica',
       'obrigatoria',true,'opcoes',jsonb_build_array('Ballet','Jazz'),
       'ajuda','Selecione a modalidade.','condicao',null,'ordem',0),
     jsonb_build_object('id','q_87654321','titulo','Especifique','tipo','texto',
       'obrigatoria',true,'opcoes','[]'::jsonb,
       'ajuda','Informe a turma.','condicao',jsonb_build_object('pergunta_id','q_12345678','valor','Ballet'),'ordem',1)
   )
 );
 v_new := public.gf_contratacao_admin_salvar_formulario('entre-estacoes',v_model,v_version,
   '11111111-1111-4111-8111-111111111111'::uuid);
 if (v_new->>'versao')::integer <> v_version+1 then
    raise exception 'O editor não aumentou a versão.';
 end if;
 select formulario_modelo into v_saved from public.gf_contratacao_eventos
 where slug='entre-estacoes';
 if v_saved <> v_model then raise exception 'As perguntas foram alteradas durante o salvamento.'; end if;
 begin
   perform public.gf_contratacao_admin_salvar_formulario('entre-estacoes',v_model,v_version,
     '11111111-1111-4111-8111-111111111111'::uuid);
   raise exception 'Aceitou salvar com versão desatualizada.';
 exception when others then
   if sqlerrm not like '%Recarregue antes de salvar%' then raise; end if;
 end;
 select count(*) into v_count from public.gf_contratacao_auditoria
 where acao='formulario_editado';
 if v_count<>1 then raise exception 'Alterações do formulário devem gerar auditoria.';end if;
end
$form_test$;
rollback;
