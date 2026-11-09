-- 091: proteção adicional contra horários sobrepostos na campanha natalina.
-- Esta migration é incremental; a versão 090 já está ativa na produção.
-- Preserva todos os agendamentos, respostas, valores e status.
create or replace function public.gf_natal_gerar_horarios(
 p_slug text,p_dia date,p_inicio time,p_fim time,p_duracao integer,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;v_hora time;v_gerados integer:=0;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found or p_slug <> 'natal-fada-acucarada-2026' then raise exception 'Campanha de Natal não encontrada.';end if;
 if v_evento.status='encerrado' then raise exception 'Campanha encerrada.';end if;
 if p_dia not in ('2026-12-12'::date,'2026-12-13'::date)
 or p_inicio is null or p_fim is null or p_fim<=p_inicio
 or p_duracao not between 5 and 90 then
  raise exception 'Escolha 12 ou 13 de dezembro, horas válidas e duração entre 5 e 90 minutos.';
 end if;
 if extract(epoch from (p_fim-p_inicio)) /60 > 720 then
  raise exception 'Um intervalo de agendamento não pode ultrapassar 12 horas.';
 end if;
 v_hora:=p_inicio;
 while v_hora + make_interval(mins=>p_duracao) <= p_fim loop
  -- A linha de evento já está travada com FOR UPDATE: duas edições da agenda
  -- da mesma campanha são serializadas inclusive quando criam horários novos.
  if exists (
   select 1 from public.gf_contratacao_horarios h
   where h.evento_contratacao_id=v_evento.id and h.dia=p_dia
     and h.ativo
     and h.inicio < (v_hora + make_interval(mins=>p_duracao))
     and (h.inicio + make_interval(mins=>h.duracao_minutos)) > v_hora
     and not (h.inicio=v_hora and h.duracao_minutos=p_duracao)
  ) then
   raise exception 'Existe uma sessão que se sobrepõe ao horário %. Revise as faixas de atendimento.',to_char(v_hora,'HH24:MI');
  end if;
  insert into public.gf_contratacao_horarios(evento_contratacao_id,dia,inicio,duracao_minutos,capacidade,ativo)
  values(v_evento.id,p_dia,v_hora,p_duracao,1,true)
  on conflict(evento_contratacao_id,dia,inicio) do nothing;
  if found then v_gerados:=v_gerados+1;end if;
  v_hora:=v_hora+make_interval(mins=>p_duracao);
 end loop;
 if v_gerados=0 then raise exception 'Nenhum horário novo foi criado. Revise os intervalos.';end if;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_evento.id,p_usuario,'horarios_natal_criados',
   jsonb_build_object('dia',p_dia,'inicio',p_inicio,'fim',p_fim,'duracao_minutos',p_duracao,'novos',v_gerados));
 return jsonb_build_object('ok',true,'novos',v_gerados);
end;$$;

revoke all on function public.gf_natal_gerar_horarios(text,date,time,time,integer,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_natal_gerar_horarios(text,date,time,time,integer,uuid)
 to service_role;
