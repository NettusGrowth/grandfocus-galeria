-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 5 (fechamento de lacunas): nome/capa
-- customizados por comunidade, documentos (PDF/DOCX) em post_midias.
-- Rodar depois de 001 a 020. Aditiva.
-- ════════════════════════════════════════════════════════════════

-- cada escola já tem capa_url (usado na Galeria/Escolas) — a Comunidade
-- dela pode ter um nome e uma capa PRÓPRIOS, diferentes da escola em si
-- (ex: escola "Studio Arabesque", comunidade "Mural Arabesque Kids").
alter table escolas add column if not exists comunidade_nome text;
alter table escolas add column if not exists comunidade_capa_url text;

-- post_midias.tipo passa a aceitar 'documento' (PDF/DOCX) além de
-- foto/video — troca o check constraint por um mais permissivo.
alter table post_midias drop constraint if exists post_midias_tipo_check;
alter table post_midias add constraint post_midias_tipo_check check (tipo in ('foto','video','documento'));
