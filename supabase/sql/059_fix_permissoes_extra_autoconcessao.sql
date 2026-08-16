-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — fecha auto-concessão de permissão em permissoes_extra.
--
-- BUG DE SEGURANÇA (achado na auditoria de RLS): permissoes_extra_insert
-- (009_fix_permissoes.sql) permite `user_id = auth.uid()` — ou seja,
-- QUALQUER autenticado podia inserir uma linha PRA SI MESMO com
-- qualquer chave/valor, inclusive 'postar_comunidade' ou
-- 'gerenciar_cadastro' (as mesmas chaves que posso_postar() e outras
-- checagens do app usam pra liberar ação de verdade). Um professor,
-- por exemplo, podia se autoconceder 'postar_comunidade'=true direto
-- via API, sem passar pelo fluxo real (admin habilitando pelo painel
-- de Avulsos).
--
-- Por que existia: mesmo motivo documentado no comentário original de
-- 009 — o signUp() antigo às vezes trocava a sessão ativa pro usuário
-- recém-criado ANTES do insert de permissoes_extra terminar, e nesse
-- instante auth.uid() virava o usuário novo, não mais o admin. Essa
-- corrida foi eliminada NA RAIZ (_criarContaAuth agora usa um cliente
-- Supabase isolado só pro signUp — a sessão do "db" principal nunca
-- mais troca), então essa válvula de escape não é mais necessária
-- pelo motivo original — só sobrou como buraco de auto-concessão.
--
-- Rodar depois de 001 a 058. Aditiva (substitui a policy de insert).
-- ════════════════════════════════════════════════════════════════

drop policy if exists permissoes_extra_insert on permissoes_extra;
create policy permissoes_extra_insert on permissoes_extra for insert to authenticated
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));
