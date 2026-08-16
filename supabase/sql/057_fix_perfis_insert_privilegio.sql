-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — fecha buraco sério de privilégio em perfis_insert.
--
-- BUG DE SEGURANÇA: a policy vigente até aqui (007_contas.sql) era só
-- um whitelist de role, sem NENHUMA checagem de quem está inserindo:
--   check (role in ('escola','responsavel','proprietario','diretor',
--                    'professor','aluno','avulso'))
-- Isso significa que QUALQUER autenticado (mesmo um responsavel ou
-- avulso) podia, via chamada direta à API (sem passar pela UI),
-- inserir uma linha em perfis com role='proprietario' ou 'diretor'
-- de QUALQUER escola — virar dono de outra escola, ou criar contas
-- fantasma com qualquer cargo. A UI nunca expôs esse caminho pra
-- usuários comuns, mas a RLS é a última linha de defesa — ela sozinha
-- não impedia nada.
--
-- Motivo de mexer agora: ia adicionar um botão "+ Novo Professor/
-- Diretor" na aba Equipe (proprietario/diretor), reaproveitando o
-- MESMO modal do admin — que deixa escolher QUALQUER escola do
-- sistema e cargo "Proprietário" no dropdown. Sem essa correção, um
-- diretor mal-intencionado (ou só um clique errado) conseguiria criar
-- um "proprietário" de outra escola, ou vincular um professor à
-- escola errada. A trava de verdade tem que estar aqui, não só
-- escondendo campo na UI.
--
-- Regra nova:
--   - admin/super_admin: continua sem restrição nenhuma (como sempre).
--   - proprietario/diretor: só pode inserir role IN ('professor',
--     'diretor') — nunca 'proprietario' — e só com escola_id igual à
--     PRÓPRIA escola (nunca de outra escola). Também pode inserir
--     role='responsavel' (sem trava de escola aqui — quem trava o
--     VÍNCULO com o aluno certo é a RLS de responsavel_alunos, já
--     corrigida em 054, escopada por escola).
--   - qualquer outro caso (inclusive 'escola', 'avulso', 'aluno',
--     'proprietario' por não-admin) deixa de ser permitido — hoje
--     esses só são criados pelo admin mesmo (aba Escolas ->
--     "Criar acesso"), então não tira nenhuma funcionalidade real.
--
-- Rodar depois de 001 a 056. Aditiva (substitui a policy antiga).
-- ════════════════════════════════════════════════════════════════

drop policy if exists perfis_insert on perfis;
create policy perfis_insert on perfis for insert to authenticated
with check (
  (select role from meu_perfil()) in ('admin', 'super_admin')
  or (
    (select role from meu_perfil()) in ('proprietario', 'diretor')
    and (
      (role in ('professor', 'diretor') and escola_id is not distinct from (select escola_id from meu_perfil()))
      or role = 'responsavel'
    )
  )
);
