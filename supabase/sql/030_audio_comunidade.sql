-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — suporte real a áudio na Comunidade. Rodar
-- depois de 001 a 029. Aditiva.
--
-- Causa raiz do "posto áudio e ele fica invisível": a Comunidade nunca
-- teve opção de anexar áudio (só Fotos/Vídeo/Documento) — quem tentava
-- mandar um áudio acabava usando o campo de Vídeo ou Documento, e o
-- arquivo era rejeitado pelo próprio bucket (allowed_mime_types não
-- incluía tipo de áudio nenhum, mesmo bug de origem do "vídeo não
-- aparecia" do 026_fix_bucket_video_docs.sql) — o post era criado
-- normalmente, só que sem a mídia (upload falha silenciosamente,
-- só um toast passageiro avisava). Agora o composer ganhou um botão
-- "🎤 Áudio" de verdade (index.html), e o banco precisa aceitar:
-- ════════════════════════════════════════════════════════════════

alter table post_midias drop constraint if exists post_midias_tipo_check;
alter table post_midias add constraint post_midias_tipo_check check (tipo in ('foto','video','documento','audio'));

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp',
  'video/mp4','video/webm','video/quicktime',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg','audio/x-m4a','audio/3gpp','audio/aac'
]
where id = 'fotos-grandfocus';
