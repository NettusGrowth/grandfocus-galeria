-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — RLS (rodar depois de 001_schema.sql).
--
-- Esse é o arquivo que garante que uma escola só vê as próprias fotos e
-- um aluno só vê as fotos marcadas pra ele — mesmo se alguém adulterar o
-- JS no navegador, a proteção real está aqui, no banco.
-- ════════════════════════════════════════════════════════════════

-- devolve o papel (role/escola_id/aluno_id) do usuário logado.
-- security definer = lê a tabela perfis ignorando a própria RLS dela,
-- evitando recursão (a policy de perfis chamaria a si mesma senão).
create or replace function meu_perfil()
returns table (role text, escola_id uuid, aluno_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select role, escola_id, aluno_id from perfis where user_id = auth.uid()
$$;

grant execute on function meu_perfil() to authenticated;

alter table perfis enable row level security;
alter table escolas enable row level security;
alter table alunos enable row level security;
alter table eventos enable row level security;
alter table fotos enable row level security;
alter table foto_aluno enable row level security;

-- ── perfis ──────────────────────────────────────────────────────
-- Insert fica aberto pra qualquer autenticado, MAS só pra role
-- escola/aluno — nunca 'admin' (conta admin é criada manualmente pelo
-- Luiz direto no dashboard do Supabase, uma vez só, não pelo app). Isso
-- é necessário porque `auth.signUp()` (usado pelo admin pra criar acesso
-- de escola/aluno) troca a sessão ativa pro usuário recém-criado antes
-- do app conseguir gravar o perfil — então o insert roda "como" o
-- usuário novo, não mais como admin.
create policy perfis_select on perfis for select to authenticated
  using (user_id = auth.uid() or (select role from meu_perfil()) = 'admin');
create policy perfis_insert on perfis for insert to authenticated
  with check (role in ('escola','aluno'));
create policy perfis_update_admin on perfis for update to authenticated
  using ((select role from meu_perfil()) = 'admin');
create policy perfis_delete_admin on perfis for delete to authenticated
  using ((select role from meu_perfil()) = 'admin');

-- ── escolas ─────────────────────────────────────────────────────
create policy escolas_admin_all on escolas for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy escolas_select_own on escolas for select to authenticated
  using (id = (select escola_id from meu_perfil()));

-- ── alunos ──────────────────────────────────────────────────────
create policy alunos_admin_all on alunos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy alunos_select on alunos for select to authenticated
  using (
    escola_id = (select escola_id from meu_perfil())
    or id = (select aluno_id from meu_perfil())
  );

-- ── eventos ─────────────────────────────────────────────────────
create policy eventos_admin_all on eventos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy eventos_select on eventos for select to authenticated
  using (
    escola_id = (select escola_id from meu_perfil())
    or id in (
      select f.evento_id from fotos f
      join foto_aluno fa on fa.foto_id = f.id
      where fa.aluno_id = (select aluno_id from meu_perfil())
    )
  );

-- ── fotos ───────────────────────────────────────────────────────
create policy fotos_admin_all on fotos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy fotos_select on fotos for select to authenticated
  using (
    evento_id in (select id from eventos where escola_id = (select escola_id from meu_perfil()))
    or id in (select foto_id from foto_aluno where aluno_id = (select aluno_id from meu_perfil()))
  );

-- ── foto_aluno ──────────────────────────────────────────────────
create policy foto_aluno_admin_all on foto_aluno for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy foto_aluno_select on foto_aluno for select to authenticated
  using (
    aluno_id = (select aluno_id from meu_perfil())
    or aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  );

-- ── bootstrap do primeiro admin (rodar manualmente, uma vez) ──────
-- 1. Crie o usuário em Authentication → Users → Add User (email+senha).
-- 2. Copie o UUID dele e rode, trocando os valores:
--    insert into perfis (user_id, role, nome) values ('COLE-O-UUID-AQUI', 'admin', 'Seu nome');
