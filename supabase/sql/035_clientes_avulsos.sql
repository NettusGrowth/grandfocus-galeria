-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — cadastro de "Clientes Avulsos": o painel não
-- é só pra gente de escola, também atende cliente avulso (sem
-- matrícula em nenhuma escola parceira). Decisão do Luiz: cliente
-- avulso NÃO tem login — acesso é só pelo link público do ensaio dele
-- (mesmo padrão do Alboom Proof), então isso aqui é só um cadastro
-- leve (nome/contato), sem conta em auth.users/perfis. Rodar depois
-- de 001 a 034. Aditiva.
-- ════════════════════════════════════════════════════════════════

create table if not exists clientes_avulsos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  observacao text,
  criado_em timestamptz not null default now()
);
alter table clientes_avulsos enable row level security;

create policy clientes_avulsos_admin_all on clientes_avulsos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
grant select, insert, update, delete on clientes_avulsos to authenticated;

-- liga um ensaio avulso a um cliente avulso (opcional) — é o que
-- transforma o link público existente (link_token, 019) no mecanismo
-- oficial de entrega das fotos pra quem não tem login nenhum no painel.
alter table eventos add column if not exists cliente_avulso_id uuid references clientes_avulsos(id) on delete set null;
