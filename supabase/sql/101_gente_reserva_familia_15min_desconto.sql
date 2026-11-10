-- Gente que Dança 2026 · agendamento por bailarino(a), 18h00–22h00.
-- Não modifica cadastros/pagamentos históricos. A escolha do horário NÃO
-- cria uma retenção: toda a família é registrada em uma transação no envio.
-- Preserva quatro blocos para duas inscrições anteriores sem horário.
do $setup$
declare e uuid; old_students integer; s time;
begin
 select id into e from public.gf_contratacao_eventos
  where slug='gente-que-danca-2026' for update;
 if e is null then raise exception 'Gente que Dança não cadastrada';end if;
 select coalesce(sum(jsonb_array_length(alunos_inscritos)),0) into old_students
 from public.gf_contratacao_form_respostas
 where evento_contratacao_id=e and horario_id is null
   and pagamento_situacao<>'cancelado' and arquivado_em is null
   and jsonb_typeof(alunos_inscritos)='array';
 if old_students>4 then
  raise exception 'Há % alunos sem horário anterior; conciliar antes de publicar a nova agenda.',old_students;
 end if;
 for s in select (time '18:00'+make_interval(mins=>n*15))::time
  from generate_series(0,15) n loop
  insert into public.gf_contratacao_horarios
   (evento_contratacao_id,dia,inicio,duracao_minutos,capacidade,ativo)
  values(e,date '2026-12-15',s,15,1,
    not (s>=time '20:00' and s<(time '20:00'+make_interval(mins=>old_students*15))::time))
  on conflict(evento_contratacao_id,dia,inicio) do nothing;
 end loop;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,acao,detalhes)
 values(e,'gente_agenda_horarios_2026',
  jsonb_build_object('inicio','18:00','fim','22:00','intervalo_minutos',15,
   'alunos_sem_horario',old_students,'buffer_inicio','20:00',
   'obs','Blocos protegidos para inscrições anteriores sem horário, sem alterar contratos já pagos.'));
end $setup$;

create or replace function public.gf_gente_intervalo_livre(
 p_evento uuid,p_horario uuid,p_quantidade integer,p_ignorar_resposta uuid default null
) returns boolean language plpgsql security invoker set search_path=''
as $$
declare h public.gf_contratacao_horarios%rowtype; blocks int; finish_at time;
begin
 if p_quantidade not between 1 and 4 then return false;end if;
 select * into h from public.gf_contratacao_horarios
  where id=p_horario and evento_contratacao_id=p_evento
    and dia=date '2026-12-15' and ativo=true
    and duracao_minutos=15 and capacidade=1;
 if not found or h.inicio<time '18:00' then return false;end if;
 finish_at:=(h.inicio+make_interval(mins=>p_quantidade*15))::time;
 if finish_at>time '22:00' or finish_at<=h.inicio then return false;end if;
 select count(*) into blocks from generate_series(0,p_quantidade-1) step
 join public.gf_contratacao_horarios next on next.evento_contratacao_id=p_evento
  and next.dia=date '2026-12-15'
  and next.inicio=(h.inicio+make_interval(mins=>step*15))::time
  and next.ativo and next.duracao_minutos=15 and next.capacidade=1;
 if blocks<>p_quantidade then return false;end if;
 -- Não liberar vaga ao arquivar uma ficha: somente status cancelado libera.
 if exists(
  select 1 from public.gf_contratacao_form_respostas r
  join public.gf_contratacao_horarios booked on booked.id=r.horario_id
  where r.evento_contratacao_id=p_evento
    and (p_ignorar_resposta is null or r.id<>p_ignorar_resposta)
    and r.agendamento_status in ('solicitado','confirmado')
    and booked.dia=h.dia and booked.inicio<finish_at
    and (booked.inicio+make_interval(mins=>
      15*(case when jsonb_typeof(r.alunos_inscritos)='array'
        then greatest(1,least(4,jsonb_array_length(r.alunos_inscritos))) else 1 end)))::time > h.inicio
 ) then return false;end if;
 return true;
end;$$;

create or replace function public.gf_gente_listar_inicios(p_quantidade integer)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;slots jsonb;
begin
 if p_quantidade not between 1 and 4 then raise exception 'Quantidade de bailarinos inválida';end if;
 select * into e from public.gf_contratacao_eventos where slug='gente-que-danca-2026';
 if not found or e.status<>'publicado' or e.vendas_encerram_em<=now() then
  return jsonb_build_object('disponivel',false,'horarios','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',h.id,'dia',h.dia,'inicio',to_char(h.inicio,'HH24:MI'),
   'fim',to_char((h.inicio+make_interval(mins=>p_quantidade*15))::time,'HH24:MI'),
   'duracao_minutos',p_quantidade*15) order by h.inicio),'[]'::jsonb)
 into slots
 from public.gf_contratacao_horarios h
 where h.evento_contratacao_id=e.id and h.dia=date '2026-12-15'
   and h.ativo and h.duracao_minutos=15
   and public.gf_gente_intervalo_livre(e.id,h.id,p_quantidade,null);
 return jsonb_build_object('disponivel',true,'horarios',slots,
  'data','2026-12-15','inicio','18:00','fim','22:00','quantidade',p_quantidade);
end;$$;

create or replace function public.gf_gente_solicitar_agendamento(
 p_slug text,p_horario uuid,p_responsavel text,p_whatsapp text,p_alunos jsonb,
 p_preferencia text,p_idempotencia uuid,p_aceite boolean
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;c integer;name text;
 valor integer;tel text;r public.gf_contratacao_form_respostas%rowtype;
 aluno jsonb;nomes text[]:=array[]::text[];h public.gf_contratacao_horarios%rowtype;
begin
 if p_slug<>'gente-que-danca-2026' or p_idempotencia is null or p_horario is null
  or p_aceite is distinct from true or p_preferencia not in ('pix','credito')
  or length(btrim(coalesce(p_responsavel,''))) not between 5 and 120
  or p_alunos is null or jsonb_typeof(p_alunos)<>'array'
  or jsonb_array_length(p_alunos) not between 1 and 4
 then raise exception 'Confira os dados do agendamento.';end if;
 tel:=regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g');
 if length(tel) not between 10 and 13 then
  raise exception 'Informe seu WhatsApp com DDD.';end if;
 c:=jsonb_array_length(p_alunos);
 valor:=15000+12000*(c-1);
 for aluno in select value from jsonb_array_elements(p_alunos) loop
  name:=btrim(coalesce(aluno->>'nome',''));
  if length(name) not between 3 and 120
    or length(btrim(coalesce(aluno->>'turma','')))>80
    then raise exception 'Informe o nome completo de cada bailarino(a).';end if;
  nomes:=array_append(nomes,name);
 end loop;
 -- Trava o evento até a conclusão da solicitação. Só uma família ocupa
 -- o mesmo conjunto de blocos; retries não geram cadastro duplicado.
 select * into e from public.gf_contratacao_eventos
 where slug=p_slug for update;
 if not found or e.status<>'publicado' or e.vendas_encerram_em<=now()
 then raise exception 'As inscrições não estão abertas.';end if;
 select * into r from public.gf_contratacao_form_respostas
  where evento_contratacao_id=e.id
  and origem_chave='gente-2026:'||p_idempotencia::text;
 if found then
  if regexp_replace(r.responsavel_whatsapp,'[^0-9]','','g')<>tel
     or r.horario_id is distinct from p_horario
     or r.valor_informado_centavos<>valor
    then raise exception 'Esta solicitação já foi enviada com outros dados.';end if;
  return jsonb_build_object('ok',true,'codigo',left(r.id::text,8),
   'valor_centavos',r.valor_informado_centavos,'reutilizado',true,
   'inicio',(select to_char(inicio,'HH24:MI') from public.gf_contratacao_horarios where id=p_horario));
 end if;
 if not public.gf_gente_intervalo_livre(e.id,p_horario,c,null)
 then raise exception 'Esse horário acabou de ser reservado. Selecione outro disponível.';end if;
 select * into h from public.gf_contratacao_horarios where id=p_horario;
 insert into public.gf_contratacao_form_respostas(
 evento_contratacao_id,origem_chave,origem,origem_linha,respondido_em,
 responsavel_nome,responsavel_whatsapp,bailarina_nome,
 experiencia_original,valor_informado_centavos,pagamento_preferido,
 pagamento_situacao,pagamento_declarado,alunos_inscritos,
 responsavel_confirmou,condicoes_confirmadas,observacao_origem,
 horario_id,agendamento_status,agendamento_expira_em
 )values(
 e.id,'gente-2026:'||p_idempotencia::text,'formulario_site',
 nextval('public.gf_natal_registros_seq'),now(),
 btrim(p_responsavel),tel,left(array_to_string(nomes,', '),180),
 'Gente que Dança: '||c||' bailarino(a)(s), '||c*15||' minutos',
 valor,case p_preferencia when 'pix' then 'Pix'
  else 'Cartão de crédito (parcelamento pode ter taxas)' end,
 'pendente',null,p_alunos,true,true,
 'Reserva 15/12/2026 '||to_char(h.inicio,'HH24:MI')||'–'||
  to_char((h.inicio+make_interval(mins=>c*15))::time,'HH24:MI')||
  '. Desconto de R$ 30 por bailarino(a) adicional. Pagamento manual.',
 p_horario,'solicitado',make_timestamptz(2026,12,15,22,0,0,'America/Sao_Paulo')
 ) returning * into r;
 return jsonb_build_object('ok',true,'codigo',left(r.id::text,8),
  'valor_centavos',valor,'reutilizado',false,
  'inicio',to_char(h.inicio,'HH24:MI'),
  'fim',to_char((h.inicio+make_interval(mins=>c*15))::time,'HH24:MI'),
  'duracao_minutos',c*15,
  'mensagem','Horário registrado, aguardando confirmação de pagamento pela Grand Focus.');
end;$$;

revoke all on function public.gf_gente_intervalo_livre(uuid,uuid,integer,uuid)
 from public,anon,authenticated;
revoke all on function public.gf_gente_listar_inicios(integer)
 from public,anon,authenticated;
revoke all on function public.gf_gente_solicitar_agendamento(text,uuid,text,text,jsonb,text,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.gf_gente_intervalo_livre(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.gf_gente_listar_inicios(integer) to service_role;
grant execute on function public.gf_gente_solicitar_agendamento(text,uuid,text,text,jsonb,text,uuid,boolean) to service_role;

-- A equipe pode confirmar após recebimento e cancelar uma solicitação
-- não paga, liberando todos os blocos ocupados. Nunca cancela automaticamente
-- uma compra que já tenha recebimento registrado.
create or replace function public.gf_gente_atualizar_agendamento(
 p_slug text,p_resposta uuid,p_status text,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;r public.gf_contratacao_form_respostas%rowtype;
begin
 if p_slug<>'gente-que-danca-2026' or p_status not in ('confirmado','cancelado')
 or p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario
  and role in ('admin','super_admin')) then
  raise exception 'Ação de agendamento não autorizada.';end if;
 select * into e from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select * into r from public.gf_contratacao_form_respostas
  where id=p_resposta and evento_contratacao_id=e.id and horario_id is not null
  for update;
 if not found then raise exception 'Esta inscrição não tem horário reservado. Contate a família.';end if;
 if r.agendamento_status=p_status then return jsonb_build_object('ok',true,'status',p_status);end if;
 if r.agendamento_status<>'solicitado' then
  raise exception 'O agendamento já foi concluído ou cancelado.';end if;
 if p_status='confirmado' then
  if r.pagamento_situacao<>'pago_manual'
    or r.valor_recebido_centavos<r.valor_informado_centavos then
    raise exception 'Confirme o pagamento integral antes de confirmar o horário.';end if;
 else
  if r.valor_recebido_centavos>0 or r.pagamento_situacao in ('pago_manual','parcial')
  then raise exception 'Há dinheiro recebido. Resolva o reembolso antes de cancelar.';end if;
 end if;
 update public.gf_contratacao_form_respostas
  set agendamento_status=p_status,atualizado_em=now()
  where id=r.id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(e.id,p_usuario,'gente_horario_'||p_status,
 jsonb_build_object('resposta_id',r.id,'horario_id',r.horario_id));
 return jsonb_build_object('ok',true,'status',p_status);
end;$$;
revoke all on function public.gf_gente_atualizar_agendamento(text,uuid,text,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_gente_atualizar_agendamento(text,uuid,text,uuid) to service_role;
