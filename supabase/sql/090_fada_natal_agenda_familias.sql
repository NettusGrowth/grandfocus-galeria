-- 090 • Agendamento familiar do Natal Fada Açucarada.
-- Sem checkout e sem confirmação automática de pagamento.
-- Acesso público exclusivamente pela Edge Function. Não concede SELECT/INSERT a anon.
-- Modo de atendimento configurável de forma independente para cada campanha.
alter table public.gf_contratacao_eventos
  add column if not exists modo_agendamento text not null default 'ordem_chegada';
alter table public.gf_contratacao_eventos
  add constraint gf_eventos_modo_agendamento_check
  check (modo_agendamento in ('ordem_chegada','horario_marcado'));
-- O Natal da Fada Açucarada foi solicitado com horário marcado.
update public.gf_contratacao_eventos
 set modo_agendamento='horario_marcado'
 where slug='natal-fada-acucarada-2026'
   and status='rascunho'
   and modo_agendamento='ordem_chegada';

create or replace function public.gf_contratacao_admin_salvar_modo_agendamento(
 p_slug text,p_modo text,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $
declare v_evento public.gf_contratacao_eventos%rowtype;
begin
 if p_usuario is null or not exists (
  select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin')
 ) then raise exception 'Acesso administrativo necessário.';end if;
 if p_modo not in ('ordem_chegada','horario_marcado') then
  raise exception 'Escolha um modo de agendamento válido.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if v_evento.status='encerrado' then raise exception 'Campanha encerrada.';end if;
 if v_evento.modo_agendamento=p_modo then
  return jsonb_build_object('ok',true,'modo_agendamento',p_modo,'sem_alteracao',true);
 end if;
 if p_modo='ordem_chegada' and exists(
   select 1 from public.gf_contratacao_form_respostas r
   where r.evento_contratacao_id=v_evento.id and r.horario_id is not null
      and r.arquivado_em is null
      and (r.agendamento_status='confirmado' or
         (r.agendamento_status='solicitado' and
          (r.agendamento_expira_em>now() or r.pagamento_situacao in ('pago_manual','parcial'))))
 ) then raise exception 'Não é possível remover o agendamento com reservas ativas. Resolva os agendamentos primeiro.';end if;
 update public.gf_contratacao_eventos
  set modo_agendamento=p_modo,atualizado_em=now() where id=v_evento.id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_evento.id,p_usuario,'modo_agendamento_alterado',
  jsonb_build_object('anterior',v_evento.modo_agendamento,'novo',p_modo));
 return jsonb_build_object('ok',true,'modo_agendamento',p_modo);
end;$;
revoke all on function public.gf_contratacao_admin_salvar_modo_agendamento(text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_contratacao_admin_salvar_modo_agendamento(text,text,uuid)
 to service_role;

create table if not exists public.gf_contratacao_horarios (
 id uuid primary key default gen_random_uuid(),
 evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id) on delete restrict,
 dia date not null,
 inicio time without time zone not null,
 duracao_minutos integer not null check (duracao_minutos between 5 and 90),
 capacidade integer not null default 1 check (capacidade between 1 and 8),
 ativo boolean not null default true,
 criado_em timestamptz not null default now(),
 unique(evento_contratacao_id,dia,inicio)
);
create index if not exists gf_horarios_campanha_dia_idx on public.gf_contratacao_horarios(evento_contratacao_id,dia,inicio);
alter table public.gf_contratacao_horarios enable row level security;
revoke all on public.gf_contratacao_horarios from public,anon,authenticated;
grant select,insert,update on public.gf_contratacao_horarios to service_role;

alter table public.gf_contratacao_form_respostas
 add column if not exists horario_id uuid references public.gf_contratacao_horarios(id) on delete restrict,
 add column if not exists agendamento_status text,
 add column if not exists agendamento_expira_em timestamptz,
 add column if not exists alunos_inscritos jsonb,
 add column if not exists email_responsavel text,
 add column if not exists pagamento_declarado text;
alter table public.gf_contratacao_form_respostas
 drop constraint if exists gf_contratacao_form_respostas_origem_check;
alter table public.gf_contratacao_form_respostas
 add constraint gf_contratacao_form_respostas_origem_check
 check (origem in ('google_forms','formulario_site'));
alter table public.gf_contratacao_form_respostas
 add constraint gf_natal_agendamento_status_check
 check (agendamento_status is null or agendamento_status in ('solicitado','confirmado','cancelado','expirado'));
alter table public.gf_contratacao_form_respostas
 add constraint gf_natal_pagamento_declarado_check
 check (pagamento_declarado is null or pagamento_declarado in ('ja_paguei','a_pagar'));
create index if not exists gf_respostas_horario_status_idx
 on public.gf_contratacao_form_respostas(horario_id,agendamento_status)
 where horario_id is not null;
create sequence if not exists public.gf_natal_registros_seq;
revoke all on sequence public.gf_natal_registros_seq from public,anon,authenticated;
grant usage on sequence public.gf_natal_registros_seq to service_role;

create or replace function public.gf_natal_listar_horarios(p_slug text, p_preview boolean default false)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;
begin
 if nullif(btrim(coalesce(p_slug,'')),'') is null then raise exception 'Campanha inválida.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if v_evento.status <> 'publicado' and not p_preview then
  return jsonb_build_object('disponivel',false,'horarios','[]'::jsonb);
 end if;
 return jsonb_build_object(
  'disponivel',v_evento.status='publicado',
  'campanha',v_evento.nome_publico,
  'modo_agendamento',v_evento.modo_agendamento,
  'horarios',coalesce((
   select jsonb_agg(
    jsonb_build_object(
      'id',h.id,'dia',h.dia,'inicio',to_char(h.inicio,'HH24:MI'),
      'duracao_minutos',h.duracao_minutos,'capacidade',h.capacidade,
      'ocupados',coalesce(ocup.ocupados,0),'disponiveis',greatest(0,h.capacidade-coalesce(ocup.ocupados,0)),
      'ativo',h.ativo
    ) order by h.dia,h.inicio
   )
   from public.gf_contratacao_horarios h
   left join lateral (
     select count(*)::integer as ocupados
     from public.gf_contratacao_form_respostas r
     where r.horario_id=h.id and r.arquivado_em is null
       and (r.agendamento_status='confirmado' or
            (r.agendamento_status='solicitado' and (r.agendamento_expira_em > now() or r.pagamento_situacao in ('parcial','pago_manual'))))
   ) ocup on true
   where h.evento_contratacao_id=v_evento.id and v_evento.modo_agendamento='horario_marcado'
   and (p_preview or h.ativo)
  ),'[]'::jsonb)
 );
end;$$;
revoke all on function public.gf_natal_listar_horarios(text,boolean) from public,anon,authenticated;
grant execute on function public.gf_natal_listar_horarios(text,boolean) to service_role;

create or replace function public.gf_natal_gerar_horarios(
 p_slug text,p_dia date,p_inicio time,p_fim time,p_duracao integer,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;v_hora time;v_gerados integer:=0;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if v_evento.status='encerrado' then raise exception 'Campanha encerrada.';end if;
 if v_evento.modo_agendamento<>'horario_marcado' then
  raise exception 'Escolha o modo Horário marcado antes de criar vagas.';end if;
 if p_dia is null or p_inicio is null or p_fim is null or p_fim<=p_inicio
 or p_duracao not between 5 and 90 then
  raise exception 'Escolha um dia, horas válidas e duração entre 5 e 90 minutos.';
 end if;
 if v_evento.data_evento is not null and abs(p_dia-v_evento.data_evento)>30 then
  raise exception 'Os horários precisam estar próximos da data do evento.';end if;
 if extract(epoch from (p_fim-p_inicio)) /60 > 720 then
  raise exception 'Um intervalo de agendamento não pode ultrapassar 12 horas.';
 end if;
 v_hora:=p_inicio;
 while v_hora + make_interval(mins=>p_duracao) <= p_fim loop
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

create or replace function public.gf_natal_desativar_horario(
 p_slug text,p_horario uuid,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_slot public.gf_contratacao_horarios%rowtype;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 select h.* into v_slot from public.gf_contratacao_horarios h
 join public.gf_contratacao_eventos e on e.id=h.evento_contratacao_id
 where h.id=p_horario and e.slug=p_slug
 for update of h;
 if not found then raise exception 'Horário não encontrado.';end if;
 if exists(
   select 1 from public.gf_contratacao_form_respostas r where r.horario_id=p_horario and r.arquivado_em is null
    and (r.agendamento_status='confirmado' or
      (r.agendamento_status='solicitado' and (r.agendamento_expira_em>now() or r.pagamento_situacao in ('parcial','pago_manual'))))
 ) then raise exception 'Este horário tem um agendamento ativo. Cancele-o antes de desativar.';end if;
 update public.gf_contratacao_horarios set ativo=false where id=p_horario;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_slot.evento_contratacao_id,p_usuario,'horario_natal_desativado',jsonb_build_object('horario_id',p_horario));
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.gf_natal_desativar_horario(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_desativar_horario(text,uuid,uuid) to service_role;

create or replace function public.gf_natal_solicitar_horario(
 p_slug text,p_horario uuid,p_nome text,p_whatsapp text,p_email text,
 p_alunos jsonb,p_pagamento text,p_meio text,p_data_pagamento date,
 p_familia text,p_observacao text,p_idempotencia uuid,p_aceite boolean
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 v_evento public.gf_contratacao_eventos%rowtype;
 v_slot public.gf_contratacao_horarios%rowtype;
 v_item jsonb;v_nome text;v_turma text;v_nomes text[]:=array[]::text[];
 v_count integer;v_ocupados integer;v_preco integer;v_tel text;v_key text;
 v_existing public.gf_contratacao_form_respostas%rowtype;
 v_id uuid;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_aceite is distinct from true
 then raise exception 'O cadastro de Natal não está disponível.';end if;
 if p_idempotencia is null or p_pagamento not in ('ja_paguei','a_pagar')
  or nullif(btrim(p_nome),'') is null or length(btrim(p_nome)) not between 5 and 120
  or p_alunos is null or jsonb_typeof(p_alunos)<>'array'
  or jsonb_array_length(p_alunos) not between 1 and 4
  or length(coalesce(p_email,''))>180
  or length(coalesce(p_observacao,''))>1000 or length(coalesce(p_familia,''))>250 then
    raise exception 'Revise os dados de identificação da família.';end if;
 if p_email<>'' and p_email is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 then raise exception 'E-mail inválido.';end if;
 v_tel:=regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g');
 if length(v_tel) not between 10 and 13 then raise exception 'Informe WhatsApp com DDD.';end if;
 if p_pagamento='ja_paguei' and p_meio not in ('pix','credito','outro','nao_sei','')
 then raise exception 'Meio de pagamento inválido.';end if;
 for v_item in select value from jsonb_array_elements(p_alunos) loop
  v_nome:=btrim(coalesce(v_item->>'nome',''));
  v_turma:=btrim(coalesce(v_item->>'turma',''));
  if length(v_nome) not between 3 and 120 or length(v_turma)>80 then
   raise exception 'Informe nome completo e turma válida para cada aluno.';end if;
  v_nomes:=array_append(v_nomes,v_nome);
 end loop;
 v_count:=jsonb_array_length(p_alunos);
 v_preco:=case v_count when 1 then 8000 when 2 then 14500 when 3 then 21500 else 28500 end;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug;
 if not found or v_evento.status<>'publicado' then
  raise exception 'O agendamento ainda não foi liberado.';end if;
 if v_evento.modo_agendamento='horario_marcado' and p_horario is null then
   raise exception 'Selecione um horário para participar.';end if;
 if v_evento.modo_agendamento='ordem_chegada' and p_horario is not null then
   raise exception 'Este evento utiliza ordem de chegada, sem horário marcado.';end if;
 v_key:='fada-natal-2026:'||p_idempotencia::text;
 select * into v_existing from public.gf_contratacao_form_respostas
 where evento_contratacao_id=v_evento.id and origem_chave=v_key;
 if found then
  if regexp_replace(v_existing.responsavel_whatsapp,'[^0-9]','','g')<>v_tel then
   raise exception 'Identificador de solicitação já utilizado.';end if;
  return jsonb_build_object('ok',true,'codigo',left(v_existing.id::text,8),
   'valor_centavos',v_existing.valor_informado_centavos,
   'ja_pago_declarado',v_existing.pagamento_declarado='ja_paguei',
   'reutilizado',true);
 end if;
 if v_evento.modo_agendamento='horario_marcado' then
 select * into v_slot from public.gf_contratacao_horarios
 where id=p_horario and evento_contratacao_id=v_evento.id and ativo=true for update;
 if not found then raise exception 'Horário indisponível. Escolha outro.';end if;
 if v_slot.dia not in ('2026-12-12'::date,'2026-12-13'::date)
 then raise exception 'Data de agendamento inválida.';end if;
 -- A mesma linha de horário é travada, impedindo duas inscrições simultâneas.
 update public.gf_contratacao_form_respostas
 set agendamento_status='expirado',atualizado_em=now()
 where horario_id=v_slot.id and agendamento_status='solicitado'
  and agendamento_expira_em<=now() and pagamento_situacao not in ('pago_manual','parcial');
 select count(*) into v_ocupados from public.gf_contratacao_form_respostas r
 where r.horario_id=v_slot.id and r.arquivado_em is null and
  (r.agendamento_status='confirmado' or
   (r.agendamento_status='solicitado' and (r.agendamento_expira_em>now() or r.pagamento_situacao in ('parcial','pago_manual'))));
 if v_ocupados>=v_slot.capacidade then
  raise exception 'Este horário acabou de ser escolhido por outra família. Selecione outro.';end if;
 end if;
 insert into public.gf_contratacao_form_respostas (
  evento_contratacao_id,origem_chave,origem,origem_linha,respondido_em,
  responsavel_nome,responsavel_whatsapp,email_responsavel,bailarina_nome,
  modalidade_original,experiencia_original,valor_informado_centavos,
  pagamento_preferido,pagamento_declarado,pagamento_situacao,
  observacao_origem,horario_id,agendamento_status,agendamento_expira_em,alunos_inscritos,
  responsavel_confirmou,condicoes_confirmadas
 ) values (
  v_evento.id,v_key,'formulario_site',nextval('public.gf_natal_registros_seq'),now(),
  btrim(p_nome),v_tel,nullif(btrim(coalesce(p_email,'')),''),
  left(array_to_string(v_nomes,', '),180),nullif(btrim(coalesce(p_familia,'')),''),
  'Especial Fotográfico de Natal · '||v_count||' aluno(s)',
  v_preco,
  case when p_pagamento='ja_paguei' then 'Pagamento anterior declarado: '||coalesce(p_meio,'não informado')
       else 'Ainda não pagou' end,
  p_pagamento,
  case when p_pagamento='ja_paguei' then 'nao_conferido' else 'pendente' end,
  case when v_evento.modo_agendamento='horario_marcado'
       then 'Horário solicitado: '||to_char(v_slot.dia,'DD/MM/YYYY')||' '||to_char(v_slot.inicio,'HH24:MI')
       else 'Atendimento por ordem de chegada' end||
  ' • Aguardando confirmação da equipe. '||
  'Alunos: '||array_to_string(v_nomes,', ')||
  case when p_data_pagamento is not null then ' • Pagou em '||to_char(p_data_pagamento,'DD/MM/YYYY') else '' end||
  case when nullif(btrim(coalesce(p_observacao,'')),'') is not null then ' • Observações: '||btrim(p_observacao) else '' end,
  p_horario,'solicitado',case when p_horario is null then null else now()+interval '48 hours' end,p_alunos,true,true
 ) returning id into v_id;
 return jsonb_build_object('ok',true,'codigo',left(v_id::text,8),'valor_centavos',v_preco,
   'ja_pago_declarado',p_pagamento='ja_paguei',
   'mensagem','Solicitação recebida. O horário depende de confirmação pela Grand Focus.');
end;$$;
revoke all on function public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean)
 to service_role;

create or replace function public.gf_natal_atualizar_agendamento(
 p_slug text,p_resposta uuid,p_status text,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_row public.gf_contratacao_form_respostas%rowtype;
 v_slot public.gf_contratacao_horarios%rowtype;v_total integer;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 if p_status not in ('confirmado','cancelado') then raise exception 'Status inválido.';end if;
 select * into v_row from public.gf_contratacao_form_respostas where id=p_resposta;
 if not found or v_row.horario_id is null or v_row.origem<>'formulario_site' then
  raise exception 'Agendamento não encontrado.';end if;
 select * into v_slot from public.gf_contratacao_horarios
 where id=v_row.horario_id for update;
 select * into v_row from public.gf_contratacao_form_respostas
 where id=p_resposta for update;
 if not exists(select 1 from public.gf_contratacao_eventos where id=v_row.evento_contratacao_id
   and slug=p_slug and p_slug='natal-fada-acucarada-2026') then raise exception 'Agendamento pertence a outra campanha.';end if;
 if p_status='confirmado' then
  if v_row.pagamento_situacao<>'pago_manual' or
    v_row.valor_recebido_centavos<v_row.valor_informado_centavos then
    raise exception 'Confira e registre o pagamento integral na Central antes de confirmar o horário.';end if;
  select count(*) into v_total from public.gf_contratacao_form_respostas r
   where r.horario_id=v_slot.id and r.id<>v_row.id and r.arquivado_em is null
    and (r.agendamento_status='confirmado' or
         (r.agendamento_status='solicitado' and (r.agendamento_expira_em>now() or r.pagamento_situacao in ('parcial','pago_manual'))));
  if v_total>=v_slot.capacidade then raise exception 'Horário já ocupado por outra família.';end if;
 else
  if v_row.valor_recebido_centavos>0 then
    raise exception 'Existe recebimento confirmado. Resolva o reembolso antes de cancelar.';end if;
 end if;
 update public.gf_contratacao_form_respostas
  set agendamento_status=p_status,agendamento_expira_em=null,atualizado_em=now()
  where id=p_resposta;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_row.evento_contratacao_id,p_usuario,'agendamento_natal_'||p_status,
   jsonb_build_object('resposta_id',p_resposta,'horario_id',v_slot.id));
 return jsonb_build_object('ok',true,'status',p_status);
end;$$;
revoke all on function public.gf_natal_atualizar_agendamento(text,uuid,text,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_natal_atualizar_agendamento(text,uuid,text,uuid)
 to service_role;
