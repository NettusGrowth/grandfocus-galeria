-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 8: Seleção de Fotos & Extras (venda de
-- fotos excedentes em ensaios avulsos/eventos). Rodar depois de 001 a
-- 024. Aditiva.
--
-- Arquitetura: mesmo padrão do link privado (Bloco 4) — as tabelas
-- base NUNCA são lidas diretamente por anon/authenticated fora da
-- equipe; o cliente público só acessa via RPC SECURITY DEFINER chamada
-- de dentro de uma Edge Function com a service role key (ver
-- supabase/functions/selecao-publica/index.ts). Isso é o que garante
-- o requisito "a URL em alta resolução nunca pode vazar pro client
-- antes da liberação" — a foto em alta nem tem policy de storage
-- pública em NENHUM momento, só é assinada (signed URL, 1h) dentro da
-- própria Edge Function, e só depois de conferir que o pedido está
-- 'liberado'.
-- ════════════════════════════════════════════════════════════════

create table if not exists selecao_galerias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  destinatario_tipo text not null check (destinatario_tipo in ('aluno','pai','professor','avulso')),
  destinatario_id uuid, -- aponta pra alunos.id ou perfis.user_id conforme o tipo; sem FK porque varia de tabela (mesmo motivo de posts.turma não ter FK)
  cliente_nome text not null,
  cliente_whatsapp text,
  qtd_incluida int not null default 0 check (qtd_incluida >= 0),
  preco_extra numeric(10,2) not null default 0 check (preco_extra >= 0),
  token text unique not null,
  senha_hash text,
  status text not null default 'ativa' check (status in ('ativa','enviada','concluida','expirada')),
  expira_em timestamptz,
  criado_por uuid references perfis(user_id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_selecao_galerias_token on selecao_galerias(token);

create table if not exists selecao_fotos (
  id uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references selecao_galerias(id) on delete cascade,
  storage_path text not null,      -- versão leve com marca d'água (a única que o cliente público vê)
  storage_path_alta text not null, -- original — só sai por signed URL, só depois de liberado
  ordem int not null default 0
);
create index if not exists idx_selecao_fotos_galeria on selecao_fotos(galeria_id);

-- 1 pedido por galeria: reenviar a seleção faz upsert nele (mesmo
-- registro), não cria linhas novas — é o que permite sincronizar entre
-- celular e computador (o RPC de dados públicos devolve esse pedido
-- junto, o client carrega o que já tinha marcado antes).
create table if not exists selecao_pedidos (
  id uuid primary key default gen_random_uuid(),
  galeria_id uuid not null unique references selecao_galerias(id) on delete cascade,
  foto_ids uuid[] not null default '{}',
  qtd_selecionada int not null default 0,
  qtd_incluida int not null default 0,
  qtd_extra int not null default 0,
  preco_unit_extra numeric(10,2) not null default 0,
  valor_total numeric(10,2) not null default 0,
  status text not null default 'rascunho' check (status in ('rascunho','enviado','pago','liberado','cancelado')),
  observacoes text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  liberado_em timestamptz,
  liberado_por uuid references perfis(user_id) on delete set null
);

-- config única do estúdio pra instrução de pagamento (chave PIX) — não
-- é por galeria, é uma constante do negócio. Singleton via check.
create table if not exists selecao_config (
  id boolean primary key default true check (id),
  pix_chave text,
  pix_nome text,
  pix_qrcode_url text
);
insert into selecao_config (id) values (true) on conflict (id) do nothing;

alter table selecao_galerias enable row level security;
alter table selecao_fotos enable row level security;
alter table selecao_pedidos enable row level security;
alter table selecao_config enable row level security;

-- só a equipe (admin/super_admin) mexe direto nessas tabelas — é
-- recurso comercial do estúdio, não por escola/turma como o resto do
-- app. O cliente público nunca lê essas tabelas via REST, só via RPC.
create policy selecao_galerias_admin on selecao_galerias for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy selecao_fotos_admin on selecao_fotos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy selecao_pedidos_admin on selecao_pedidos for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
create policy selecao_config_admin on selecao_config for all to authenticated
  using ((select role from meu_perfil()) in ('admin','super_admin'))
  with check ((select role from meu_perfil()) in ('admin','super_admin'));
grant select, insert, update, delete on selecao_galerias, selecao_fotos, selecao_pedidos, selecao_config to authenticated;

-- ── senha da galeria (opcional), mesmo mecanismo bcrypt via pgcrypto
-- já usado em definir_senha_link() ──────────────────────────────────
create or replace function definir_senha_selecao(p_galeria_id uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from meu_perfil()) not in ('admin','super_admin') then
    raise exception 'Sem permissão.';
  end if;
  update selecao_galerias set senha_hash = crypt(p_senha, gen_salt('bf')) where id = p_galeria_id;
end;
$$;
grant execute on function definir_senha_selecao(uuid, text) to authenticated;

-- ── RPC pública 1: carregar a galeria (SÓ fotos leve + config
-- comercial + pedido existente, se houver, pra sincronizar entre
-- aparelhos). NUNCA devolve storage_path_alta. ──────────────────────
create or replace function selecao_publica_dados(p_token text, p_senha text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gal record;
  v_pedido record;
  v_fotos json;
  v_pix record;
begin
  select * into v_gal from selecao_galerias where token = p_token;
  if v_gal.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if v_gal.senha_hash is not null and (p_senha is null or crypt(p_senha, v_gal.senha_hash) <> v_gal.senha_hash) then
    raise exception 'Senha incorreta.';
  end if;
  if v_gal.status = 'expirada' or (v_gal.expira_em is not null and v_gal.expira_em < now()) then
    raise exception 'Essa galeria expirou.';
  end if;

  select json_agg(json_build_object('id', id, 'storage_path', storage_path, 'ordem', ordem) order by ordem)
  into v_fotos from selecao_fotos where galeria_id = v_gal.id;

  select * into v_pedido from selecao_pedidos where galeria_id = v_gal.id;
  select * into v_pix from selecao_config where id = true;

  return json_build_object(
    'galeria', json_build_object(
      'id', v_gal.id, 'titulo', v_gal.titulo, 'cliente_nome', v_gal.cliente_nome,
      'qtd_incluida', v_gal.qtd_incluida, 'preco_extra', v_gal.preco_extra, 'status', v_gal.status
    ),
    'fotos', coalesce(v_fotos, '[]'::json),
    'pedido', case when v_pedido.id is null then null else json_build_object(
      'foto_ids', v_pedido.foto_ids, 'status', v_pedido.status, 'valor_total', v_pedido.valor_total,
      'qtd_extra', v_pedido.qtd_extra, 'observacoes', v_pedido.observacoes
    ) end,
    'pix', json_build_object('chave', v_pix.pix_chave, 'nome', v_pix.pix_nome, 'qrcode_url', v_pix.pix_qrcode_url)
  );
end;
$$;
grant execute on function selecao_publica_dados(text, text) to anon, authenticated;

-- ── RPC pública 2: registrar/atualizar o pedido. Revalida TUDO contra
-- o que está gravado na galeria (qtd_incluida/preco_extra) — o valor
-- que o client mandar é ignorado, o total é sempre recalculado aqui
-- dentro. Isso é o que impede alguém de adulterar o preço no
-- navegador antes de enviar. ─────────────────────────────────────────
create or replace function selecao_registrar_pedido(p_token text, p_senha text, p_foto_ids uuid[], p_observacoes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gal record;
  v_qtd_valida int;
  v_qtd_sel int;
  v_qtd_extra int;
  v_total numeric(10,2);
begin
  select * into v_gal from selecao_galerias where token = p_token;
  if v_gal.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if v_gal.senha_hash is not null and (p_senha is null or crypt(p_senha, v_gal.senha_hash) <> v_gal.senha_hash) then
    raise exception 'Senha incorreta.';
  end if;

  -- só aceita ids de fotos que realmente pertencem a essa galeria —
  -- sem isso, alguém poderia mandar um array de IDs inventado.
  select count(*) into v_qtd_valida from selecao_fotos where galeria_id = v_gal.id and id = any(p_foto_ids);
  if v_qtd_valida <> coalesce(array_length(p_foto_ids, 1), 0) then
    raise exception 'Seleção inválida — alguma foto não pertence a essa galeria.';
  end if;

  v_qtd_sel := coalesce(array_length(p_foto_ids, 1), 0);
  v_qtd_extra := greatest(0, v_qtd_sel - v_gal.qtd_incluida);
  v_total := v_qtd_extra * v_gal.preco_extra;

  insert into selecao_pedidos (galeria_id, foto_ids, qtd_selecionada, qtd_incluida, qtd_extra, preco_unit_extra, valor_total, status, observacoes, enviado_em)
  values (v_gal.id, p_foto_ids, v_qtd_sel, v_gal.qtd_incluida, v_qtd_extra, v_gal.preco_extra, v_total, 'enviado', p_observacoes, now())
  on conflict (galeria_id) do update set
    foto_ids = excluded.foto_ids, qtd_selecionada = excluded.qtd_selecionada,
    qtd_incluida = excluded.qtd_incluida, qtd_extra = excluded.qtd_extra,
    preco_unit_extra = excluded.preco_unit_extra, valor_total = excluded.valor_total,
    status = case when selecao_pedidos.status in ('pago','liberado') then selecao_pedidos.status else 'enviado' end,
    observacoes = excluded.observacoes, enviado_em = now();

  update selecao_galerias set status = 'enviada' where id = v_gal.id and status = 'ativa';

  return json_build_object('qtd_selecionada', v_qtd_sel, 'qtd_incluida', v_gal.qtd_incluida, 'qtd_extra', v_qtd_extra, 'valor_total', v_total);
end;
$$;
grant execute on function selecao_registrar_pedido(text, text, uuid[], text) to anon, authenticated;

-- ── RPC pública 3: só devolve os caminhos em alta se o pedido já
-- estiver 'liberado' — a Edge Function usa isso pra saber SE pode
-- gerar as signed URLs, nunca gera antes de checar aqui. ────────────
create or replace function selecao_download_liberado(p_token text, p_senha text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gal record;
  v_pedido record;
  v_paths json;
begin
  select * into v_gal from selecao_galerias where token = p_token;
  if v_gal.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if v_gal.senha_hash is not null and (p_senha is null or crypt(p_senha, v_gal.senha_hash) <> v_gal.senha_hash) then
    raise exception 'Senha incorreta.';
  end if;

  select * into v_pedido from selecao_pedidos where galeria_id = v_gal.id;
  if v_pedido.id is null or v_pedido.status <> 'liberado' then
    raise exception 'Ainda não liberado.';
  end if;

  select json_agg(json_build_object('id', id, 'storage_path_alta', storage_path_alta) order by ordem)
  into v_paths from selecao_fotos where galeria_id = v_gal.id and id = any(v_pedido.foto_ids);

  return json_build_object('fotos', coalesce(v_paths, '[]'::json));
end;
$$;
grant execute on function selecao_download_liberado(text, text) to anon, authenticated;

-- ── liberar pagamento (equipe, painel admin) ────────────────────────
create or replace function selecao_liberar_pedido(p_galeria_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from meu_perfil()) not in ('admin','super_admin') then
    raise exception 'Sem permissão.';
  end if;
  update selecao_pedidos set status = 'liberado', liberado_em = now(), liberado_por = auth.uid()
  where galeria_id = p_galeria_id;
  update selecao_galerias set status = 'concluida' where id = p_galeria_id;
end;
$$;
grant execute on function selecao_liberar_pedido(uuid) to authenticated;
