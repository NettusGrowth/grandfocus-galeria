-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 12: link curto de verdade pra Seleção
-- de Fotos (/s/nome-do-ensaio em vez de ?sel=TOKEN-FEIO). Até aqui só
-- existia um sufixo cosmético (&e=slug) que não escondia o token real.
-- Rodar depois de 001 a 044. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_galerias add column if not exists slug text unique;

-- resolve slug → token pro boot público (rota /s/:slug, ver vercel.json)
-- conseguir carregar a galeria sem precisar do token feio na URL.
-- Devolve só o token (nunca dados da galeria) — quem confere senha,
-- expiração etc. continua sendo selecao_publica_dados, chamada em
-- seguida pelo client com o token já resolvido. Mesmo padrão de
-- exposição pública controlada já usado em email_por_usuario.
create or replace function selecao_resolver_slug(p_slug text)
returns text
language sql
security definer
set search_path = public, extensions, pg_catalog
as $$
  select token from selecao_galerias where slug = p_slug;
$$;
revoke all on function selecao_resolver_slug(text) from public;
grant execute on function selecao_resolver_slug(text) to anon, authenticated;
