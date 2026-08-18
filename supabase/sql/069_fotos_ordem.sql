-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — coluna de ordem manual das fotos (reordenar
-- dentro de um álbum/subpasta, botões de mover pra cima/baixo no
-- admin). Rodar depois de 001 a 068. Aditiva.
--
-- Sem essa coluna a ordem sempre foi criado_em (ordem de upload) —
-- não dava pra escolher, por exemplo, colocar a melhor foto do
-- ensaio primeiro. NULL = nunca foi reordenada manualmente, continua
-- caindo pra criado_em (o app já trata isso client-side em
-- _ordenarGrupoFotos); só ganha um número quando o admin usa as
-- setas de mover pela primeira vez naquele álbum/subpasta.
-- ════════════════════════════════════════════════════════════════

alter table fotos add column if not exists ordem integer;
