-- 104 · Remarcação administrativa na planilha: Gente que Dança e Fada Açucarada.
-- O horário somente pode mudar para um bloco existente e livre. Mantém
-- valor, pagamento, status, quantidade de alunos e referências históricas.
-- As reservas públicas e as remarcações usam a MESMA trava de campanha.

create or replace function public.gf_planilha_horarios_remarcacao(
 p_slug text, p_resposta uuid, p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;
 r public.gf_contratacao_form_respostas%rowtype;
 quantidade integer; horarios jsonb;
begin
 if p_slug not in ('gente-que-danca-2026','natal-fada-acucarada-2026')
  or p_usuario is null or not exists (
   select 1 from public.perfis where user_id=p_usuario
    and role in ('admin','super_admin')
  ) then raise exception 'Acesso administrativo necessário.';end if;
 select * into e from public.gf_contratacao_eventos where slug=p_slug;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select * into r from public.gf_contratacao_form_respostas
 where id=p_resposta and evento_contratacao_id=e.id;
 if not found or r.origem<>'formulario_site' or r.arquivado_em is not null
   or r.horario_id is null or r.agendamento_status not in ('solicitado','confirmado')
 then raise exception 'Esta inscrição não possui uma reserva ativa que possa ser remarcada.';end if;
 if jsonb_typeof(r.alunos_inscritos)<>'array' then
  raise exception 'Confira a quantidade de bailarinos antes de remarcar.';end if;
 quantidade:=jsonb_array_length(r.alunos_inscritos);
 if quantidade not between 1 and 4 then raise exception 'Quantidade de bailarinos inválida.';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',h.id,'dia',h.dia,'inicio',to_char(h.inicio,'HH24:MI'),
   'fim',to_char((h.inicio+make_interval(mins=>15*quantidade))::time,'HH24:MI'),
   'atual',h.id=r.horario_id,
   'disponivel',case when h.id=r.horario_id then true
    when p_slug='gente-que-danca-2026' then public.gf_gente_intervalo_livre(e.id,h.id,quantidade,r.id)
    else public.gf_natal_intervalo_livre(e.id,h.id,quantidade,null,r.id)
    end
 ) order by h.dia,h.inicio),'[]'::jsonb) into horarios
 from public.gf_contratacao_horarios h
 where h.evento_contratacao_id=e.id and
  ((h.ativo and h.duracao_minutos=15 and h.capacidade=1)
    or h.id=r.horario_id);
 return jsonb_build_object('ok',true,'horarios',horarios,'quantidade',quantidade,
  'horario_atual_id',r.horario_id,'status',r.agendamento_status);
end;$$;

create or replace function public.gf_planilha_remarcar_agendamento(
 p_slug text,p_resposta uuid,p_horario_anterior uuid,p_novo_horario uuid,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;
 r public.gf_contratacao_form_respostas%rowtype;
 antigo public.gf_contratacao_horarios%rowtype;
 novo public.gf_contratacao_horarios%rowtype;
 quantidade integer;livre boolean;
begin
 if p_slug not in ('gente-que-danca-2026','natal-fada-acucarada-2026')
  or p_usuario is null or not exists(
   select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin')
  ) then raise exception 'Acesso administrativo necessário.';end if;
 if p_horario_anterior is null or p_novo_horario is null then
  raise exception 'Escolha um horário existente na agenda.';end if;
 -- Primeiro trava a campanha, depois a ficha. Mesma ordem dos fluxos
 -- públicos: impede duas famílias de ocupar o mesmo intervalo.
 select * into e from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select * into r from public.gf_contratacao_form_respostas
 where id=p_resposta and evento_contratacao_id=e.id for update;
 if not found or r.origem<>'formulario_site' or r.arquivado_em is not null
  or r.horario_id is null or r.agendamento_status not in ('solicitado','confirmado')
 then raise exception 'A reserva não está ativa ou foi removida.';end if;
 if r.horario_id is distinct from p_horario_anterior then
  raise exception 'Outro administrador já alterou o horário. Atualize a planilha antes de salvar.';end if;
 if p_novo_horario=r.horario_id then
  return jsonb_build_object('ok',true,'alterado',false,'horario_id',r.horario_id);
 end if;
 if jsonb_typeof(r.alunos_inscritos)<>'array' then
  raise exception 'A quantidade de bailarinos precisa estar cadastrada.';end if;
 quantidade:=jsonb_array_length(r.alunos_inscritos);
 if quantidade not between 1 and 4 then raise exception 'Quantidade de bailarinos inválida.';end if;
 -- Uma solicitação natalina sem pagamento e já expirada não deve criar
 -- uma vaga "reservada" invisível para o formulário público.
 if p_slug='natal-fada-acucarada-2026'
  and r.agendamento_status='solicitado' and r.valor_recebido_centavos=0
  and r.pagamento_situacao not in ('parcial','pago_manual')
  and coalesce(r.agendamento_expira_em,'-infinity'::timestamptz)<=now()
 then raise exception 'Esta solicitação expirou. Faça uma nova reserva antes de remarcar.';end if;
 select * into antigo from public.gf_contratacao_horarios
  where id=r.horario_id and evento_contratacao_id=e.id;
 select * into novo from public.gf_contratacao_horarios
  where id=p_novo_horario and evento_contratacao_id=e.id
    and ativo=true and duracao_minutos=15 and capacidade=1;
 if not found then raise exception 'Este horário não está disponível nesta campanha.';end if;
 if p_slug='gente-que-danca-2026' then
  livre:=public.gf_gente_intervalo_livre(e.id,novo.id,quantidade,r.id);
 else
  livre:=public.gf_natal_intervalo_livre(e.id,novo.id,quantidade,null,r.id);
 end if;
 if not livre then raise exception 'O horário foi ocupado ou não comporta todos os bailarinos. Escolha outro.';end if;
 update public.gf_contratacao_form_respostas set
  horario_id=novo.id,atualizado_em=now()
 where id=r.id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(e.id,p_usuario,'agendamento_remarcado_planilha',
   jsonb_build_object(
    'resposta_id',r.id,'horario_anterior_id',antigo.id,'dia_anterior',antigo.dia,
    'inicio_anterior',to_char(antigo.inicio,'HH24:MI'),
    'horario_novo_id',novo.id,'dia_novo',novo.dia,
    'inicio_novo',to_char(novo.inicio,'HH24:MI'),
    'quantidade_alunos',quantidade,'status_preservado',r.agendamento_status,
    'pagamento_situacao_preservada',r.pagamento_situacao,
    'valor_recebido_preservado',r.valor_recebido_centavos));
 return jsonb_build_object('ok',true,'alterado',true,'horario_id',novo.id,
  'dia',novo.dia,'inicio',to_char(novo.inicio,'HH24:MI'));
end;$$;

-- Edição e remarcação numa única transação RPC: se a vaga for tomada,
-- nomes, notas e colunas também são revertidos. A função antiga continua
-- intacta e o fluxo sem alteração de horário permanece compatível.
create or replace function public.gf_planilha_editar_com_remarcacao(
 p_campanha_id uuid,p_resposta_id uuid,p_usuario_id uuid,
 p_nome text,p_whatsapp text,p_bailarina text,p_alunos jsonb,
 p_campos jsonb,p_cor text,p_nota text,
 p_horario_anterior uuid,p_novo_horario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;
 editado jsonb;remarcado jsonb;
begin
 select * into e from public.gf_contratacao_eventos
  where id=p_campanha_id for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 editado:=public.gf_contratacao_admin_editar_resposta(
  p_campanha_id,p_resposta_id,p_usuario_id,p_nome,p_whatsapp,p_bailarina,
  p_alunos,p_campos,p_cor,p_nota
 );
 remarcado:=public.gf_planilha_remarcar_agendamento(
  e.slug,p_resposta_id,p_horario_anterior,p_novo_horario,p_usuario_id
 );
 return jsonb_build_object('ok',true,'resposta_id',p_resposta_id,
  'remarcacao',remarcado);
end;$$;

revoke all on function public.gf_planilha_horarios_remarcacao(text,uuid,uuid)
 from public,anon,authenticated;
revoke all on function public.gf_planilha_remarcar_agendamento(text,uuid,uuid,uuid,uuid)
 from public,anon,authenticated;
revoke all on function public.gf_planilha_editar_com_remarcacao(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_planilha_horarios_remarcacao(text,uuid,uuid) to service_role;
grant execute on function public.gf_planilha_remarcar_agendamento(text,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.gf_planilha_editar_com_remarcacao(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,uuid,uuid) to service_role;
