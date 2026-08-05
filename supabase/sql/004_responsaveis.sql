-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — troca o papel "aluno" (login) por "responsavel"
-- (pai/mãe), com suporte a MAIS DE UM FILHO por conta (e mais de um
-- responsável por filho). Rodar depois de 001/002/003, uma vez.
--
-- Por quê: quem acessa a galeria não é o bailarino, é o responsável —
-- e uma família pode ter mais de um filho (inclusive em escolas
-- diferentes). O desenho anterior só suportava 1 aluno por conta
-- (perfis.aluno_id era uma coluna escalar) — isso vira uma tabela de
-- junção N:N. Migration aditiva: não mexe em escolas/alunos/eventos/
-- fotos/foto_aluno, só em perfis + nas regras de quem pode ler o quê.
-- ════════════════════════════════════════════════════════════════

-- ── 1. derruba as policies existentes (dependem da assinatura antiga
--       de meu_perfil(), que precisa mudar) ──────────────────────
drop policy if exists perfis_select on perfis;
drop policy if exists perfis_insert on perfis;
drop policy if exists perfis_update_admin on perfis;
drop policy if exists perfis_delete_admin on perfis;
drop policy if exists escolas_admin_all on escolas;
drop policy if exists escolas_select_own on escolas;
drop policy if exists alunos_admin_all on alunos;
drop policy if exists alunos_select on alunos;
drop policy if exists eventos_admin_all on eventos;
drop policy if exists eventos_select on eventos;
drop policy if exists fotos_admin_all on fotos;
drop policy if exists fotos_select on fotos;
drop policy if exists foto_aluno_admin_all on foto_aluno;
drop policy if exists foto_aluno_select on foto_aluno;
drop policy if exists fotos_storage_select on storage.objects;
drop policy if exists fotos_storage_admin_insert on storage.objects;
drop policy if exists fotos_storage_admin_update on storage.objects;
drop policy if exists fotos_storage_admin_delete on storage.objects;

-- ── 2. recria meu_perfil() sem aluno_id (não é mais escalar) ──────
drop function if exists meu_perfil();
create or replace function meu_perfil()
returns table (role text, escola_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select role, escola_id from perfis where user_id = auth.uid()
$$;
grant execute on function meu_perfil() to authenticated;

-- ── 3. tabela de vínculo N:N responsável ↔ filhos (precisa existir
--       antes da função meus_alunos(), que a referencia) ────────────
create table if not exists responsavel_alunos (
  user_id uuid not null references perfis(user_id) on delete cascade,
  aluno_id uuid not null references alunos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id, aluno_id)
);
create index if not exists idx_resp_alunos_aluno on responsavel_alunos(aluno_id);
alter table responsavel_alunos enable row level security;

-- ── 4. nova função: quais alunos (filhos) o responsável logado pode ver
create or replace function meus_alunos()
returns table (aluno_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select aluno_id from responsavel_alunos where user_id = auth.uid()
$$;
grant execute on function meus_alunos() to authenticated;

-- ── 5. ajusta perfis: role 'aluno' → 'responsavel', remove aluno_id ─
-- Acha e derruba o check constraint de "role" dinamicamente (não confia
-- em nome auto-gerado — se o Postgres tiver nomeado diferente do
-- esperado, um "drop constraint" por nome fixo falharia em silêncio e
-- o update logo abaixo travaria a migration inteira no meio).
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.perfis'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
      and pg_get_constraintdef(oid) ilike '%admin%'
      and pg_get_constraintdef(oid) ilike '%aluno%'
  loop
    execute format('alter table perfis drop constraint %I', r.conname);
  end loop;
end $$;

update perfis set role = 'responsavel' where role = 'aluno';

alter table perfis add constraint perfis_role_check
  check (role in ('admin','escola','responsavel'));

alter table perfis drop constraint if exists perfil_aluno_check;
drop index if exists idx_perfis_aluno;
alter table perfis drop column if exists aluno_id;

-- ── 6. recria todas as policies usando meus_alunos() no lugar do
--       antigo "= aluno_id" ─────────────────────────────────────────

-- perfis
create policy perfis_select on perfis for select to authenticated
  using (user_id = auth.uid() or (select role from meu_perfil()) = 'admin');
create policy perfis_insert on perfis for insert to authenticated
  with check (role in ('escola','responsavel'));
create policy perfis_update_admin on perfis for update to authenticated
  using ((select role from meu_perfil()) = 'admin');
create policy perfis_delete_admin on perfis for delete to authenticated
  using ((select role from meu_perfil()) = 'admin');

-- escolas
create policy escolas_admin_all on escolas for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy escolas_select_own on escolas for select to authenticated
  using (id = (select escola_id from meu_perfil()));

-- alunos
create policy alunos_admin_all on alunos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy alunos_select on alunos for select to authenticated
  using (
    escola_id = (select escola_id from meu_perfil())
    or id in (select aluno_id from meus_alunos())
  );

-- eventos
create policy eventos_admin_all on eventos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy eventos_select on eventos for select to authenticated
  using (
    escola_id = (select escola_id from meu_perfil())
    or id in (
      select f.evento_id from fotos f
      join foto_aluno fa on fa.foto_id = f.id
      where fa.aluno_id in (select aluno_id from meus_alunos())
    )
  );

-- fotos
create policy fotos_admin_all on fotos for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy fotos_select on fotos for select to authenticated
  using (
    evento_id in (select id from eventos where escola_id = (select escola_id from meu_perfil()))
    or id in (select foto_id from foto_aluno where aluno_id in (select aluno_id from meus_alunos()))
  );

-- foto_aluno
create policy foto_aluno_admin_all on foto_aluno for all to authenticated
  using ((select role from meu_perfil()) = 'admin')
  with check ((select role from meu_perfil()) = 'admin');
create policy foto_aluno_select on foto_aluno for select to authenticated
  using (
    aluno_id in (select aluno_id from meus_alunos())
    or aluno_id in (select id from alunos where escola_id = (select escola_id from meu_perfil()))
  );

-- responsavel_alunos — insert liberado pro admin OU pra própria conta
-- recém-criada (o "criar acesso" do admin chama auth.signUp(), que às
-- vezes troca a sessão ativa pro usuário novo antes do app conseguir
-- gravar o vínculo — nesses dois cenários auth.uid() é uma pessoa
-- diferente, então o insert precisa aceitar os dois). Editar/apagar
-- vínculo continua só admin — o responsável nunca desvincula o próprio
-- filho sozinho.
create policy resp_alunos_select on responsavel_alunos for select to authenticated
  using ((select role from meu_perfil()) = 'admin' or user_id = auth.uid());
create policy resp_alunos_insert on responsavel_alunos for insert to authenticated
  with check ((select role from meu_perfil()) = 'admin' or user_id = auth.uid());
create policy resp_alunos_update_admin on responsavel_alunos for update to authenticated
  using ((select role from meu_perfil()) = 'admin');
create policy resp_alunos_delete_admin on responsavel_alunos for delete to authenticated
  using ((select role from meu_perfil()) = 'admin');

-- storage
create policy fotos_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and (
    (select role from meu_perfil()) = 'admin'
    or name in (
      select storage_path from fotos
      where evento_id in (select id from eventos where escola_id = (select escola_id from meu_perfil()))
    )
    or name in (
      select f.storage_path from fotos f
      join foto_aluno fa on fa.foto_id = f.id
      where fa.aluno_id in (select aluno_id from meus_alunos())
    )
  )
);
create policy fotos_storage_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');
create policy fotos_storage_admin_update on storage.objects for update to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');
create policy fotos_storage_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'fotos-grandfocus' and (select role from meu_perfil()) = 'admin');
