-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — RPC apagar_conta_completa: apaga a conta de
-- verdade (perfis + auth.users), não só o perfil.
--
-- BUG relatado: apagar professor/diretor/responsável só rodava
-- `delete from perfis` (index.html, excluirProfessor/
-- excluirResponsavel) — o cliente JS não tem como apagar de
-- auth.users (isso exige a service_role key, que nunca fica exposta
-- no navegador). Sobrava um usuário "fantasma" no Supabase Auth: sem
-- perfil nenhum, mas com o e-mail/username ainda registrado — daí
-- "User already registered" ao tentar recriar o acesso com o mesmo
-- e-mail depois.
--
-- Mesmo padrão de resetar_senha (007_contas.sql): função seguranca
-- definer rodando dentro do Postgres já tem acesso direto a
-- auth.users (não precisa de Edge Function nem service key) — só
-- reaproveitei a mesma checagem de permissão. Rodar depois de 001 a
-- 052. Aditiva.
-- ════════════════════════════════════════════════════════════════

create or replace function apagar_conta_completa(alvo_user_id uuid)
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

  -- perfil já não existe (por ex. alguém rodou o delete antigo antes
  -- dessa função existir) — mesmo assim tenta limpar o auth.users
  -- órfão, que é exatamente o caso que gerava "User already registered".
  if alvo_role is null then
    if not (meu_role in ('admin','super_admin','proprietario','diretor')) then
      raise exception 'Sem permissão.';
    end if;
    delete from auth.users where id = alvo_user_id;
    return;
  end if;

  if not (
    meu_role in ('admin','super_admin')
    or (meu_role in ('proprietario','diretor') and minha_escola is not null and minha_escola = alvo_escola)
  ) then
    raise exception 'Sem permissão pra apagar essa conta.';
  end if;

  delete from perfis where user_id = alvo_user_id;
  delete from auth.users where id = alvo_user_id;
end;
$$;

grant execute on function apagar_conta_completa(uuid) to authenticated;
