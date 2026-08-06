-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio E: proteção leve de imagem + LGPD.
-- Rodar depois de 001 a 012. Aditiva.
--
-- thumb_path: prévia (redimensionada + com marca d'água) gerada no
-- navegador no momento do upload — grids e o visualizador ampliado
-- passam a usar ela; só o clique de "baixar" busca o storage_path
-- original, sem marca d'água. Fotos enviadas antes dessa migration
-- não têm thumb_path — o app cai de volta pro storage_path original
-- nesse caso (thumb_path é opcional, nunca obrigatório).
--
-- lgpd_aceito_em: registro de aceite dos termos, pedido no primeiro
-- login de cada responsável.
-- ════════════════════════════════════════════════════════════════

alter table fotos add column if not exists thumb_path text;
alter table perfis add column if not exists lgpd_aceito_em timestamptz;

-- mesma assinatura de sempre (retorna setof text) — CREATE OR REPLACE
-- não exige mexer na policy fotos_storage_select que já depende dela.
-- Passa a incluir o thumb_path de cada foto visível, senão a prévia
-- (que mora num arquivo separado do original) ficaria 403 pra
-- escola/responsável — a policy de storage faz match exato contra
-- esse conjunto, não por prefixo de pasta.
create or replace function storage_paths_visiveis()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select storage_path from fotos where id in (select fotos_visiveis())
  union
  select thumb_path from fotos where thumb_path is not null and id in (select fotos_visiveis())
$$;

-- aceite dos termos/LGPD — grava a data, sem precisar de update direto
-- em perfis (mesmo padrão de atualizar_meu_perfil/marcar_acesso).
create or replace function aceitar_lgpd()
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set lgpd_aceito_em = now() where user_id = auth.uid()
$$;
grant execute on function aceitar_lgpd() to authenticated;
