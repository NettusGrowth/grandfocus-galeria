-- 094: Fada Açucarada publica SEM obrigar checkout InfinitePay.
-- Validação legal e comercial continua obrigatória. Outras campanhas não mudam.
-- A agenda só abre quando o admin autorizado explicitamente publica.
-- Conclui em uma transação; não ativa pagamentos automáticos.
create or replace function public.gf_natal_admin_publicar(p_slug text,p_usuario uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 e public.gf_contratacao_eventos%rowtype;
 d text;
 n int;
 invalidos int;
begin
 if p_slug <> 'natal-fada-acucarada-2026' or p_usuario is null
    or not exists(select 1 from public.perfis
     where user_id=p_usuario and role in ('admin','super_admin')) then
   raise exception 'Apenas a equipe administrativa pode publicar o Natal.';
 end if;
 select * into e from public.gf_contratacao_eventos
  where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if e.status='encerrado' then raise exception 'A campanha encerrada não pode ser reaberta.';end if;
 if e.escola_id is null or e.evento_id is null or
  e.data_evento<>date '2026-12-12' or
  nullif(btrim(e.local),'') is null
 then raise exception 'Confira escola, evento, data e local antes de publicar.';end if;
 if e.vendas_encerram_em is null or e.vendas_encerram_em<=now()
    or e.vendas_encerram_em>make_timestamptz(2026,12,13,12,45,0,'America/Sao_Paulo')
 then raise exception 'Configure um prazo de inscrições futuro, até 13/12 às 12h45.';end if;
 if e.whatsapp_atendimento is null or
  length(regexp_replace(e.whatsapp_atendimento,'[^0-9]','','g')) not between 10 and 13
 then raise exception 'Informe WhatsApp de atendimento válido.';end if;
 d:=regexp_replace(coalesce(e.fornecedor_documento,''),'[^0-9]','','g');
 if nullif(btrim(e.fornecedor_nome),'') is null or length(d) not between 11 and 14
   or coalesce(e.fornecedor_email,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
 then raise exception 'Complete os dados válidos do fornecedor (nome, CPF/CNPJ e e-mail).';end if;
 if nullif(btrim(e.termos_versao),'') is null or length(coalesce(e.termos_conteudo,''))<100
   or nullif(btrim(e.privacidade_versao),'') is null
   or length(coalesce(e.privacidade_conteudo,''))<100
   or coalesce(e.privacidade_url,'')!~'^https://[^[:space:]]+$'
 then raise exception 'Preencha os termos da experiência e a política de privacidade antes de publicar.';end if;
 if e.autorizacao_imagem_conteudo is not null and e.autorizacao_imagem_versao is null
 then raise exception 'Identifique a versão do documento de autorização de imagem.';end if;
 select count(*),count(*) filter(where not ativo or duracao_minutos<>15 or capacidade<>1
   or (dia=date '2026-12-12' and not (
     (inicio>=time '08:00' and inicio<=time '12:30')
     or (inicio>=time '13:00' and inicio<=time '17:30')))
   or (dia=date '2026-12-13' and not (inicio>=time '09:00' and inicio<=time '12:30'))
   or dia not in (date '2026-12-12',date '2026-12-13'))
 into n,invalidos from public.gf_contratacao_horarios where evento_contratacao_id=e.id and ativo;
 if n<2 or invalidos>0
    or not exists(select 1 from public.gf_contratacao_horarios where evento_contratacao_id=e.id and ativo and dia=date '2026-12-12')
    or not exists(select 1 from public.gf_contratacao_horarios where evento_contratacao_id=e.id and ativo and dia=date '2026-12-13')
 then raise exception 'Revise os horários de 15 minutos de sábado e domingo antes de publicar.';end if;
 update public.gf_contratacao_eventos set status='publicado',
  publicado_em=coalesce(publicado_em,now()),atualizado_em=now()
 where id=e.id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(e.id,p_usuario,'natal_publicado_sem_checkout',jsonb_build_object('horarios_ativos',n));
 return jsonb_build_object('ok',true,'status','publicado','modo','agendamento_com_pagamento_manual');
end;$$;
revoke all on function public.gf_natal_admin_publicar(text,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_admin_publicar(text,uuid) to service_role;

-- Não oferecer novos horários após o prazo de inscrições.
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
 if (v_evento.status<>'publicado' or v_evento.vendas_encerram_em is null or v_evento.vendas_encerram_em<=now()) and not p_preview then
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
revoke all on function public.gf_natal_listar_inicios(text,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.gf_natal_listar_inicios(text,integer,uuid,boolean) to service_role;

-- Não manter bloqueios temporários novos após o prazo. Holds já válidos
-- podem terminar o preenchimento até o seu prazo de 10 minutos.
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
 if not found or v_evento.status<>'publicado' or v_evento.vendas_encerram_em is null or v_evento.vendas_encerram_em<=now() then raise exception 'A agenda ainda não foi aberta ou foi encerrada.';end if;
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
revoke all on function public.gf_natal_reservar_temporariamente(text,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.gf_natal_reservar_temporariamente(text,uuid,integer,uuid) to service_role;
