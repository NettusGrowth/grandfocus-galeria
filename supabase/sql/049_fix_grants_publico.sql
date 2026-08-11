-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige "permission denied for table X" em
-- eventos/posts/perfis (e provavelmente outras tabelas originais do
-- projeto) + contas que ficam "órfãs" ao tentar criar acesso.
--
-- CAUSA: as tabelas originais (eventos, perfis, escolas, alunos,
-- fotos...) nunca tiveram um "grant" explícito em nenhuma migration —
-- sempre dependeram do grant padrão que o Supabase aplica sozinho
-- quando o projeto é criado. As tabelas mais novas (posts, seleção,
-- gold reserve) têm grant explícito porque alguém já tinha esbarrado
-- nesse mesmo problema antes (ver comentário em 022_bloco6.sql).
-- O fato de até "posts" (que TEM grant explícito) estar negando
-- acesso agora indica que as permissões do projeto inteiro foram
-- resetadas/revogadas em algum momento (pausa/restore do banco,
-- alteração manual no painel, etc.) — não é algo que uma migration
-- deste projeto tenha causado.
--
-- CORREÇÃO: re-concede o grant padrão do Supabase pra TODAS as
-- tabelas do schema public de uma vez (RLS continua sendo quem decide
-- quais LINHAS cada um vê — isso aqui só permite a OPERAÇÃO, não abre
-- nenhum dado que a RLS já não deixasse ver). Aditivo e seguro: rodar
-- de novo não quebra nada, só reforça o que já deveria estar valendo.
-- Também garante que tabelas criadas no futuro já nasçam com o grant
-- certo, pra esse problema não se repetir.
-- ════════════════════════════════════════════════════════════════

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- ── diagnóstico: contas de login (auth.users) sem linha em "perfis"
-- — é exatamente esse estado que trava alguém no "sem perfil de
-- acesso, fale com a Grand Focus" mesmo com a senha certa. Roda
-- read-only, não muda nada — o resultado (nome/e-mail de cada linha)
-- é o que eu preciso pra saber quem recriar e com qual role/escola.
select au.id as auth_id, au.email, au.created_at
from auth.users au
left join perfis p on p.user_id = au.id
where p.user_id is null
order by au.created_at desc;
