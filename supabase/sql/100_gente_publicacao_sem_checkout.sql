-- Publicação controlada da campanha Gente que Dança, SEM checkout real.
create or replace function public.gf_gente_admin_publicar(p_slug text,p_usuario uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare e public.gf_contratacao_eventos%rowtype;
begin
 if p_slug<>'gente-que-danca-2026' or p_usuario is null or
 not exists(select 1 from public.perfis where user_id=p_usuario
  and role in ('admin','super_admin')) then
  raise exception 'Somente administradores podem publicar esta experiência.';end if;
 select * into e from public.gf_contratacao_eventos where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if e.status='encerrado' or e.oculto_em is not null
 then raise exception 'Campanha encerrada/arquivada não pode ser publicada.';end if;
 if e.escola_id is null or e.evento_id is null or
    e.data_evento<>date '2026-12-15' or
    nullif(btrim(e.local),'') is null then
  raise exception 'Confira a escola, data e local.';end if;
 if e.vendas_encerram_em is null or e.vendas_encerram_em<=now()
    or e.vendas_encerram_em>make_timestamptz(2026,12,15,18,0,0,'America/Sao_Paulo')
 then raise exception 'A data-limite de inscrições deve ser até 15/12 às 18h.';end if;
 if length(coalesce(e.termos_conteudo,''))<1000 or
    nullif(btrim(e.termos_versao),'') is null or
    length(coalesce(e.privacidade_conteudo,''))<500 or
    coalesce(e.privacidade_url,'')!~'^https://' or
    nullif(btrim(e.fornecedor_nome),'') is null or
    length(regexp_replace(coalesce(e.fornecedor_documento,''),'[^0-9]','','g')) not between 11 and 14
 then raise exception 'Complete os termos, privacidade e dados do fornecedor.';end if;
 if (select count(*) from public.gf_contratacao_pacotes
   where evento_contratacao_id=e.id and ativo and preco_centavos=15000)<>1 then
  raise exception 'Deve haver um pacote ativo de R$ 150 por criança.';end if;
 update public.gf_contratacao_eventos
  set status='publicado',publicado_em=coalesce(publicado_em,now()),atualizado_em=now()
 where id=e.id;
 insert into public.gf_contratacao_auditoria(
   evento_contratacao_id,usuario_id,acao,detalhes)
 values(e.id,p_usuario,'gente_publicado_sem_checkout',
   jsonb_build_object('valor_por_crianca',15000,'inicia_as_18h',true));
 return jsonb_build_object('ok',true,'status','publicado','checkout_automatico',false);
end;$$;
revoke all on function public.gf_gente_admin_publicar(text,uuid) from public,anon,authenticated;
grant execute on function public.gf_gente_admin_publicar(text,uuid) to service_role;
