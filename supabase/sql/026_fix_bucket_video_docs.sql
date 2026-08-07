-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — corrige bucket bloqueando vídeo/documento na
-- Comunidade. Rodar depois de 001 a 025. Aditiva (só ajusta config do
-- bucket existente, não mexe em RLS nem em tabela nenhuma).
--
-- Causa raiz do "vídeo publicado não aparece": a migration 015
-- restringiu o bucket fotos-grandfocus a só
-- image/jpeg|png|webp (era pra travar upload malicioso de arquivo
-- executável disfarçado) — mas isso foi ANTES do Bloco 5 (posts com
-- vídeo) e do Bloco 5 gaps (posts com PDF/DOCX). Como ninguém
-- atualizou a lista quando esses recursos foram adicionados, o
-- upload de vídeo/documento pro Storage falha (rejeitado pelo próprio
-- bucket, nem chega a passar pela RLS) — o post é criado, só que sem
-- nenhuma mídia anexada. O código só mostrava um toast passageiro
-- avisando "uma mídia falhou", fácil de não perceber.
-- ════════════════════════════════════════════════════════════════

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp',
  'video/mp4','video/webm','video/quicktime',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
],
-- vídeo pesa muito mais que foto — 25MB não dava nem pra um clipe
-- curto de celular. Subindo pra 100MB.
file_size_limit = 104857600
where id = 'fotos-grandfocus';
