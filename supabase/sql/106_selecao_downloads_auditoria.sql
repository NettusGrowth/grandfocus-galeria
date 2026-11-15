-- Galeria Grand Focus — observabilidade da entrega de Seleção de Fotos.
-- Aditivo: nenhum registro de auditoria existente é alterado.
--
-- Ação registrada: 'iniciou download de seleção' (uma linha por comando,
-- nunca por acesso à página e nunca ao gerar links assinados).
-- detalhe: '<N> fotos; tipo=fotos|bastidores; origem=individual|lote|ios'.
-- Contabiliza INÍCIO do download; o navegador/iOS não confirmam escrita
-- efetiva no disco/câmera. Sem login, não deduz pessoas únicas.
--
-- Índice parcial: somente os eventos da seleção, sem afetar o ranking
-- de downloads da galeria autenticada.
create index if not exists idx_auditoria_selecao_download_criado
  on public.auditoria (criado_em desc, registro_id)
  where tabela='selecao_galerias' and acao='iniciou download de seleção';

create or replace function public.gf_selecao_downloads_metricas(
  p_inicio timestamptz default null,
  p_fim timestamptz default null,
  p_galeria_id uuid default null
)
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.meu_perfil() p
    where p.role in ('admin','super_admin')
  ) then
    raise exception 'Sem permissão para consultar downloads de seleção.' using errcode='42501';
  end if;
  if p_inicio is not null and p_fim is not null and p_inicio >= p_fim then
    raise exception 'Intervalo inválido.' using errcode='22023';
  end if;

  with eventos as materialized (
    select a.registro_id, a.criado_em, a.user_nome,
      case
        when a.detalhe ~ '^[1-9][0-9]{0,4} fotos?'
        then (substring(a.detalhe from '^([0-9]{1,5})'))::integer
        else 0
      end as quantidade,
      coalesce((regexp_match(a.detalhe, 'tipo=([a-z_]+)'))[1], 'fotos') as tipo,
      coalesce((regexp_match(a.detalhe, 'origem=([a-z_]+)'))[1], 'individual') as origem
    from public.auditoria a
    where a.tabela='selecao_galerias'
      and a.acao='iniciou download de seleção'
      and (p_inicio is null or a.criado_em >= p_inicio)
      and (p_fim is null or a.criado_em < p_fim)
      and (p_galeria_id is null or a.registro_id=p_galeria_id)
  )
  select jsonb_build_object(
    'acoes', (select count(*) from eventos),
    'fotos', (select coalesce(sum(quantidade),0) from eventos),
    'galerias', (select count(distinct registro_id) from eventos),
    'ultimo_em', (select max(criado_em) from eventos),
    'recentes', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.criado_em desc)
      from (
        select registro_id, criado_em, user_nome, quantidade, tipo, origem
        from eventos order by criado_em desc limit 8
      ) r
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$fn$;

revoke all on function public.gf_selecao_downloads_metricas(timestamptz,timestamptz,uuid)
  from public, anon;
grant execute on function public.gf_selecao_downloads_metricas(timestamptz,timestamptz,uuid)
  to authenticated;
comment on function public.gf_selecao_downloads_metricas(timestamptz,timestamptz,uuid) is
  'Somente equipe admin: cliques de download das galerias de seleção; não soma em logins ou downloads autenticados. Preserve toda a auditoria anterior.';
