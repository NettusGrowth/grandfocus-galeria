-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 4: categoria de evento/ensaio, subpasta
-- (Atos) dentro de um evento, e a base pro link público (token+senha
-- opcional) — a geração de URL assinada de verdade fica na Edge
-- Function `galeria-publica` (ver supabase/functions/), porque SQL
-- puro não consegue assinar URL de Storage; aqui só fica o dado e a
-- validação de acesso. Rodar depois de 001 a 018. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table eventos add column if not exists categoria text;
alter table fotos add column if not exists subpasta text;

-- ── link público (token longo = já é proteção; senha vira opcional) ──
alter table eventos add column if not exists link_token text unique;
alter table eventos add column if not exists link_senha_hash text;
alter table eventos add column if not exists link_criado_em timestamptz;

-- RPC só pra quem tem a service role key (Edge Function) — não é
-- concedida a anon/authenticated de propósito: ninguém consegue chamar
-- direto pelo anon key do app, só o backend da Edge Function, que é
-- quem de fato assina as URLs depois de validar o token/senha aqui.
create or replace function galeria_publica_dados(p_token text, p_senha text default null)
returns table (
  evento_id uuid, evento_nome text, evento_data date, capa_url text,
  foto_id uuid, storage_path text, thumb_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento record;
begin
  select id, nome, data, capa_url, link_senha_hash into v_evento
  from eventos where link_token = p_token;

  if v_evento.id is null then
    raise exception 'Link inválido ou expirado.';
  end if;
  if v_evento.link_senha_hash is not null and (p_senha is null or crypt(p_senha, v_evento.link_senha_hash) <> v_evento.link_senha_hash) then
    raise exception 'Senha incorreta.';
  end if;

  -- left join de propósito: um evento com link mas AINDA sem foto
  -- nenhuma tem que continuar retornando (nome/capa), só sem linhas de
  -- foto — senão o link pareceria "inválido" pra quem abre cedo demais.
  return query
    select v_evento.id, v_evento.nome, v_evento.data, v_evento.capa_url,
           f.id, f.storage_path, f.thumb_path
    from eventos e
    left join fotos f on f.evento_id = e.id
    where e.id = v_evento.id
    order by f.criado_em;
end;
$$;
-- de propósito SEM grant pra anon/authenticated — só service role chama.

-- gerar/revogar o token fica no client (admin), com update normal em
-- `eventos` (já coberto pelas policies de admin existentes). A senha,
-- quando definida, é hasheada no client via RPC abaixo (mesmo padrão
-- de resetar_senha — nunca guarda a senha em texto puro).
create or replace function definir_senha_link(p_evento_id uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public
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
grant execute on function definir_senha_link(uuid, text) to authenticated;
