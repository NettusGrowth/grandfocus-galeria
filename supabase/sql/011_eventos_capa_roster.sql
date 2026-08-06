-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Estágio C: capa do evento + "elenco" (quais
-- alunos participam), pra marcar automaticamente todo mundo nas fotos
-- do upload em massa. Rodar depois de 001 a 010. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table eventos add column if not exists capa_url text;
alter table eventos add column if not exists alunos_selecionados uuid[] not null default '{}';

-- ensaio avulso = mesma tabela eventos, só que o destinatário é
-- escolhido pessoa a pessoa (não pelo roster de uma escola só) — esse
-- array guarda perfis.user_id de quem foi marcado diretamente
-- (professor/diretor/responsável/avulso), via foto_pessoa.
alter table eventos add column if not exists pessoas_selecionadas uuid[] not null default '{}';
alter table eventos add column if not exists tipo text not null default 'evento' check (tipo in ('evento','ensaio'));

-- leitura da capa do evento: mesma regra de quem já enxerga o evento
-- (reaproveita eventos_visiveis(), já existe desde o Estágio A/C).
create policy evento_capa_select on storage.objects for select to authenticated
using (
  bucket_id = 'fotos-grandfocus'
  and name like 'eventos-capa/%'
  and (
    (select role from meu_perfil()) in ('admin','super_admin')
    or (
      split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
      and split_part(name,'/',2)::uuid in (select eventos_visiveis())
    )
  )
);
