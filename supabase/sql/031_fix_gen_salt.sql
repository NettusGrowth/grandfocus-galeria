-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige "function gen_salt(unknown) does not
-- exist" ao definir senha de galeria de Seleção ou de link público de
-- evento/ensaio. Rodar depois de 001 a 030. Aditiva.
--
-- Causa raiz: pgcrypto foi criado sem schema explícito (001_schema.sql,
-- "create extension if not exists pgcrypto") — no Postgres gerenciado do
-- Supabase isso cai no schema "extensions", não em "public". A função
-- resetar_senha (007_contas.sql) já roda certo porque tem "extensions"
-- no search_path; definir_senha_selecao (025_selecao_fotos.sql) e
-- definir_senha_link (019_galeria_avancada.sql) foram criadas só com
-- "public", então gen_salt/crypt ficam irresolvíveis dentro delas.
--
-- Corpo das duas funções é IDÊNTICO ao original — só o search_path
-- muda (replica exatamente o padrão que já funciona em resetar_senha).
-- ════════════════════════════════════════════════════════════════

create or replace function definir_senha_selecao(p_galeria_id uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if (select role from meu_perfil()) not in ('admin','super_admin') then
    raise exception 'Sem permissão.';
  end if;
  update selecao_galerias set senha_hash = crypt(p_senha, gen_salt('bf')) where id = p_galeria_id;
end;
$$;

create or replace function definir_senha_link(p_evento_id uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare meu_role text;
begin
  select role into meu_role from perfis where user_id = auth.uid();
  if meu_role not in ('admin','super_admin') then
    raise exception 'Sem permissão.';
  end if;
  update eventos set link_senha_hash = case when p_senha is null or p_senha = '' then null else crypt(p_senha, gen_salt('bf')) end
  where id = p_evento_id;
end;
$$;
