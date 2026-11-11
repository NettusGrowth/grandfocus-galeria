-- Guarda o nome ORIGINAL dos novos arquivos enviados à Galeria.
-- Fotos antigas continuam válidas com NULL. Não toca nos arquivos do R2,
-- nem altera identificadores, pastas, marcações, ordem manual ou downloads.
alter table public.fotos
  add column if not exists nome_original text;

comment on column public.fotos.nome_original is
  'Nome original do arquivo escolhido pelo admin (ex.: IMG_6333.JPG). Nulo em fotos anteriores à implantação.';
