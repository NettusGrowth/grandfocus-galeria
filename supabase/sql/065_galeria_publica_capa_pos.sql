-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — galeria_publica_dados() nunca devolvia
-- eventos.capa_pos (a posição de enquadramento que o admin ajusta no
-- "arrastar pra reposicionar" da capa) -- por isso o link público
-- SEMPRE mostrava a capa com corte central padrão, mesmo quando o
-- admin já tinha ajustado o enquadramento certo no painel. "Ajusto lá
-- e fica bom, mas no site fica desalinhado" — era exatamente isso.
--
-- Precisa dropar antes (não é só "or replace"): adicionar uma coluna
-- no RETURNS TABLE muda o tipo de retorno da função, e o Postgres não
-- deixa create-or-replace fazer isso sozinho (mesmo motivo do fix em
-- 063/fotos_mais_populares). Rodar depois de 001 a 064. Aditiva.
-- ════════════════════════════════════════════════════════════════

drop function if exists galeria_publica_dados(text, text);

create or replace function galeria_publica_dados(p_token text, p_senha text default null)
returns table (
  evento_id uuid, evento_nome text, evento_data date, capa_url text, capa_pos text,
  foto_id uuid, storage_path text, thumb_path text
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_evento record;
begin
  select e.id, e.nome, e.data, e.capa_url, e.capa_pos, e.link_senha_hash into v_evento
  from eventos e where e.link_token = p_token;

  if v_evento.id is null then
    raise exception 'Link inválido ou expirado.';
  end if;
  if v_evento.link_senha_hash is not null and (p_senha is null or crypt(p_senha, v_evento.link_senha_hash) <> v_evento.link_senha_hash) then
    raise exception 'Senha incorreta.';
  end if;

  return query
    select v_evento.id, v_evento.nome, v_evento.data, v_evento.capa_url, v_evento.capa_pos,
           f.id, f.storage_path, f.thumb_path
    from eventos e
    left join fotos f on f.evento_id = e.id
    where e.id = v_evento.id
    order by f.criado_em;
end;
$$;
-- sem grant de propósito (igual à versão original, 019) — só quem tem
-- a service role key (a Edge Function galeria-publica) chama essa
-- função; ninguém consegue direto pelo anon key do app.
