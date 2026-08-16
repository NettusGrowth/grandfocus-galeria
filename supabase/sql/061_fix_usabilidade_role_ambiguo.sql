-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige "column reference role is ambiguous"
-- na aba Usabilidade.
--
-- Causa: usabilidade_por_usuario() declara "returns table (..., role
-- text, ...)" — o Postgres cria uma variável PL/pgSQL implícita
-- chamada "role" pra essa coluna de saída. Lá dentro, "(select role
-- from meu_perfil())" ficava ambíguo: podia ser essa variável OU a
-- coluna role que meu_perfil() também devolve. Faltou qualificar com
-- alias, igual já é feito em outras funções do projeto que evitam
-- exatamente esse tipo de colisão. Rodar depois de 001 a 060.
-- Aditiva (substitui só essa função).
-- ════════════════════════════════════════════════════════════════

create or replace function usabilidade_por_usuario()
returns table (
  user_id uuid, nome text, role text, escola_id uuid,
  ultimo_acesso timestamptz, qtd_acessos integer, qtd_downloads bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if (select mp.role from meu_perfil() mp) not in ('admin', 'super_admin') then
    raise exception 'Sem permissão.';
  end if;
  return query
    select p.user_id, p.nome, p.role, p.escola_id, p.ultimo_acesso, p.qtd_acessos,
      coalesce(d.qtd, 0)
    from perfis p
    left join (
      select a.user_id, count(*) as qtd from auditoria a
      where a.acao ilike '%baixou%' and a.user_id is not null
      group by a.user_id
    ) d on d.user_id = p.user_id
    order by p.ultimo_acesso desc nulls last;
end;
$$;
grant execute on function usabilidade_por_usuario() to authenticated;
