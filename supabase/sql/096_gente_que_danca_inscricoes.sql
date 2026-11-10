-- Gente que Dança · 15/12/2026: inscrição opcional e pagamento manual.
-- Criar o registro e o pedido de interesse na mesma transação; não cria checkout,
-- não cobra, não dá acesso a fotografias e não gera horários individuais.
create or replace function public.gf_gente_solicitar_interesse(
 p_slug text,p_responsavel text,p_whatsapp text,p_alunos jsonb,
 p_preferencia text,p_idempotencia uuid,p_aceite boolean
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;
 c integer;nome_aluno text;valor integer;telefone text;resultado public.gf_contratacao_form_respostas%rowtype;
 nomes text[]:=array[]::text[];item jsonb;
begin
 if p_slug<>'gente-que-danca-2026' or p_idempotencia is null
  or p_aceite is distinct from true or
  p_preferencia not in ('pix','credito') or
  length(btrim(coalesce(p_responsavel,''))) not between 5 and 120
  or p_alunos is null or jsonb_typeof(p_alunos)<>'array'
  or jsonb_array_length(p_alunos) not between 1 and 4
 then raise exception 'Confira as informações obrigatórias.';end if;
 telefone:=regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g');
 if length(telefone) not between 10 and 13 then
  raise exception 'WhatsApp inválido. Inclua o DDD.';end if;
 c:=jsonb_array_length(p_alunos);valor:=c*15000;
 for item in select value from jsonb_array_elements(p_alunos) loop
  nome_aluno:=btrim(coalesce(item->>'nome',''));
  if length(nome_aluno) not between 3 and 120 or
    length(btrim(coalesce(item->>'turma','')))>80 then
    raise exception 'Informe o nome completo de cada aluno.';end if;
  nomes:=array_append(nomes,nome_aluno);
 end loop;
 select * into e from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found or e.status<>'publicado' or e.vendas_encerram_em is null
    or e.vendas_encerram_em<=now() then
  raise exception 'As inscrições estão fechadas no momento.';end if;
 select * into resultado from public.gf_contratacao_form_respostas
  where evento_contratacao_id=e.id
  and origem_chave='gente-2026:'||p_idempotencia::text;
 if found then
   if regexp_replace(resultado.responsavel_whatsapp,'[^0-9]','','g')<>telefone
      or resultado.valor_informado_centavos<>valor then
     raise exception 'Esta identificação de inscrição já foi utilizada.';end if;
   return jsonb_build_object('ok',true,'codigo',left(resultado.id::text,8),
     'valor_centavos',resultado.valor_informado_centavos,'reutilizado',true);
 end if;
 insert into public.gf_contratacao_form_respostas(
  evento_contratacao_id,origem_chave,origem,origem_linha,respondido_em,
  responsavel_nome,responsavel_whatsapp,bailarina_nome,
  experiencia_original,valor_informado_centavos,pagamento_preferido,
  pagamento_situacao,pagamento_declarado,alunos_inscritos,
  responsavel_confirmou,condicoes_confirmadas,observacao_origem
 )values(
  e.id,'gente-2026:'||p_idempotencia::text,'formulario_site',
  nextval('public.gf_natal_registros_seq'),now(),
  btrim(p_responsavel),telefone,left(array_to_string(nomes,', '),180),
  'Experiência fotográfica Gente que Dança · '||c||' criança(s)',
  valor,case p_preferencia when 'pix' then 'Pix' else 'Cartão de crédito (taxa conforme condições)' end,
  'pendente',null,p_alunos,true,true,
  'Inscrição opcional. Experiência em 15/12/2026, a partir das 18h. '||
  'Sem horário individual garantido, pagamento e confirmação diretamente com a Grand Focus.'
 ) returning * into resultado;
 return jsonb_build_object('ok',true,'codigo',left(resultado.id::text,8),
  'valor_centavos',valor,'reutilizado',false,
  'mensagem','Recebemos seu interesse. Nossa equipe entrará em contato para pagamento e confirmação.');
end;$$;
revoke all on function public.gf_gente_solicitar_interesse(text,text,text,jsonb,text,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.gf_gente_solicitar_interesse(text,text,text,jsonb,text,uuid,boolean)
 to service_role;
