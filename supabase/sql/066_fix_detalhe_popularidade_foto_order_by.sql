-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — fix: modal "Quem viu essa foto" quebrado com
-- "ERROR: invalid UNION/INTERSECT/EXCEPT ORDER BY clause". Rodar
-- depois de 001 a 065. Aditiva (só substitui a function).
--
-- Causa: em 063, detalhe_popularidade_foto() faz um UNION ALL de dois
-- SELECTs e termina com "order by qtd desc". Mas count(*) e max(...)
-- nos dois branches nunca foram apelidados (aliased) — o nome "qtd"
-- só existe formalmente na assinatura RETURNS TABLE, e essa ligação
-- só acontece depois, no "return query" posicional. No Postgres, um
-- ORDER BY em cima de um UNION ALL só pode referenciar um nome que já
-- é coluna de saída do próprio SELECT combinado — como "qtd" nunca
-- existiu ali dentro, o Postgres rejeita a query inteira.
--
-- Fix: apelidar count(*) as qtd e max(...) as ultima_em nos dois
-- branches do UNION ALL, igual já é feito em fotos_mais_populares()
-- (060/063, "count(*) as qtd") — o mesmo padrão que já funciona lá.
-- ════════════════════════════════════════════════════════════════

create or replace function detalhe_popularidade_foto(p_foto_id uuid)
returns table (user_id uuid, nome text, tipo text, qtd bigint, ultima_em timestamptz)
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
    select v.user_id, coalesce(p.nome, 'Anônimo')::text, 'visualizacao'::text, count(*) as qtd, max(v.visualizado_em) as ultima_em
    from foto_visualizacoes v
    left join perfis p on p.user_id = v.user_id
    where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)
    group by v.user_id, p.nome
    union all
    select a.user_id, coalesce(p.nome, a.user_nome, 'Anônimo')::text, 'download'::text, count(*) as qtd, max(a.criado_em) as ultima_em
    from auditoria a
    left join perfis p on p.user_id = a.user_id
    where a.tabela = 'fotos' and a.registro_id = p_foto_id and a.acao ilike '%baixou foto%'
      and (v_baseline is null or a.criado_em > v_baseline)
      and (a.user_id is null or not exists (
        select 1 from perfis pp where pp.user_id = a.user_id and pp.role in ('admin','super_admin')
      ))
    group by a.user_id, p.nome, a.user_nome
    order by qtd desc;
end;
$$;
grant execute on function detalhe_popularidade_foto(uuid) to authenticated;
