-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio A: contas, perfil, senha, auditoria.
-- Rodar depois de 001 a 006. Aditiva — não mexe em escolas/alunos/
-- eventos/fotos já cadastrados, nem na conta admin que já existe.
-- ════════════════════════════════════════════════════════════════

-- ── perfis: novos campos ───────────────────────────────────────────
alter table perfis add column if not exists username text;
alter table perfis add column if not exists foto_url text;
alter table perfis add column if not exists capa_url text;
alter table perfis add column if not exists ultimo_acesso timestamptz;

create unique index if not exists idx_perfis_username on perfis(username) where username is not null;

-- amplia o vocabulário de "role" permitido (adiciona, não remove nada
-- do que já existe — contas atuais continuam válidas do jeito que
-- estão). As distinções reais entre proprietario/diretor/professor
-- entram no Estágio B; por enquanto só abre espaço no banco.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.perfis'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
      and pg_get_constraintdef(oid) ilike '%admin%'
  loop
    execute format('alter table perfis drop constraint %I', r.conname);
  end loop;
end $$;
alter table perfis add constraint perfis_role_check
  check (role in ('super_admin','admin','escola','proprietario','diretor','professor','responsavel','aluno','avulso'));

drop policy if exists perfis_insert on perfis;
create policy perfis_insert on perfis for insert to authenticated
  with check (role in ('escola','responsavel','proprietario','diretor','professor','aluno','avulso'));

-- ── permissões extras (casos concretos, não é motor genérico) ──────
create table if not exists permissoes_extra (
  user_id uuid not null references perfis(user_id) on delete cascade,
  chave text not null,
  valor boolean not null default true,
  primary key (user_id, chave)
);
alter table permissoes_extra enable row level security;
create policy permissoes_extra_admin_all on permissoes_extra for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy permissoes_extra_select_own on permissoes_extra for select to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on permissoes_extra to authenticated;

-- ── auditoria ───────────────────────────────────────────────────────
create table if not exists auditoria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references perfis(user_id) on delete set null,
  user_nome text,
  acao text not null,
  tabela text,
  registro_id uuid,
  detalhe text,
  criado_em timestamptz not null default now()
);
alter table auditoria enable row level security;
create policy auditoria_admin_select on auditoria for select to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
create policy auditoria_insert on auditoria for insert to authenticated
  with check (user_id = auth.uid());
grant select, insert on auditoria to authenticated;
create index if not exists idx_auditoria_criado on auditoria(criado_em desc);

-- ── login por usuário (sem e-mail) ──────────────────────────────────
-- traduz usuário -> e-mail sintético/real cadastrado, ANTES do login
-- (por isso é liberado pro "anon" também, não só authenticated).
create or replace function email_por_usuario(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select au.email::text from perfis p
  join auth.users au on au.id = p.user_id
  where p.username = p_username
  limit 1
$$;
grant execute on function email_por_usuario(text) to anon, authenticated;

-- ── redefinir senha sem e-mail ──────────────────────────────────────
-- admin/super_admin: qualquer conta. proprietario/diretor: só de quem
-- é da própria escola. Reescreve a senha direto em auth.users com o
-- mesmo hash (bcrypt via pgcrypto) que o Supabase usa por baixo —
-- evita precisar de Edge Function ou envio de e-mail/SMS.
create or replace function resetar_senha(alvo_user_id uuid, nova_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  meu_role text; minha_escola uuid;
  alvo_role text; alvo_escola uuid;
begin
  select role, escola_id into meu_role, minha_escola from perfis where user_id = auth.uid();
  select role, escola_id into alvo_role, alvo_escola from perfis where user_id = alvo_user_id;

  if alvo_role is null then
    raise exception 'Conta de destino não encontrada.';
  end if;

  if not (
    meu_role in ('admin','super_admin')
    or (meu_role in ('proprietario','diretor') and minha_escola is not null and minha_escola = alvo_escola)
  ) then
    raise exception 'Sem permissão pra redefinir essa senha.';
  end if;

  if nova_senha is null or length(nova_senha) < 6 then
    raise exception 'A nova senha precisa ter pelo menos 6 caracteres.';
  end if;

  update auth.users set encrypted_password = crypt(nova_senha, gen_salt('bf')), updated_at = now()
  where id = alvo_user_id;
end;
$$;
grant execute on function resetar_senha(uuid, text) to authenticated;

-- ── perfil próprio (nome/foto/capa) — sem dar acesso de UPDATE cru na
-- tabela perfis (evitaria alguém trocar o próprio "role" via API) ────
create or replace function atualizar_meu_perfil(novo_nome text, nova_foto_url text, nova_capa_url text)
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set
    nome = coalesce(novo_nome, nome),
    foto_url = coalesce(nova_foto_url, foto_url),
    capa_url = coalesce(nova_capa_url, capa_url)
  where user_id = auth.uid()
$$;
grant execute on function atualizar_meu_perfil(text, text, text) to authenticated;

create or replace function marcar_acesso()
returns void
language sql
security definer
set search_path = public
as $$
  update perfis set ultimo_acesso = now() where user_id = auth.uid()
$$;
grant execute on function marcar_acesso() to authenticated;

-- ── storage: cada um pode ler/gravar só a própria foto de perfil/capa
-- (path perfis/{user_id}/...) no mesmo bucket privado da galeria ─────
create policy avatar_self_select on storage.objects for select to authenticated
using (bucket_id = 'fotos-grandfocus' and name like 'perfis/' || auth.uid()::text || '/%');
create policy avatar_self_insert on storage.objects for insert to authenticated
with check (bucket_id = 'fotos-grandfocus' and name like 'perfis/' || auth.uid()::text || '/%');
create policy avatar_self_update on storage.objects for update to authenticated
using (bucket_id = 'fotos-grandfocus' and name like 'perfis/' || auth.uid()::text || '/%');

-- ── bootstrap: defina um username pra sua conta admin já existente.
-- Troque 'admin' se quiser outro (dá pra mudar depois pela tela de
-- perfil também). Rode só esse UPDATE manualmente:
-- update perfis set username = 'admin' where role = 'admin';
