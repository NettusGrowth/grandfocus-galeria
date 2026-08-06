-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige o mesmo problema que já resolvemos em
-- responsavel_alunos: signUp() às vezes troca a sessão ativa pro
-- usuário recém-criado antes do app conseguir gravar os dados
-- seguintes — nesse caso o insert em permissoes_extra rodava "como" o
-- usuário novo (role='avulso'), não mais como admin, e a policy
-- antiga (admin-only pra tudo) rejeitava. Rodar depois de 007/008.
-- ════════════════════════════════════════════════════════════════

drop policy if exists permissoes_extra_admin_all on permissoes_extra;
drop policy if exists permissoes_extra_select_own on permissoes_extra;

create policy permissoes_extra_select on permissoes_extra for select to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin') or user_id = auth.uid());
create policy permissoes_extra_insert on permissoes_extra for insert to authenticated
  with check ((select role from meu_perfil()) in ('admin','super_admin') or user_id = auth.uid());
create policy permissoes_extra_update_admin on permissoes_extra for update to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
create policy permissoes_extra_delete_admin on permissoes_extra for delete to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'));
