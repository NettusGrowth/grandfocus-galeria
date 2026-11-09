-- 092 · Fada Açucarada: sessão por aluna, retenção real de 10 minutos, sem checkout automático.
-- Incremental, rascunho permanece fechado. Todas as reservas coexistem com respostas anteriores.
create table if not exists public.gf_natal_holds (
 token uuid primary key,
 evento_contratacao_id uuid not null references public.gf_contratacao_eventos(id) on delete restrict,
 horario_id uuid not null references public.gf_contratacao_horarios(id) on delete restrict,
 quantidade_alunos integer not null check (quantidade_alunos between 1 and 4),
 status text not null default 'ativo' check(status in ('ativo','convertido','liberado')),
 expira_em timestamptz not null,
 resposta_id uuid references public.gf_contratacao_form_respostas(id) on delete restrict,
 criado_em timestamptz not null default now()
);
create index if not exists gf_natal_holds_evento_ativos_idx
 on public.gf_natal_holds(evento_contratacao_id,expira_em) where status='ativo';
alter table public.gf_natal_holds enable row level security;
revoke all on public.gf_natal_holds from public,anon,authenticated;
grant select,insert,update on public.gf_natal_holds to service_role;

-- Verifica TODOS os blocos consecutivos de 15 min, reservas definitivas e retenções temporárias.
-- Os gravadores serializam por FOR UPDATE na linha da campanha.
create or replace function public.gf_natal_intervalo_livre(
 p_evento uuid,p_inicio uuid,p_quantidade integer,p_token uuid default null,p_ignorar_resposta uuid default null
) returns boolean language plpgsql security invoker set search_path=''
as $$
declare v_inicio public.gf_contratacao_horarios%rowtype;v_total int;v_fim time;
begin
 if p_quantidade not between 1 and 4 then return false;end if;
 select * into v_inicio from public.gf_contratacao_horarios
 where id=p_inicio and evento_contratacao_id=p_evento and ativo=true and duracao_minutos=15;
 if not found then return false;end if;
 select count(*) into v_total
 from generate_series(0,p_quantidade-1) as passos(n)
 join public.gf_contratacao_horarios h on
  h.evento_contratacao_id=p_evento and h.dia=v_inicio.dia and
  h.inicio=(v_inicio.inicio+make_interval(mins=>passos.n*15))::time
  and h.ativo and h.duracao_minutos=15;
 if v_total<>p_quantidade then return false;end if;
 v_fim:=(v_inicio.inicio+make_interval(mins=>p_quantidade*15))::time;
 if exists(
  select 1 from public.gf_natal_holds hold
  join public.gf_contratacao_horarios inicio on inicio.id=hold.horario_id
  where hold.evento_contratacao_id=p_evento and hold.status='ativo' and hold.expira_em>now()
    and (p_token is null or hold.token<>p_token)
    and inicio.dia=v_inicio.dia
    and inicio.inicio<v_fim
    and (inicio.inicio+make_interval(mins=>hold.quantidade_alunos*15))::time>v_inicio.inicio
 ) then return false;end if;
 if exists(
  select 1 from public.gf_contratacao_form_respostas r
  join public.gf_contratacao_horarios inicio on inicio.id=r.horario_id
  where r.evento_contratacao_id=p_evento
   and (p_ignorar_resposta is null or r.id<>p_ignorar_resposta)
   and r.arquivado_em is null and r.origem='formulario_site'
   and (r.agendamento_status='confirmado' or
        (r.agendamento_status='solicitado'
          and (r.agendamento_expira_em>now() or r.pagamento_situacao in ('parcial','pago_manual'))))
   and inicio.dia=v_inicio.dia and inicio.inicio<v_fim
   and (inicio.inicio+make_interval(
    mins=>15*(case when jsonb_typeof(r.alunos_inscritos)='array' then
         greatest(1,least(4,jsonb_array_length(r.alunos_inscritos))) else 1 end)
    ))::time>v_inicio.inicio
 ) then return false;end if;
 return true;
end;$$;

-- Lista horários compatíveis com N crianças sem revelar informações de outras famílias.
create or replace function public.gf_natal_listar_inicios(
 p_slug text,p_quantidade integer,p_token uuid default null,p_preview boolean default false
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_quantidade not between 1 and 4 then
   raise exception 'Agenda ou quantidade inválida.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug;
 if not found then raise exception 'Campanha indisponível.';end if;
 if v_evento.status<>'publicado' and not p_preview then
  return jsonb_build_object('disponivel',false,'horarios','[]'::jsonb);
 end if;
 return jsonb_build_object('disponivel',v_evento.status='publicado',
  'campanha',v_evento.nome_publico,'duracao_minutos',p_quantidade*15,
  'horarios',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',h.id,'dia',h.dia,'inicio',to_char(h.inicio,'HH24:MI'),
    'duracao_minutos',p_quantidade*15,'capacidade',1,'ativo',h.ativo,
    'ocupados',case when h.ativo and public.gf_natal_intervalo_livre(v_evento.id,h.id,p_quantidade,p_token,null) then 0 else 1 end,
    'disponiveis',case when h.ativo and public.gf_natal_intervalo_livre(v_evento.id,h.id,p_quantidade,p_token,null) then 1 else 0 end
   ) order by h.dia,h.inicio)
   from public.gf_contratacao_horarios h
   where h.evento_contratacao_id=v_evento.id and (p_preview or h.ativo)
  ),'[]'::jsonb));
end;$$;

-- Administração continua a receber a mesma estrutura (1 bloco cada).
create or replace function public.gf_natal_listar_horarios(p_slug text,p_preview boolean default false)
returns jsonb language plpgsql security invoker set search_path=''
as $$
begin
 return public.gf_natal_listar_inicios(p_slug,1,null,p_preview);
end;$$;

-- Clique no horário: bloqueia N blocos, por no máximo 10min, de verdade no banco.
create or replace function public.gf_natal_reservar_temporariamente(
 p_slug text,p_horario uuid,p_quantidade integer,p_token uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;
 v_hold public.gf_natal_holds%rowtype;v_expira timestamptz;v_inicio public.gf_contratacao_horarios%rowtype;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_token is null or p_horario is null
    or p_quantidade not between 1 and 4 then raise exception 'Reserva inválida.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found or v_evento.status<>'publicado' then raise exception 'A agenda ainda não foi aberta.';end if;
 select * into v_hold from public.gf_natal_holds where token=p_token for update;
 if found and (v_hold.evento_contratacao_id<>v_evento.id or v_hold.status='convertido') then
  raise exception 'Essa reserva já foi concluída. Inicie um novo agendamento.';end if;
 if not public.gf_natal_intervalo_livre(v_evento.id,p_horario,p_quantidade,p_token,null) then
  raise exception 'Esse horário não comporta mais a sessão da sua família. Escolha outra opção.';end if;
 v_expira:=case
   when found and v_hold.status='ativo' and v_hold.expira_em>now() then v_hold.expira_em
   else now()+interval '10 minutes' end;
 if found then
   update public.gf_natal_holds set horario_id=p_horario,quantidade_alunos=p_quantidade,
     expira_em=v_expira,status='ativo',resposta_id=null where token=p_token;
 else
   insert into public.gf_natal_holds(token,evento_contratacao_id,horario_id,quantidade_alunos,expira_em)
   values(p_token,v_evento.id,p_horario,p_quantidade,v_expira);
 end if;
 select * into v_inicio from public.gf_contratacao_horarios where id=p_horario;
 return jsonb_build_object('ok',true,'horario_id',p_horario,
  'dia',v_inicio.dia,'inicio',to_char(v_inicio.inicio,'HH24:MI'),
  'duracao_minutos',p_quantidade*15,'expira_em',v_expira,'server_now',now());
end;$$;

create or replace function public.gf_natal_liberar_reserva(p_slug text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_evento public.gf_contratacao_eventos%rowtype;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_token is null then
  raise exception 'Reserva inválida.';end if;
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 update public.gf_natal_holds set status='liberado'
 where token=p_token and evento_contratacao_id=v_evento.id and status='ativo';
 return jsonb_build_object('ok',true);
end;$$;

-- Mantém todas as validações de responsáveis, valores, aceite e idempotência originais;
-- exige que a retenção dos N blocos ainda esteja válida na mesma transação.
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
 v_hold public.gf_natal_holds%rowtype;
 v_id uuid;
begin
 if p_slug<>'natal-fada-acucarada-2026' or p_aceite is distinct from true
 then raise exception 'O cadastro de Natal não está disponível.';end if;
 if p_idempotencia is null or p_horario is null or p_pagamento not in ('ja_paguei','a_pagar')
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
 select * into v_evento from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found or v_evento.status<>'publicado' then
  raise exception 'O agendamento ainda não foi liberado.';end if;
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
 select * into v_slot from public.gf_contratacao_horarios
 where id=p_horario and evento_contratacao_id=v_evento.id and ativo=true for update;
 if not found then raise exception 'Horário indisponível. Escolha outro.';end if;
 if v_slot.dia not in ('2026-12-12'::date,'2026-12-13'::date)
 then raise exception 'Data de agendamento inválida.';end if;
 -- A trava do evento serializa a conversão e novas pré-reservas.
 select * into v_hold from public.gf_natal_holds
  where token=p_idempotencia and evento_contratacao_id=v_evento.id for update;
 if not found or v_hold.status<>'ativo' or v_hold.expira_em<=now()
   or v_hold.horario_id<>p_horario or v_hold.quantidade_alunos<>v_count then
  raise exception 'A reserva de 10 minutos expirou ou foi alterada. Escolha um horário novamente.';
 end if;
 if not public.gf_natal_intervalo_livre(v_evento.id,p_horario,v_count,p_idempotencia,null) then
  raise exception 'Esse horário não está mais disponível para todos os alunos. Escolha outro.';
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
  'Horário solicitado: '||to_char(v_slot.dia,'DD/MM/YYYY')||' '||to_char(v_slot.inicio,'HH24:MI')||
  ' • Aguardando confirmação da equipe. '||
  'Alunos: '||array_to_string(v_nomes,', ')||
  case when p_data_pagamento is not null then ' • Pagou em '||to_char(p_data_pagamento,'DD/MM/YYYY') else '' end||
  case when nullif(btrim(coalesce(p_observacao,'')),'') is not null then ' • Observações: '||btrim(p_observacao) else '' end,
  v_slot.id,'solicitado',now()+(case when p_pagamento='ja_paguei' then interval '48 hours' else interval '24 hours' end),p_alunos,true,true
 ) returning id into v_id;
 update public.gf_natal_holds set status='convertido',resposta_id=v_id
  where token=p_idempotencia and status='ativo';
 return jsonb_build_object('ok',true,'codigo',left(v_id::text,8),'valor_centavos',v_preco,
   'ja_pago_declarado',p_pagamento='ja_paguei',
   'mensagem','Solicitação recebida. O horário depende de confirmação pela Grand Focus.');
end;$$;

-- A confirmação manual não poderá invadir um intervalo ocupado por outra família.
create or replace function public.gf_natal_atualizar_agendamento(
 p_slug text,p_resposta uuid,p_status text,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_row public.gf_contratacao_form_respostas%rowtype;
 v_slot public.gf_contratacao_horarios%rowtype;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 if p_status not in ('confirmado','cancelado') then raise exception 'Status inválido.';end if;
 select * into v_row from public.gf_contratacao_form_respostas where id=p_resposta;
 if not found or v_row.horario_id is null or v_row.origem<>'formulario_site' then
  raise exception 'Agendamento não encontrado.';end if;
 -- Mesma ordem de bloqueio das pré-reservas: campanha antes de horário.
 perform 1 from public.gf_contratacao_eventos
  where id=v_row.evento_contratacao_id and slug=p_slug and p_slug='natal-fada-acucarada-2026'
  for update;
 if not found then raise exception 'Agendamento pertence a outra campanha.';end if;
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
  if not public.gf_natal_intervalo_livre(
   v_row.evento_contratacao_id,v_row.horario_id,
   greatest(1,least(4,coalesce(jsonb_array_length(v_row.alunos_inscritos),1))),
   null,v_row.id
  ) then raise exception 'Esse período já está ocupado por outra família.';end if;
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

-- Desativação administrativa respeita todos os blocos de reservas consecutivas.
create or replace function public.gf_natal_desativar_horario(
 p_slug text,p_horario uuid,p_usuario uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_slot public.gf_contratacao_horarios%rowtype;
begin
 if p_usuario is null or not exists(select 1 from public.perfis where user_id=p_usuario and role in ('admin','super_admin'))
 then raise exception 'Acesso administrativo necessário.';end if;
 -- Evita colisões com pré-reservas criadas simultaneamente.
 perform 1 from public.gf_contratacao_eventos
  where slug=p_slug and p_slug='natal-fada-acucarada-2026' for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select h.* into v_slot from public.gf_contratacao_horarios h
 join public.gf_contratacao_eventos e on e.id=h.evento_contratacao_id
 where h.id=p_horario and e.slug=p_slug and p_slug='natal-fada-acucarada-2026'
 for update of h;
 if not found then raise exception 'Horário não encontrado.';end if;
 if not public.gf_natal_intervalo_livre(v_slot.evento_contratacao_id,v_slot.id,1,null,null) then
  raise exception 'Este horário pertence a uma reserva ou agendamento ativo.';
 end if;
 update public.gf_contratacao_horarios set ativo=false where id=p_horario;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_slot.evento_contratacao_id,p_usuario,'horario_natal_desativado',jsonb_build_object('horario_id',p_horario));
 return jsonb_build_object('ok',true);
end;$$;

-- Regras de escopo: todas as novas funções só são executáveis pela Edge Function service_role.
revoke all on function public.gf_natal_intervalo_livre(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_intervalo_livre(uuid,uuid,integer,uuid,uuid) to service_role;
revoke all on function public.gf_natal_listar_inicios(text,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.gf_natal_listar_inicios(text,integer,uuid,boolean) to service_role;
revoke all on function public.gf_natal_listar_horarios(text,boolean) from public,anon,authenticated;
grant execute on function public.gf_natal_listar_horarios(text,boolean) to service_role;
revoke all on function public.gf_natal_reservar_temporariamente(text,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_reservar_temporariamente(text,uuid,integer,uuid) to service_role;
revoke all on function public.gf_natal_liberar_reserva(text,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_liberar_reserva(text,uuid) to service_role;
revoke all on function public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.gf_natal_solicitar_horario(text,uuid,text,text,text,jsonb,text,text,date,text,text,uuid,boolean) to service_role;
revoke all on function public.gf_natal_atualizar_agendamento(text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_atualizar_agendamento(text,uuid,text,uuid) to service_role;
revoke all on function public.gf_natal_desativar_horario(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_desativar_horario(text,uuid,uuid) to service_role;

-- Agenda informada para 12/12 (manhã e tarde) e 13/12 (manhã), 15min por bailarina.
-- A campanha continua em rascunho; não se criam pedidos nem cobranças.
insert into public.gf_contratacao_horarios(evento_contratacao_id,dia,inicio,duracao_minutos,capacidade,ativo)
select e.id,faixa.dia,gerado.inicio::time,15,1,true
from public.gf_contratacao_eventos e
cross join (values
 (date '2026-12-12',timestamp '2026-12-12 08:00',timestamp '2026-12-12 12:30'),
 (date '2026-12-12',timestamp '2026-12-12 13:00',timestamp '2026-12-12 17:30'),
 (date '2026-12-13',timestamp '2026-12-13 09:00',timestamp '2026-12-13 12:30')
) as faixa(dia,comeco,ultimo)
cross join lateral generate_series(faixa.comeco,faixa.ultimo,interval '15 minutes') as gerado(inicio)
where e.slug='natal-fada-acucarada-2026'
on conflict(evento_contratacao_id,dia,inicio) do nothing;
