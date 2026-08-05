-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — permissões de tabela pra role "authenticated".
-- Rodar depois de 001/002/003/004.
--
-- Por quê: como "Automatically expose new tables" ficou DESLIGADO na
-- criação do projeto (escolha deliberada, mais segura), nenhuma tabela
-- nova ganha acesso automático pra API — só criar a policy de RLS não
-- basta, precisa também da permissão de tabela (GRANT). Sem isso, toda
-- consulta dá 403 (Forbidden) antes mesmo da RLS entrar em ação. RLS
-- continua sendo quem decide QUAIS LINHAS aparecem — isso aqui só
-- libera a tabela pra ser consultada por quem está autenticado.
-- ════════════════════════════════════════════════════════════════

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  perfis, escolas, alunos, eventos, fotos, foto_aluno, responsavel_alunos
to authenticated;
