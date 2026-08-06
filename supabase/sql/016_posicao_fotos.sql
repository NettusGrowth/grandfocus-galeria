-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — permite reposicionar (arrastar) foto de
-- perfil/capa em vez de ficar preso no enquadramento automático
-- (object-fit:cover sempre centralizado). Guarda a posição como
-- string "X% Y%", igual a sintaxe de object-position do CSS — o app
-- aplica direto, sem precisar traduzir nada. Null = usa o padrão
-- (50% 25%, um pouco pra cima, definido no CSS).
-- Rodar depois de 001 a 015. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table perfis add column if not exists foto_pos text;
alter table perfis add column if not exists capa_pos text;
alter table escolas add column if not exists capa_pos text;
alter table alunos add column if not exists foto_pos text;
alter table eventos add column if not exists capa_pos text;

-- atualizar_meu_perfil ganha 2 parâmetros novos (com default, então
-- nada quebra) — precisa dropar a assinatura antiga primeiro porque
-- adicionar parâmetro não é "replace" de verdade em Postgres, criaria
-- uma segunda função com o mesmo nome em vez de substituir.
drop function if exists atualizar_meu_perfil(text, text, text);
create or replace function atualizar_meu_perfil(
  novo_nome text, nova_foto_url text, nova_capa_url text,
  nova_foto_pos text default null, nova_capa_pos text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set
    nome = coalesce(novo_nome, nome),
    foto_url = coalesce(nova_foto_url, foto_url),
    capa_url = coalesce(nova_capa_url, capa_url),
    foto_pos = coalesce(nova_foto_pos, foto_pos),
    capa_pos = coalesce(nova_capa_pos, capa_pos)
  where user_id = auth.uid()
$$;
grant execute on function atualizar_meu_perfil(text, text, text, text, text) to authenticated;
