-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige recursão infinita em "perfis"
-- introduzida no Bloco 6 (022_bloco6.sql). Rodar depois de 001 a 023.
-- Aditiva. ESSA É A CAUSA REAL do "admin não loga" — confirmado com
-- "ERROR: 42P17: infinite recursion detected in policy for relation
-- perfis" ao simular a mesma consulta que o app faz no login.
--
-- Por quê: o 022 reescreveu escolas_select_own e alunos_select pra dar
-- suporte a professor em mais de uma escola (professor_escolas), mas
-- as duas consultam "perfis" DIRETO dentro da própria policy — sem
-- passar por uma função SECURITY DEFINER (o mesmo padrão que o
-- 006_fix_recursao.sql já tinha estabelecido lá atrás, bem no início
-- do projeto, exatamente pra evitar isso).
--
-- O ciclo: perfis_select (Bloco 6) consulta "alunos" na cláusula do
-- responsável → alunos_select consulta "perfis" direto (sem função) →
-- perfis_select roda nela mesma de novo → recursão infinita. Isso
-- derruba QUALQUER select em perfis pra QUALQUER usuário, não só o
-- admin — só não tinha aparecido ainda porque o caminho que dispara
-- (perfis → alunos → perfis) só é percorrido quando a cláusula do
-- responsável entra em jogo na avaliação da policy.
--
-- Correção: os dois voltam a usar uma função SECURITY DEFINER (roda
-- como dono da função, ignora a RLS de "perfis" por dentro, quebra o
-- ciclo) — mesmo padrão de meu_perfil()/meus_alunos()/eventos_visiveis().
-- ════════════════════════════════════════════════════════════════

create or replace function minhas_escolas_vinculo()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select escola_id from perfis where user_id = auth.uid() and escola_id is not null
  union
  select escola_id from professor_escolas where user_id = auth.uid()
$$;
grant execute on function minhas_escolas_vinculo() to authenticated;

drop policy if exists escolas_select_own on escolas;
create policy escolas_select_own on escolas for select to authenticated
using (id in (select minhas_escolas_vinculo()));

drop policy if exists alunos_select on alunos;
create policy alunos_select on alunos for select to authenticated
using (
  escola_id in (select minhas_escolas_vinculo())
  or id in (select aluno_id from meus_alunos())
);
