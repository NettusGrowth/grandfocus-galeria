-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — guarda o nome original do arquivo (ex.:
-- _DSC0012.jpg) de cada foto da Seleção, pra dar pro fotógrafo um jeito
-- de copiar os códigos das fotos que o cliente escolheu e colar direto
-- na busca do Lightroom/Bridge (mesmo recurso do Alboom Proof). Hoje o
-- upload troca o nome pra um path aleatório (leve-<timestamp>_<rand>),
-- então sem essa coluna o nome original já estaria perdido pra sempre
-- assim que a foto sobe. Rodar depois de 001 a 036. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_fotos add column if not exists nome_original text;
