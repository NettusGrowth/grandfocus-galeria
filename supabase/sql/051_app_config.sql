-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — app_config: tabela chave/valor genérica pra
-- configurações globais escondidas (sem tela própria — acessada via
-- atalho de teclado, não tem botão em lugar nenhum do app). Primeiro
-- uso: foto de fundo do Dashboard (hoje fixa em
-- /assets/dashboard-hero.jpg), editável só por admin/super_admin sem
-- exigir deploy novo. Rodar depois de 001 a 050. Aditiva.
-- ════════════════════════════════════════════════════════════════

create table if not exists app_config (
  chave text primary key,
  valor text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);

alter table app_config enable row level security;

-- select aberto a qualquer autenticado — o fundo do Dashboard precisa
-- carregar pra todo mundo que loga como admin/super_admin, não só pra
-- quem tem permissão de trocar.
create policy app_config_select on app_config for select to authenticated
  using (true);

create policy app_config_insert_admin on app_config for insert to authenticated
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy app_config_update_admin on app_config for update to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
