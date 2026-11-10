-- Grand Focus: campos adicionais e cores da planilha.
-- Não altera valores financeiros, horários nem as respostas existentes.
alter table public.gf_contratacao_eventos
 add column if not exists planilha_colunas jsonb not null default '[]'::jsonb;
alter table public.gf_contratacao_form_respostas
 add column if not exists planilha_campos jsonb not null default '{}'::jsonb,
 add column if not exists planilha_cor text not null default 'sem',
 add column if not exists planilha_nota text not null default '';

create or replace function public.gf_contratacao_admin_configurar_planilha(
 p_campanha_id uuid,p_usuario_id uuid,p_colunas jsonb
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare c jsonb;cid text;nome text;cor text;seen text[]:=array[]::text[];
begin
 if not exists(select 1 from public.perfis
 where user_id=p_usuario_id and role in ('admin','super_admin')) then
 raise exception 'Apenas administradores podem configurar colunas.';end if;
 if p_colunas is null or jsonb_typeof(p_colunas)<>'array'
  or jsonb_array_length(p_colunas)>12 then
 raise exception 'A planilha aceita até 12 colunas personalizadas.';end if;
 perform 1 from public.gf_contratacao_eventos
 where id=p_campanha_id for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 for c in select value from jsonb_array_elements(p_colunas) loop
  if jsonb_typeof(c)<>'object' then raise exception 'Formato de coluna inválido.';end if;
  cid:=coalesce(c->>'id','');nome:=btrim(coalesce(c->>'titulo',''));cor:=coalesce(c->>'cor','vinho');
  if cid !~ '^col_[a-f0-9]{8,32}$' or cid=any(seen)
   or char_length(nome) not between 2 and 60
   or cor not in ('vinho','dourado','azul','verde','rosa','cinza') then
    raise exception 'Confira os nomes e cores das colunas.';end if;
  seen:=array_append(seen,cid);
 end loop;
 update public.gf_contratacao_eventos
 set planilha_colunas=p_colunas,atualizado_em=now()
 where id=p_campanha_id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(p_campanha_id,p_usuario_id,'planilha_colunas_alteradas',
 jsonb_build_object('colunas',p_colunas));
 return jsonb_build_object('ok',true,'colunas',p_colunas);
end;$$;

create or replace function public.gf_contratacao_admin_editar_resposta(
 p_campanha_id uuid,p_resposta_id uuid,p_usuario_id uuid,
 p_nome text,p_whatsapp text,p_bailarina text,p_alunos jsonb,
 p_campos jsonb,p_cor text,p_nota text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare r public.gf_contratacao_form_respostas%rowtype;
 e public.gf_contratacao_eventos%rowtype;
 aluno jsonb;campo record;novo_nome text;novo_whatsapp text;nome_aluno text;
 total integer;total_antigo integer;nomes text[]:=array[]::text[];allowed text[];
begin
 if not exists(select 1 from public.perfis where user_id=p_usuario_id
 and role in ('admin','super_admin')) then
 raise exception 'Apenas administradores podem alterar respostas.';end if;
 select * into e from public.gf_contratacao_eventos where id=p_campanha_id;
 if not found then raise exception 'Campanha não encontrada.';end if;
 select * into r from public.gf_contratacao_form_respostas
 where id=p_resposta_id and evento_contratacao_id=e.id for update;
 if not found then raise exception 'Resposta não localizada nesta campanha.';end if;
 if r.arquivado_em is not null then
 raise exception 'Restaure o registro antes de editar.';end if;
 novo_nome:=btrim(coalesce(p_nome,''));
 novo_whatsapp:=regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g');
 if char_length(novo_nome) not between 3 and 120 or length(novo_whatsapp) not between 10 and 13 then
 raise exception 'Informe nome completo e WhatsApp com DDD.';end if;
 if p_cor not in ('sem','verde','amarelo','rosa','azul','cinza')
 then raise exception 'Selecione uma cor de linha válida.';end if;
 if char_length(coalesce(p_nota,''))>3000 then
 raise exception 'A anotação deve ter no máximo 3.000 caracteres.';end if;
 if p_campos is null or jsonb_typeof(p_campos)<>'object'
  or length(p_campos::text)>8000 then raise exception 'Campos extras inválidos.';end if;
 select coalesce(array_agg(item->>'id'),'{}'::text[]) into allowed
 from jsonb_array_elements(e.planilha_colunas) item;
 for campo in select key,value from jsonb_each(p_campos) loop
   if not (campo.key=any(allowed))
     or jsonb_typeof(campo.value)<>'string'
     or char_length(trim(both '"' from campo.value::text))>700 then
       raise exception 'Uma coluna extra não está configurada ou seu texto é longo demais.';end if;
 end loop;
 if jsonb_typeof(r.alunos_inscritos)='array' then
   if jsonb_typeof(p_alunos)<>'array' then raise exception 'Alunos inválidos.';end if;
   total:=jsonb_array_length(p_alunos);
   total_antigo:=jsonb_array_length(r.alunos_inscritos);
   if total<>total_antigo or total not between 1 and 4 then
    raise exception 'A quantidade de alunos não pode ser alterada em um cadastro já recebido. Ajuste o pedido individualmente.';end if;
   for aluno in select value from jsonb_array_elements(p_alunos) loop
     nome_aluno:=btrim(coalesce(aluno->>'nome',''));
     if char_length(nome_aluno) not between 3 and 120 then
       raise exception 'Revise o nome de cada bailarino(a).';end if;
     nomes:=array_append(nomes,nome_aluno);
   end loop;
   update public.gf_contratacao_form_respostas set
    responsavel_nome=novo_nome,responsavel_whatsapp=novo_whatsapp,
    alunos_inscritos=p_alunos,
    bailarina_nome=left(array_to_string(nomes,', '),180),
    planilha_campos=p_campos,planilha_cor=p_cor,planilha_nota=p_nota,
    atualizado_em=now()
   where id=r.id;
 else
   if char_length(btrim(coalesce(p_bailarina,''))) not between 2 and 180 then
    raise exception 'Informe o nome da bailarina.';end if;
   update public.gf_contratacao_form_respostas set
    responsavel_nome=novo_nome,responsavel_whatsapp=novo_whatsapp,
    bailarina_nome=btrim(p_bailarina),
    planilha_campos=p_campos,planilha_cor=p_cor,planilha_nota=p_nota,
    atualizado_em=now()
   where id=r.id;
 end if;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(e.id,p_usuario_id,'resposta_editada_planilha',
 jsonb_build_object('resposta_id',r.id,'situacao_financeira_preservada',r.pagamento_situacao,
 'valor_original_preservado',r.valor_informado_centavos,
 'situacao_agendamento_preservada',r.agendamento_status,
 'cor_anterior',r.planilha_cor,'cor_nova',p_cor,
 'campo_extra_alterado',r.planilha_campos is distinct from p_campos));
 return jsonb_build_object('ok',true,'resposta_id',r.id);
end;$$;

revoke all on function public.gf_contratacao_admin_configurar_planilha(uuid,uuid,jsonb)
 from public,anon,authenticated;
revoke all on function public.gf_contratacao_admin_editar_resposta(
 uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text)
 from public,anon,authenticated;
grant execute on function public.gf_contratacao_admin_configurar_planilha(uuid,uuid,jsonb) to service_role;
grant execute on function public.gf_contratacao_admin_editar_resposta(
 uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text) to service_role;
