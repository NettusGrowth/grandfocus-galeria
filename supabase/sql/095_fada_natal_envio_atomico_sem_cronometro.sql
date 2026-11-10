-- 095 · Natal: seleção sem contador. A vaga é disputada apenas no envio,
-- em UMA transação. O antigo fluxo de 10 minutos permanece disponível
-- somente para clientes legados; o formulário simplificado não o utiliza.
create or replace function public.gf_natal_solicitar_sem_cronometro(
 p_slug text,p_horario uuid,p_nome text,p_whatsapp text,p_email text,
 p_alunos jsonb,p_pagamento text,p_meio text,p_data_pagamento date,
 p_familia text,p_observacao text,p_idempotencia uuid,p_aceite boolean
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;v_count integer;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_idempotencia is null
   or p_horario is null or p_alunos is null or jsonb_typeof(p_alunos)<>'array'
   or jsonb_array_length(p_alunos) not between 1 and 4
 then raise exception 'Confira os dados da sessão.';end if;
 v_count:=jsonb_array_length(p_alunos);
 -- Trava de evento usada também no sistema legado: serializa famílias concorrentes.
 select * into v_evento from public.gf_contratacao_eventos
 where slug=p_slug for update;
 if not found or v_evento.status<>'publicado' then
  raise exception 'A campanha ainda não está aberta.';end if;
 -- Retry após falha de rede devolve a MESMA solicitação, sem criar outro pedido.
 if exists(select 1 from public.gf_contratacao_form_respostas
    where evento_contratacao_id=v_evento.id
    and origem_chave='fada-natal-2026:'||p_idempotencia::text) then
  return public.gf_natal_solicitar_horario(
   p_slug,p_horario,p_nome,p_whatsapp,p_email,p_alunos,p_pagamento,p_meio,
   p_data_pagamento,p_familia,p_observacao,p_idempotencia,p_aceite);
 end if;
 -- O horário NÃO é retido quando a mãe toca na opção; somente neste envio.
 -- A retenção é criada e convertida imediatamente, sem prazo visual de 10min.
 perform public.gf_natal_reservar_temporariamente(p_slug,p_horario,v_count,p_idempotencia);
 return public.gf_natal_solicitar_horario(
  p_slug,p_horario,p_nome,p_whatsapp,p_email,p_alunos,p_pagamento,p_meio,
  p_data_pagamento,p_familia,p_observacao,p_idempotencia,p_aceite);
end;$$;
revoke all on function public.gf_natal_solicitar_sem_cronometro(
 text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.gf_natal_solicitar_sem_cronometro(
 text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)
 to service_role;
