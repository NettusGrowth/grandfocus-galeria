-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — RPC nomes_por_id: resolve "?" nos chips de
-- marcação da Galeria (filtro por pessoa dentro de um álbum).
--
-- Hoje o nome de professor/diretor/proprietário/responsável marcado
-- numa foto só resolve se a store local de quem está olhando já tiver
-- carregado a tabela perfis inteira — o que só acontece pro admin e
-- pra quem abre a aba Equipe (proprietário/diretor). Pra qualquer
-- outro papel (incluindo o PRÓPRIO usuário marcado, quando ele mesmo
-- não é proprietário/diretor), o nome vira "?" porque a RLS de perfis
-- (050_fix_perfis_select_regressao.sql) não deixa esse papel enxergar
-- a linha de outra pessoa.
--
-- Essa RPC devolve só nome (não email/telefone/outro dado sensível) —
-- mesmo tipo de informação que já aparece pra qualquer autenticado em
-- posts da Comunidade, marcação de fotos etc. Quem chama já tem o
-- user_id de foto_pessoa (dado que a RLS de foto_pessoa já liberou pra
-- ele ver), então isso não abre acesso a nada que a pessoa não
-- devesse já ter. Rodar depois de 001 a 051. Aditiva.
-- ════════════════════════════════════════════════════════════════

create or replace function nomes_por_id(ids uuid[])
returns table (id uuid, nome text)
language sql
security definer
stable
set search_path = public
as $$
  select user_id, nome from perfis where user_id = any(ids)
$$;

grant execute on function nomes_por_id(uuid[]) to authenticated;
