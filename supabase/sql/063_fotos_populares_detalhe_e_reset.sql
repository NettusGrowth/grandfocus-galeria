-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — "Fotos mais populares": log de visualização
-- por pessoa + botão de zerar a contagem. Rodar depois de 001 a 062.
-- Aditiva.
--
-- Antes, qtd_visualizacoes era só um contador solto (coluna
-- fotos.qtd_visualizacoes incrementada) — dava pra saber QUANTAS
-- vezes, mas nunca QUEM. Vira um log de eventos de verdade
-- (foto_visualizacoes: 1 linha por visualização, com o user_id de
-- quem viu), igual já é feito pra download via a tabela auditoria —
-- agora dá pra responder "quem viu essa foto e quantas vezes" pras
-- duas métricas, não só uma.
--
-- "Zerar contagem": em vez de apagar o log (perderia o histórico
-- real de quem fez o quê, que a Auditoria geral do admin ainda usa),
-- grava um "a partir de quando" em app_config
-- (fotos_populares_zerado_em) — fotos_mais_populares() e
-- detalhe_popularidade_foto() só contam visualização/download DEPOIS
-- desse instante. É reversível de fato: os dados antigos continuam
-- lá, só saem do ranking.
--
-- De quebra, fecha uma inconsistência: download já contava clique do
-- próprio admin/super_admin testando a galeria (visualização nunca
-- contava — ver 060), o que inflava o ranking com teste interno.
-- Agora os dois excluem admin/super_admin do mesmo jeito.
-- ════════════════════════════════════════════════════════════════

create table if not exists foto_visualizacoes (
  id uuid primary key default gen_random_uuid(),
  foto_id uuid not null references fotos(id) on delete cascade,
  user_id uuid references perfis(user_id) on delete set null,
  visualizado_em timestamptz not null default now()
);
create index if not exists idx_foto_visualizacoes_foto on foto_visualizacoes(foto_id);
alter table foto_visualizacoes enable row level security;
-- só leitura por admin/super_admin (é estatística interna, não sai
-- pra tela de nenhum outro papel) — escrita só via
-- marcar_visualizacao_foto() abaixo (security definer, roda como
-- dono da tabela; não precisa de policy de insert pra isso, e de
-- propósito NÃO tem uma, pra ninguém conseguir inserir linha "de
-- visualização" direto via API sem passar pela função).
create policy foto_visualizacoes_admin_select on foto_visualizacoes for select to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
grant select on foto_visualizacoes to authenticated;

create or replace function marcar_visualizacao_foto(p_foto_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into foto_visualizacoes (foto_id, user_id) values (p_foto_id, auth.uid())
$$;
grant execute on function marcar_visualizacao_foto(uuid) to authenticated;

create or replace function zerar_fotos_populares()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select mp.role from meu_perfil() mp) not in ('admin', 'super_admin') then
    raise exception 'Sem permissão.';
  end if;
  insert into app_config (chave, valor, atualizado_por)
    values ('fotos_populares_zerado_em', now()::text, auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
end;
$$;
grant execute on function zerar_fotos_populares() to authenticated;

-- qtd_visualizacoes muda de integer (060) pra bigint (count() devolve
-- bigint) -- Postgres não deixa "create or replace" trocar o tipo de
-- uma coluna do RETURNS TABLE, precisa dropar a versão antiga antes.
drop function if exists fotos_mais_populares(int);
create or replace function fotos_mais_populares(p_limite int default 40)
returns table (
  foto_id uuid, storage_path text, thumb_path text, evento_id uuid, evento_nome text,
  qtd_visualizacoes bigint, qtd_downloads bigint
)
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
    with views as (
      select v.foto_id, count(*) as qtd
      from foto_visualizacoes v
      where v_baseline is null or v.visualizado_em > v_baseline
      group by v.foto_id
    ),
    downloads as (
      select a.registro_id as foto_id, count(*) as qtd
      from auditoria a
      where a.tabela = 'fotos' and a.registro_id is not null and a.acao ilike '%baixou foto%'
        and (v_baseline is null or a.criado_em > v_baseline)
        and (a.user_id is null or not exists (
          select 1 from perfis p where p.user_id = a.user_id and p.role in ('admin','super_admin')
        ))
      group by a.registro_id
    )
    select f.id, f.storage_path, f.thumb_path, f.evento_id, e.nome,
      coalesce(v.qtd, 0), coalesce(d.qtd, 0)
    from fotos f
    join eventos e on e.id = f.evento_id
    left join views v on v.foto_id = f.id
    left join downloads d on d.foto_id = f.id
    where coalesce(v.qtd, 0) > 0 or coalesce(d.qtd, 0) > 0
    order by (coalesce(d.qtd, 0) + coalesce(v.qtd, 0)) desc, f.criado_em desc
    limit p_limite;
end;
$$;
grant execute on function fotos_mais_populares(int) to authenticated;

-- "quem viu essa foto e quantas vezes" — mesmo respeito ao baseline
-- de zerar_fotos_populares() e à mesma exclusão de admin/super_admin.
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
    select v.user_id, coalesce(p.nome, 'Anônimo')::text, 'visualizacao'::text, count(*), max(v.visualizado_em)
    from foto_visualizacoes v
    left join perfis p on p.user_id = v.user_id
    where v.foto_id = p_foto_id and (v_baseline is null or v.visualizado_em > v_baseline)
    group by v.user_id, p.nome
    union all
    select a.user_id, coalesce(p.nome, a.user_nome, 'Anônimo')::text, 'download'::text, count(*), max(a.criado_em)
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
