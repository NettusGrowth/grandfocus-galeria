-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — liga o Supabase Realtime nas tabelas que o
-- painel passa a assinar (Comunidade, fotos/marcação, eventos). Sem
-- isso o `.channel(...).on('postgres_changes', ...)` do index.html
-- nunca recebe nada — a tabela precisa estar na publicação
-- "supabase_realtime" pro Postgres começar a replicar as mudanças.
-- Rodar depois de 001 a 031. Aditiva/idempotente (pode rodar de novo
-- sem erro se algo já estiver adicionado).
-- ════════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  foreach t in array array['posts','post_reacoes','post_comentarios','post_midias','fotos','foto_aluno','foto_pessoa','eventos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
