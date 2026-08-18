-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — largura/altura da prévia, pra reservar o
-- espaço certo ANTES da foto carregar.
--
-- Causa real do "fotos empurrando uma a outra ao carregar" relatado:
-- a grade "boutique" (Pais/Escola/Professor) usa masonry de altura
-- natural (sem aspect-ratio fixo, pra respeitar a proporção real de
-- cada foto) — sem saber o tamanho de antemão, o navegador só sabe a
-- altura de verdade quando a imagem termina de baixar, e digita o
-- layout inteiro de novo, empurrando as fotos vizinhas. Guardando
-- largura/altura no momento do upload (o canvas que já gera a prévia
-- já sabe esses dois números, só não estavam sendo salvos), o app
-- passa a reservar `aspect-ratio` certo desde o primeiro render — sem
-- esperar a imagem carregar pra saber o tamanho.
--
-- NULL pra fotos já existentes (enviadas antes dessa coluna existir)
-- — o botão "Otimizar fotos antigas" (_otimizarThumbsFotos), que já
-- existe pra gerar prévia em fotos sem thumb_path, agora também
-- preenche largura/altura de brinde, sem precisar de script separado.
--
-- Rodar depois de 001 a 070. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table fotos add column if not exists largura integer;
alter table fotos add column if not exists altura integer;
