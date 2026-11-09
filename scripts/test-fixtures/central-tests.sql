
-- Testes de regressão da Central de Gestão.
do $central$
declare
  v_campanha uuid;
  v_externo uuid;
  v_pedido uuid;
  v_result jsonb;
  v_usuario uuid := '11111111-1111-4111-8111-111111111111';
begin
  select id into v_campanha from public.gf_contratacao_eventos where slug='entre-estacoes';
  if v_campanha is null then raise exception 'Campanha de teste ausente.'; end if;
  if has_table_privilege('anon','public.gf_contratacao_form_respostas','SELECT')
     or has_table_privilege('authenticated','public.gf_contratacao_form_respostas','SELECT')
     or has_function_privilege('anon','public.gf_contratacao_admin_registrar_pagamento_externo(uuid,uuid,text,integer,text,text,text,boolean,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.gf_contratacao_admin_salvar_acompanhamento(uuid,text,uuid,text,date,text,boolean,uuid)','EXECUTE') then
    raise exception 'Central de Gestão acessível sem autorização de serviço.';
  end if;
  insert into public.gf_contratacao_form_respostas
    (evento_contratacao_id,origem_chave,origem_linha,responsavel_nome,
     responsavel_whatsapp,bailarina_nome,experiencia_original,valor_informado_centavos,
     pagamento_preferido)
  values (v_campanha,'teste-formulario-001',1,'Responsável Simulado',
          '34999999999','Bailarina Simulada','Fotos de palco',7900,'Pix')
  returning id into v_externo;

  if (select pagamento_situacao from public.gf_contratacao_form_respostas where id=v_externo) <> 'nao_conferido' then
    raise exception 'Importação deve iniciar sem pagamento confirmado.';
  end if;
  begin
    perform public.gf_contratacao_admin_registrar_pagamento_externo(
      v_campanha,v_externo,'pago_manual',7900,'pix','ID_PIX_TESTE','Pagamento testado',false,v_usuario);
    raise exception 'Era obrigatório bloquear marcação como pago sem conferência explícita.';
  exception when others then
    if sqlerrm not like '%Confirme que você conferiu%' then raise; end if;
  end;
  v_result := public.gf_contratacao_admin_registrar_pagamento_externo(
    v_campanha,v_externo,'parcial',4000,'pix','ID_PIX_TESTE','Recebimento parcial confirmado',true,v_usuario);
  if v_result->>'situacao' <> 'parcial' or
     (select valor_recebido_centavos from public.gf_contratacao_form_respostas where id=v_externo) <> 4000 then
    raise exception 'Conferência parcial foi perdida.';
  end if;
  begin
    perform public.gf_contratacao_admin_registrar_pagamento_externo(
      v_campanha,v_externo,'pago_manual',4000,'pix','ID_PIX_TESTE','',true,v_usuario);
    raise exception 'Não deveria aceitar pagamento parcial como integral.';
  exception when others then
    if sqlerrm not like '%cobrir o valor informado%' then raise; end if;
  end;
  v_result := public.gf_contratacao_admin_registrar_pagamento_externo(
    v_campanha,v_externo,'pago_manual',7900,'pix','ID_PIX_TESTE_2','Saldo conferido',true,v_usuario);
  if (select pagamento_situacao from public.gf_contratacao_form_respostas where id=v_externo) <> 'pago_manual'
     or (select count(*) from public.gf_contratacao_auditoria
         where acao='pagamento_externo_conferido_manual') <> 2 then
    raise exception 'Registro manual pago deve manter trilha de auditoria.';
  end if;
  v_result := public.gf_contratacao_admin_salvar_acompanhamento(
    v_campanha,'formulario',v_externo,'contatar',current_date+1,'Enviar mensagem respeitosa.',true,v_usuario);
  if (select situacao from public.gf_contratacao_acompanhamentos where resposta_form_id=v_externo) <> 'contatar'
     or (select ultimo_contato_em from public.gf_contratacao_acompanhamentos where resposta_form_id=v_externo) is null then
    raise exception 'Follow-up do formulário não foi salvo.';
  end if;
  v_result := public.gf_contratacao_admin_salvar_acompanhamento(
    v_campanha,'formulario',v_externo,'concluido',null,'Contato concluído.',false,v_usuario);
  if (select count(*) from public.gf_contratacao_acompanhamentos where resposta_form_id=v_externo) <> 1
     or (select situacao from public.gf_contratacao_acompanhamentos where resposta_form_id=v_externo) <> 'concluido' then
    raise exception 'Atualização do follow-up gerou duplicidade.';
  end if;

  select id into v_pedido from public.gf_contratacao_pedidos
   where evento_contratacao_id=v_campanha limit 1;
  if v_pedido is not null then
    v_result := public.gf_contratacao_admin_salvar_acompanhamento(
      v_campanha,'online',v_pedido,'aguardando_resposta',current_date+2,'Mensagem enviada',true,v_usuario);
    if (select count(*) from public.gf_contratacao_acompanhamentos where pedido_id=v_pedido) <> 1 then
      raise exception 'Follow-up do pedido online não foi salvo.';
    end if;
  end if;
end
$central$;
