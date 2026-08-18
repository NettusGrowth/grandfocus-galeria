-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Turmas como entidade de verdade.
--
-- Até aqui "turma" era só o texto livre alunos.turma — cada um
-- digitava do seu jeito ("Ballet II", "ballet 2", "Infantil II"),
-- então "marcar turma inteira" nos álbuns comparava STRING igual, e
-- pequenas variações de digitação quebravam silenciosamente o
-- agrupamento. Essa migration cria a tabela turmas (sempre presa a
-- UMA escola) e o vínculo real alunos.turma_id.
--
-- alunos.turma (texto) É MANTIDA de propósito — vários lugares do app
-- ainda leem ela direto (lista de Alunos, detalhe da Escola, dropdown
-- de turma da Comunidade, "Minhas Turmas" do professor) e continuam
-- funcionando sem precisar reescrever agora: o app passa a manter os
-- dois campos em sincronia toda vez que salva um aluno (turma_id é a
-- fonte de verdade, turma vira só o nome denormalizado). Migrar esses
-- lugares pra turma_id fica pra depois, sem pressa nem risco de quebrar
-- nada agora.
--
-- Rodar depois de 001 a 069. Aditiva.
-- ════════════════════════════════════════════════════════════════

create table if not exists turmas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now(),
  unique (escola_id, nome)
);
alter table turmas enable row level security;

drop policy if exists turmas_admin_all on turmas;
create policy turmas_admin_all on turmas for all to authenticated
  using ((select role from meu_perfil()) in ('admin', 'super_admin'))
  with check ((select role from meu_perfil()) in ('admin', 'super_admin'));

-- leitura pra quem já enxerga a escola (proprietário/diretor/professor
-- multi-escola) — mesma função recursion-safe que alunos_select usa.
drop policy if exists turmas_select on turmas;
create policy turmas_select on turmas for select to authenticated
  using (escola_id in (select minhas_escolas_vinculo()));

-- vínculo real aluno -> turma. on delete set null: apagar uma turma
-- nunca apaga aluno nenhum, só solta o vínculo (mesmo tratamento que
-- o app já faz do lado client-side em excluirTurma()).
alter table alunos add column if not exists turma_id uuid references turmas(id) on delete set null;

-- backfill idempotente: cria uma turma por (escola_id, texto de turma
-- distinto) já usado hoje, e liga cada aluno à turma correspondente.
-- Alunos avulsos (sem escola_id) ficam de fora — turma sem escola não
-- existe nesse modelo, e "turma" solta de aluno avulso nunca fez
-- sentido pra "marcar turma inteira" mesmo.
insert into turmas (escola_id, nome)
select distinct a.escola_id, a.turma
from alunos a
where a.turma is not null and a.escola_id is not null
  and not exists (
    select 1 from turmas t where t.escola_id = a.escola_id and t.nome = a.turma
  );

update alunos a
set turma_id = t.id
from turmas t
where a.turma_id is null
  and a.turma is not null and a.escola_id is not null
  and t.escola_id = a.escola_id and t.nome = a.turma;
