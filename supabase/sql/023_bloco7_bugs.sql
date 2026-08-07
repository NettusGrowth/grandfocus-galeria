-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 7: fix de robustez no login por
-- usuário/senha. Rodar depois de 001 a 022. Aditiva.
--
-- O que muda de verdade (parte 1, sempre seguro rodar): a função
-- email_por_usuario() comparava p.username = p_username no bruto —
-- qualquer diferença de maiúscula/minúscula ou espaço sobrando (ex:
-- username salvo "Admin" e digitado "admin", ou um espaço colado sem
-- querer no cadastro) fazia a função retornar nulo, e a tela de login
-- mostra sempre "Usuário ou senha incorretos." (nunca revela se foi
-- o usuário ou a senha, de propósito, pra não vazar quais usernames
-- existem) — por fora, isso parece "conta sumiu". Corrigido pra
-- comparar sem diferenciar maiúsculas/minúsculas e ignorando espaço
-- nas pontas, dos dois lados da comparação.
-- ════════════════════════════════════════════════════════════════

create or replace function email_por_usuario(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select au.email::text from perfis p
  join auth.users au on au.id = p.user_id
  where lower(trim(p.username)) = lower(trim(p_username))
  limit 1
$$;
grant execute on function email_por_usuario(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- PARTE 2 — DIAGNÓSTICO (só leitura, rode isso primeiro e me manda
-- o resultado, ou leia você mesmo): confirma se a conta do Admin
-- ainda existe em auth.users e em perfis, e qual username/role ela
-- tem salvo hoje.
-- ════════════════════════════════════════════════════════════════
-- select au.id, au.email, au.email_confirmed_at, p.username, p.role, p.nome
-- from auth.users au
-- left join perfis p on p.user_id = au.id
-- where au.email ilike '%admin%' or p.role in ('admin','super_admin')
-- order by au.created_at;

-- ════════════════════════════════════════════════════════════════
-- PARTE 3 — RESTAURAÇÃO (só rode DEPOIS de olhar o resultado da
-- Parte 2 acima). Troque SEU_EMAIL_AQUI pelo e-mail real que apareceu
-- na consulta (coluna au.email) — sem isso eu não tenho como saber
-- qual conta é a certa, e um script "adivinhando" o valor arriscaria
-- mexer na conta errada. Idempotente: rodar de novo não duplica nada.
-- ════════════════════════════════════════════════════════════════
-- update perfis set role = 'admin', username = coalesce(username, 'admin')
-- where user_id = (select id from auth.users where email = 'SEU_EMAIL_AQUI');
