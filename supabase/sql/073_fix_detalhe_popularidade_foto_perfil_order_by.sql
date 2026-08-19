-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — fix: modal "Métricas da Foto" (Quem Viu/Quem
-- Baixou) quebrado com "ERROR: invalid UNION/INTERSECT/EXCEPT ORDER
-- BY clause". Rodar depois de 001 a 072. Aditiva (só substitui a
-- function).
--
-- Causa: em 072, ao reescrever detalhe_popularidade_foto() pra
-- acrescentar a coluna perfil, a function foi reconstruída em cima da
-- versão de 063 (a partir da qual eu peguei o corpo) — só que 063
-- tinha exatamente esse bug, JÁ corrigido depois em 066: count(*) e
-- max(...) nos dois branches do UNION ALL nunca foram apelidados
-- (aliased), e "qtd" só existe formalmente na assinatura RETURNS
-- TABLE (a ligação com esse nome só acontece depois, no "return
-- query" posicional) — um ORDER BY em cima de UNION ALL só pode
-- referenciar coluna de saída do próprio SELECT combinado. 072
-- reintroduziu o bug que 066 já tinha corrigido, por partir da versão
-- errada.
--
-- Fix: mesmo de 066 (count(*) as qtd, max(...) as ultima_em nos dois
-- branches), agora com a coluna perfil (de 072) mantida.
-- ════════════════════════════════════════════════════════════════

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
    select v.user_id, coalesce(p.nome, 'Anônimo')::text, p.role::text, 'visualizacao'::text, count(*) as qtd, max(v.visualizado_em) as ultima_em
    from foto_visualizacoes v
    left join perfis p on p.user_id = v.user_id
    where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)
    group by v.user_id, p.nome, p.role
    union all
    select a.user_id, coalesce(p.nome, a.user_nome, 'Anônimo')::text, p.role::text, 'download'::text, count(*) as qtd, max(a.criado_em) as ultima_em
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
