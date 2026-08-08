-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — regra de tempo pro "destaque" da Comunidade:
-- hoje um post marcado como aviso importante fica fixado pra sempre,
-- e a única forma de tirar era apagar o post inteiro. Rodar depois de
-- 001 a 032. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table posts add column if not exists destaque_expira_em timestamptz;

-- autor ou admin podem tirar/renovar o destaque de um post sem apagar
-- ele. O grant de coluna abaixo restringe o UPDATE a só esses dois
-- campos (mesmo se alguém tentasse chamar a API direto) — o texto, a
-- escola, o autor etc. de um post continuam imutáveis depois de criado.
drop policy if exists posts_update on posts;
create policy posts_update on posts for update to authenticated
using (
  (select role from meu_perfil()) in ('admin','super_admin')
  or autor_user_id = auth.uid()
)
with check (
  (select role from meu_perfil()) in ('admin','super_admin')
  or autor_user_id = auth.uid()
);
grant update (destaque, destaque_expira_em) on posts to authenticated;
