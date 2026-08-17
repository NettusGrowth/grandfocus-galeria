-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige "column reference capa_url is
-- ambiguous" em galeria_publica_dados(), que quebrava TODO link
-- público de evento/ensaio (?g=TOKEN), sempre, sem exceção — mesmo
-- com token e dados corretos no banco.
--
-- Causa: idêntica à do 061 (usabilidade_por_usuario) — a função
-- declara "capa_url text" como uma das colunas de RETURNS TABLE, o
-- que cria uma variável PL/pgSQL implícita com esse nome. A query
-- "select id, nome, data, capa_url, link_senha_hash into v_evento
-- from eventos where ..." referenciava capa_url sem qualificar —
-- podia ser a coluna da tabela OU essa variável implícita, e o
-- Postgres nunca decide sozinho, sempre erra. A Edge Function
-- (galeria-publica) mascarava esse erro como "Link inválido ou
-- expirado.", por isso parecia problema de token — confirmado ao
-- vivo rodando a função direto no SQL Editor: token e dados batendo
-- certinho, mesmo assim o erro.
--
-- Fix: qualifica a origem (alias "e." na tabela eventos), mesmo
-- padrão já usado em 061. Rodar depois de 001 a 063. Aditiva.
-- ════════════════════════════════════════════════════════════════

create or replace function galeria_publica_dados(p_token text, p_senha text default null)
returns table (
  evento_id uuid, evento_nome text, evento_data date, capa_url text,
  foto_id uuid, storage_path text, thumb_path text
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_evento record;
begin
  select e.id, e.nome, e.data, e.capa_url, e.link_senha_hash into v_evento
  from eventos e where e.link_token = p_token;

  if v_evento.id is null then
    raise exception 'Link inválido ou expirado.';
  end if;
  if v_evento.link_senha_hash is not null and (p_senha is null or crypt(p_senha, v_evento.link_senha_hash) <> v_evento.link_senha_hash) then
    raise exception 'Senha incorreta.';
  end if;

  return query
    select v_evento.id, v_evento.nome, v_evento.data, v_evento.capa_url,
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
