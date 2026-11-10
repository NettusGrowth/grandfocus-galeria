-- Arquivamento reversível das campanhas, sem apagar respostas, pagamentos ou fotos.
alter table public.gf_contratacao_eventos
 add column if not exists oculto_em timestamptz,
 add column if not exists oculto_por uuid references public.perfis(user_id) on delete set null;
create index if not exists gf_contratacao_eventos_ocultos_idx
 on public.gf_contratacao_eventos(oculto_em) where oculto_em is not null;
