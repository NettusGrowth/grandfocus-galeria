-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Seleção de Fotos: prévia de capa na lista do
-- admin. Hoje o card de cada galeria de seleção não mostra nenhuma
-- foto — só dá pra saber do que se trata abrindo ela. Guarda o
-- storage_path (mesma convenção de nome de eventos/ensaios: "capa_url"
-- mesmo sendo um path, não uma URL de verdade — assinada na hora de
-- exibir) de uma foto pra usar como capa; auto-preenchida com a
-- primeira foto enviada, e o admin pode trocar por qualquer outra a
-- qualquer momento. Rodar depois de 001 a 041. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_galerias add column if not exists capa_url text;
