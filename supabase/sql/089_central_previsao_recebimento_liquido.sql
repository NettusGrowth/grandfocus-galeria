-- 089: Estimativa de recebimento líquido por campanha.
-- Nunca modifica o valor da venda nem pagamentos, devoluções ou status.
-- Taxa inicial: 4,20% crédito à vista, Link de Pagamento 1 dia útil
-- (referência pública InfinitePay, 09/11/2026), AJUSTÁVEL pelo administrador.
alter table public.gf_contratacao_eventos
  add column if not exists taxa_credito_a_vista_bps integer not null default 420;
alter table public.gf_contratacao_eventos
  add constraint gf_credito_taxa_intervalo_check
  check (taxa_credito_a_vista_bps between 0 and 2000);

create or replace function public.gf_contratacao_admin_salvar_taxa_liquida(
 p_slug text,p_taxa_bps integer,p_usuario_id uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 v_evento public.gf_contratacao_eventos%rowtype;
begin
 if p_usuario_id is null or not exists (
   select 1 from public.perfis
    where user_id=p_usuario_id and role in ('admin','super_admin')
 ) then raise exception 'Apenas administradores podem configurar taxas.';end if;
 if p_taxa_bps is null or p_taxa_bps not between 0 and 2000 then
   raise exception 'A taxa deve estar entre 0 e 20 por cento.';end if;
 select * into v_evento from public.gf_contratacao_eventos
 where slug=p_slug for update;
 if not found then raise exception 'Campanha não encontrada.';end if;
 if v_evento.taxa_credito_a_vista_bps=p_taxa_bps then
   return jsonb_build_object('ok',true,'taxa_bps',p_taxa_bps,'sem_alteracao',true);
 end if;
 update public.gf_contratacao_eventos
 set taxa_credito_a_vista_bps=p_taxa_bps, atualizado_em=now()
 where id=v_evento.id;
 insert into public.gf_contratacao_auditoria(evento_contratacao_id,usuario_id,acao,detalhes)
 values(v_evento.id,p_usuario_id,'taxa_credito_referencia_alterada',
   jsonb_build_object('anterior_bps',v_evento.taxa_credito_a_vista_bps,
    'nova_bps',p_taxa_bps,'tipo','estimativa_credito_a_vista'));
 return jsonb_build_object('ok',true,'taxa_bps',p_taxa_bps);
end;
$$;
revoke all on function public.gf_contratacao_admin_salvar_taxa_liquida(text,integer,uuid)
 from public,anon,authenticated;
grant execute on function public.gf_contratacao_admin_salvar_taxa_liquida(text,integer,uuid)
 to service_role;
