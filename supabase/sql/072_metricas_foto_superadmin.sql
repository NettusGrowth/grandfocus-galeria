-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — "Métricas da Foto" (SuperAdmin): resumo com
-- pessoas ÚNICAS (COUNT DISTINCT) além do total, e perfil de quem
-- viu/baixou na lista detalhada. Rodar depois de 001 a 071. Aditiva.
--
-- Não cria tabela nova nem endpoint novo: reaproveita o log que já
-- existe (foto_visualizacoes, 063) e a auditoria de downloads que já
-- existe (auditoria, 007) — o mesmo par de fontes que
-- fotos_mais_populares/detalhe_popularidade_foto já usam. O ajuste de
-- verdade pro bug de "download em lote não contava" é só no
-- front-end (index.html): agora _baixarFotosPrivadoNativo grava UMA
-- linha de auditoria por foto de CADA download privado, sozinho ou em
-- lote (zip/seleção múltipla/micro-lotes iOS) — antes só o download
-- individual pelo lightbox registrava. Como o filtro aqui já é
-- `acao ilike '%baixou foto%'`, nenhuma query precisa mudar por causa
-- disso — só passa a enxergar linhas que antes nunca existiam.
-- ════════════════════════════════════════════════════════════════

-- resumo com pessoas ÚNICAS — a popularidade existente
-- (fotos_mais_populares) só tinha o total. Regra nova e estrita:
-- só super_admin (não admin comum) — só vale pro painel novo
-- "Métricas da Foto"; o Dashboard de populares existente continua com
-- o gate antigo (admin+super_admin), sem mudar, pra não regredir
-- quem já usava.
create or replace function foto_metricas_resumo(p_foto_id uuid)
returns table (
  total_visualizacoes bigint, pessoas_unicas_visualizacoes bigint,
  total_downloads bigint, pessoas_unicas_downloads bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_baseline timestamptz;
begin
  if (select role from meu_perfil()) <> 'super_admin' then
    raise exception 'Sem permissão.';
  end if;
  select valor::timestamptz into v_baseline from app_config where chave = 'fotos_populares_zerado_em';
  return query
    select
      (select count(*) from foto_visualizacoes v
        where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)),
      (select count(distinct v.user_id) from foto_visualizacoes v
        where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)),
      (select count(*) from auditoria a
        where a.tabela = 'fotos' and a.registro_id = p_foto_id and a.acao ilike '%baixou foto%'
          and (v_baseline is null or a.criado_em > v_baseline)
          and (a.user_id is null or not exists (
            select 1 from perfis pp where pp.user_id = a.user_id and pp.role in ('admin','super_admin')
          ))),
      (select count(distinct a.user_id) from auditoria a
        where a.tabela = 'fotos' and a.registro_id = p_foto_id and a.acao ilike '%baixou foto%'
          and (v_baseline is null or a.criado_em > v_baseline)
          and (a.user_id is null or not exists (
            select 1 from perfis pp where pp.user_id = a.user_id and pp.role in ('admin','super_admin')
          )));
end;
$$;
grant execute on function foto_metricas_resumo(uuid) to authenticated;

-- detalhe_popularidade_foto ganha o perfil (role) de quem viu/baixou
-- — faltava só isso pro pedido de listar "Nome, Perfil, Data/Hora,
-- Quantidade". Gate inalterado (admin+super_admin) — é o mesmo RPC já
-- usado pelo botão existente no Dashboard ("Fotos mais populares" →
-- olho de "quem viu/baixou"); apertar o gate aqui quebraria esse
-- botão pra admin comum sem necessidade.
drop function if exists detalhe_popularidade_foto(uuid);
create or replace function detalhe_popularidade_foto(p_foto_id uuid)
returns table (user_id uuid, nome text, perfil text, tipo text, qtd bigint, ultima_em timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_baseline timestamptz;
begin
  if (select mp.role from meu_perfil() mp) not in ('admin', 'super_admin') then
    raise exception 'Sem permissão.';
  end if;
  select valor::timestamptz into v_baseline from app_config where chave = 'fotos_populares_zerado_em';
  return query
    select v.user_id, coalesce(p.nome, 'Anônimo')::text, p.role::text, 'visualizacao'::text, count(*), max(v.visualizado_em)
    from foto_visualizacoes v
    left join perfis p on p.user_id = v.user_id
    where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)
    group by v.user_id, p.nome, p.role
    union all
    select a.user_id, coalesce(p.nome, a.user_nome, 'Anônimo')::text, p.role::text, 'download'::text, count(*), max(a.criado_em)
    from auditoria a
    left join perfis p on p.user_id = a.user_id
    where a.tabela = 'fotos' and a.registro_id = p_foto_id and a.acao ilike '%baixou foto%'
      and (v_baseline is null or a.criado_em > v_baseline)
      and (a.user_id is null or not exists (
        select 1 from perfis pp where pp.user_id = a.user_id and pp.role in ('admin','super_admin')
      ))
    group by a.user_id, p.nome, a.user_nome, p.role
    order by qtd desc;
end;
$$;
grant execute on function detalhe_popularidade_foto(uuid) to authenticated;
