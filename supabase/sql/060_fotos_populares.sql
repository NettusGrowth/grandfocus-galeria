-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — "Fotos mais populares" no Dashboard (admin,
-- só desktop): quais fotos são mais vistas (abertas no lightbox) e
-- mais baixadas, pra dar visibilidade real de engajamento pro admin.
--
-- Downloads: já dava pra calcular com o que já existia — o download
-- individual pelo lightbox (_lightboxBaixar) já registra em auditoria
-- com registro_id = id da foto certa (tabela='fotos', ver index.html).
-- Download em massa (zip/selecionadas) não tem esse detalhe por foto
-- — fica de fora da contagem, o que é correto (não dá pra saber QUAL
-- foto de um lote de 50 a pessoa realmente queria).
--
-- Visualizações: não existia nada — nova coluna + RPC de incremento,
-- chamada (best-effort, não bloqueia nada) toda vez que alguém abre
-- uma foto no lightbox de verdade — mesmo padrão de marcar_acesso()
-- (007_contas.sql): um UPDATE simples, sem tabela de log nova, sem
-- escrita cara.
--
-- Rodar depois de 001 a 059. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table fotos add column if not exists qtd_visualizacoes integer not null default 0;

create or replace function marcar_visualizacao_foto(p_foto_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update fotos set qtd_visualizacoes = qtd_visualizacoes + 1 where id = p_foto_id
$$;
grant execute on function marcar_visualizacao_foto(uuid) to authenticated;

-- devolve um POOL de candidatas (não só o top 8 fixo) pra o Dashboard
-- poder alternar "mais baixadas" / "mais vistas" sem precisar de uma
-- segunda chamada ao banco — o filtro final é client-side.
create or replace function fotos_mais_populares(p_limite int default 40)
returns table (
  foto_id uuid, storage_path text, thumb_path text, evento_id uuid, evento_nome text,
  qtd_visualizacoes integer, qtd_downloads bigint
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
    select f.id, f.storage_path, f.thumb_path, f.evento_id, e.nome,
      f.qtd_visualizacoes, coalesce(d.qtd, 0)
    from fotos f
    join eventos e on e.id = f.evento_id
    left join (
      select a.registro_id as foto_id, count(*) as qtd
      from auditoria a
      where a.tabela = 'fotos' and a.registro_id is not null and a.acao ilike '%baixou foto%'
      group by a.registro_id
    ) d on d.foto_id = f.id
    where f.qtd_visualizacoes > 0 or d.qtd > 0
    order by (coalesce(d.qtd, 0) + f.qtd_visualizacoes) desc, f.criado_em desc
    limit p_limite;
end;
$$;
grant execute on function fotos_mais_populares(int) to authenticated;
