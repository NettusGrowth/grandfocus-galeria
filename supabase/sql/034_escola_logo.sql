-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — logo separado da capa nas escolas. Hoje a
-- escola só tem capa_url (faixa larga) e o selo pequeno nos cards
-- reaproveitava essa MESMA imagem espremida num quadradinho, ficava
-- ilegível. Rodar depois de 001 a 033. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table escolas add column if not exists logo_url text;
alter table escolas add column if not exists logo_pos text;
