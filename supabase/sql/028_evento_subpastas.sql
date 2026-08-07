-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — "+ Nova Pasta": cria um Ato/subpasta VAZIO
-- dentro de um evento, antes de subir qualquer foto nela — hoje só
-- dava pra criar subpasta selecionando fotos já enviadas e nomeando
-- o grupo (útil pra organizar depois, mas obriga a subir tudo solto
-- primeiro). Rodar depois de 001 a 027. Aditiva.
--
-- Por quê uma tabela nova: fotos.subpasta é só um campo de texto na
-- própria foto — uma pasta sem foto nenhuma não tem onde "existir".
-- Essa tabela guarda só o nome, pra aparecer na lista/seletor mesmo
-- antes da primeira foto chegar.
-- ════════════════════════════════════════════════════════════════

create table if not exists evento_subpastas (
  evento_id uuid not null references eventos(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now(),
  primary key (evento_id, nome)
);
alter table evento_subpastas enable row level security;

-- só admin cria/vê pasta vazia — mesma regra de quem pode subir foto
-- (027_reverter_upload_equipe.sql). Escola/professor continuam
-- enxergando as subpastas que JÁ têm foto (isso vem de fotos.subpasta,
-- não dessa tabela), só não criam pasta nova nem vazia.
create policy evento_subpastas_admin on evento_subpastas for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
grant select, insert, update, delete on evento_subpastas to authenticated;
