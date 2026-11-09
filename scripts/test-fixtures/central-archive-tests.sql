-- Arquivamento seguro: qualquer operação é reversível e testada sem persistir registros.
begin;
insert into public.gf_contratacao_form_respostas(
 evento_contratacao_id,origem_chave,origem_linha,responsavel_nome,responsavel_whatsapp,
 bailarina_nome,experiencia_original,valor_informado_centavos
)
select id,'e2e-arquivar-sem-apagar',9997,'Responsável de Teste','34900000000',
 'Bailarina de Teste','Fotos de palco',7900
from public.gf_contratacao_eventos where slug='entre-estacoes';

set local role service_role;
do $archive_checks$
declare
 v_id uuid;
 v_campaign uuid;
 v_user uuid := '11111111-1111-4111-8111-111111111111';
 v_result jsonb;
 v_archived timestamptz;
begin
 if has_function_privilege('anon',
 'public.gf_contratacao_admin_arquivar_registro(uuid,text,uuid,boolean,uuid)','EXECUTE')
 or has_function_privilege('authenticated',
 'public.gf_contratacao_admin_arquivar_registro(uuid,text,uuid,boolean,uuid)','EXECUTE') then
   raise exception 'Visitantes não podem arquivar registros.';
 end if;
 select id,evento_contratacao_id into v_id,v_campaign
 from public.gf_contratacao_form_respostas
 where origem_chave='e2e-arquivar-sem-apagar';
 if v_id is null then raise exception 'Fixture de arquivamento não encontrada';end if;

 v_result:=public.gf_contratacao_admin_arquivar_registro(
   v_campaign,'formulario',v_id,true,v_user);
 select arquivado_em into v_archived from public.gf_contratacao_form_respostas where id=v_id;
 if v_result->>'arquivado'<>'true' or v_archived is null then
   raise exception 'Arquivamento não funcionou como service_role';
 end if;
 v_result:=public.gf_contratacao_admin_arquivar_registro(
   v_campaign,'formulario',v_id,false,v_user);
 select arquivado_em into v_archived from public.gf_contratacao_form_respostas where id=v_id;
 if v_result->>'arquivado'<>'false' or v_archived is not null then
   raise exception 'Restauração não funcionou como service_role';
 end if;

 perform public.gf_contratacao_admin_registrar_pagamento_externo(
    v_campaign,v_id,'pago_manual',7900,'pix','COMPROVANTE_SIMULADO',
    'Recebimento de teste, sem persistência',true,v_user);
 begin
   perform public.gf_contratacao_admin_arquivar_registro(v_campaign,'formulario',v_id,true,v_user);
   raise exception 'Permitiu arquivamento de recebimento confirmado.';
 exception when others then
   if sqlerrm not like '%histórico financeiro%' then raise; end if;
 end;
 if (select count(*) from public.gf_contratacao_auditoria
  where acao in ('registro_arquivado','registro_restaurado')
    and detalhes->>'referencia_id'=v_id::text)<>2 then
   raise exception 'Histórico de auditoria não foi preservado.';
 end if;
end
$archive_checks$;
rollback;
