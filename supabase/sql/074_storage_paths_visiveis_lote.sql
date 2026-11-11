-- Corrige o limite de 1.000 linhas do PostgREST na assinatura das imagens.
-- Retorna UMA linha (text[]) apenas com os caminhos solicitados
-- e visíveis ao JWT do usuário. Nenhum dado é alterado.
create or replace function public.storage_paths_visiveis_lote(p_paths text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;
  if p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 80 then
    raise exception 'Lote de imagens inválido (1 a 80 caminhos)'
      using errcode = '22023';
  end if;

  return (
    select coalesce(array_agg(distinct caminho.path order by caminho.path), array[]::text[])
    from public.fotos f
    join public.fotos_visiveis() as vis(id) on vis.id = f.id
    cross join lateral unnest(array[f.storage_path, f.thumb_path]) as caminho(path)
    where caminho.path = any(p_paths)
  );
end;
$$;

revoke all on function public.storage_paths_visiveis_lote(text[]) from public, anon;
grant execute on function public.storage_paths_visiveis_lote(text[]) to authenticated;
comment on function public.storage_paths_visiveis_lote(text[]) is
  'Valida somente até 80 caminhos de fotos, usando fotos_visiveis() e retorna um array (1 linha, sem truncamento PostgREST).';
