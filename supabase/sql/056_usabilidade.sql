-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — usabilidade: quantidade de acessos + downloads
-- por usuário, pra todo mundo (qualquer papel), visível só pro admin.
--
-- "Último acesso" (ultimo_acesso, marcar_acesso()) já existia desde
-- 007_contas.sql e já era usado em várias listas. Faltava a
-- CONTAGEM de acessos (só tinha o timestamp mais recente) e um jeito
-- de ver os downloads agregados por pessoa (auditoria já registra
-- cada download individual, mas só dá pra ver um por um na aba
-- Auditoria — sem soma por usuário).
--
-- Cuidado de performance pedido explicitamente: marcar_acesso() já é
-- chamada uma vez só por login (mostrarApp -> marcarAcesso(), best-
-- effort, não bloqueia nada) — só incrementar mais uma coluna no
-- mesmo UPDATE que já existia não adiciona nenhuma escrita nova nem
-- deixa nada mais lento. A contagem de downloads é agregada DENTRO do
-- Postgres (group by), não baixa a auditoria inteira pro navegador —
-- mesmo com milhares de linhas de auditoria, o cliente só recebe uma
-- linha por usuário. Rodar depois de 001 a 055. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table perfis add column if not exists qtd_acessos integer not null default 0;

create or replace function marcar_acesso()
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set ultimo_acesso = now(), qtd_acessos = qtd_acessos + 1 where user_id = auth.uid()
$$;
grant execute on function marcar_acesso() to authenticated;

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
  if (select role from meu_perfil()) not in ('admin', 'super_admin') then
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
