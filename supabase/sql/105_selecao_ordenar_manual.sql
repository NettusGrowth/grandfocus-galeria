-- Seleção de fotos: alteração de ordem sem apagar, reenviar ou afetar pedidos.
-- Aplicado no banco de produção em 14/11/2026.
create or replace function public.selecao_reordenar_fotos(
  p_galeria_id uuid, p_foto_ids uuid[]
)
returns integer language plpgsql security invoker
set search_path=public,pg_temp
as $fn$
declare
  v_total integer;
  v_unicos integer;
  v_atualizados integer;
begin
  if not exists (select 1 from public.meu_perfil() p where p.role in ('admin','super_admin')) then
    raise exception 'Sem permissão para organizar fotos.' using errcode='42501';
  end if;
  if p_galeria_id is null or p_foto_ids is null or coalesce(array_length(p_foto_ids,1),0)=0 then
    raise exception 'É necessário selecionar fotos da galeria.' using errcode='22023';
  end if;
  perform 1 from public.selecao_galerias where id=p_galeria_id for update;
  if not found then
    raise exception 'Galeria não encontrada.' using errcode='22023';
  end if;
  select count(*) into v_total from public.selecao_fotos where galeria_id=p_galeria_id;
  select count(distinct id) into v_unicos from unnest(p_foto_ids) as p(id);
  if v_total<>cardinality(p_foto_ids) or v_unicos<>v_total then
    raise exception 'A relação de fotos mudou. Atualize e tente novamente.' using errcode='22023';
  end if;
  if exists (
    select 1 from unnest(p_foto_ids) as p(id)
    left join public.selecao_fotos f on f.id=p.id and f.galeria_id=p_galeria_id
    where f.id is null
  ) then
    raise exception 'Há fotos que não pertencem à galeria.' using errcode='22023';
  end if;
  update public.selecao_fotos f
  set ordem=(p.pos-1)::integer
  from unnest(p_foto_ids) with ordinality as p(id,pos)
  where f.galeria_id=p_galeria_id and f.id=p.id;
  get diagnostics v_atualizados=row_count;
  if v_atualizados<>v_total then
    raise exception 'Não foi possível salvar todas as posições.' using errcode='22023';
  end if;
  return v_atualizados;
end
$fn$;
revoke all on function public.selecao_reordenar_fotos(uuid,uuid[]) from public,anon;
grant execute on function public.selecao_reordenar_fotos(uuid,uuid[]) to authenticated;
comment on function public.selecao_reordenar_fotos(uuid,uuid[]) is
  'Salva atomicamente toda a ordem de uma galeria. Somente admin e super_admin, sem alterar arquivos ou seleções.';
