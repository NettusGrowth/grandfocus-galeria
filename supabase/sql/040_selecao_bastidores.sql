-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 11: Bastidores/Brinde na Seleção de
-- Fotos. Fotos marcadas como `bonus` ficam de fora da seleção paga (o
-- cliente nem vê elas na hora de escolher, não contam em qtd_extra nem
-- no total) e só aparecem, sempre grátis, na tela de entrega — junto
-- com as fotos que ele efetivamente pagou. Rodar depois de 001 a 039.
-- Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_fotos add column if not exists bonus boolean not null default false;

create or replace function selecao_publica_dados(p_token text, p_senha text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
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
    raise exception 'Esta galeria de seleção expirou em %. Entre em contato com o estúdio para reativar o acesso.', to_char(v_gal.expira_em, 'DD/MM/YYYY');
  end if;

  -- bastidores/brinde ficam de fora da tela de seleção de propósito —
  -- só aparecem depois de liberado, via selecao_download_liberado().
  select json_agg(json_build_object('id', id, 'storage_path', storage_path, 'ordem', ordem) order by ordem)
  into v_fotos from selecao_fotos where galeria_id = v_gal.id and not bonus;

  select * into v_pedido from selecao_pedidos where galeria_id = v_gal.id;
  select * into v_pix from selecao_config where id = true;

  return json_build_object(
    'galeria', json_build_object(
      'id', v_gal.id, 'titulo', v_gal.titulo, 'cliente_nome', v_gal.cliente_nome,
      'qtd_incluida', v_gal.qtd_incluida, 'preco_extra', v_gal.preco_extra,
      'faixas_preco', v_gal.faixas_preco, 'status', v_gal.status
    ),
    'fotos', coalesce(v_fotos, '[]'::json),
    'pedido', case when v_pedido.id is null then null else json_build_object(
      'id', v_pedido.id, 'foto_ids', v_pedido.foto_ids, 'status', v_pedido.status, 'valor_total', v_pedido.valor_total,
      'qtd_extra', v_pedido.qtd_extra, 'observacoes', v_pedido.observacoes
    ) end,
    'pix', json_build_object('chave', v_pix.pix_chave, 'nome', v_pix.pix_nome, 'qrcode_url', v_pix.pix_qrcode_url),
    'pagamento_automatico', (v_pix.infinitepay_handle is not null and v_pix.infinitepay_handle <> '')
  );
end;
$$;

create or replace function selecao_registrar_pedido(p_token text, p_senha text, p_foto_ids uuid[], p_observacoes text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
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
  if v_gal.status = 'expirada' or (v_gal.expira_em is not null and v_gal.expira_em < now()) then
    raise exception 'Esta galeria de seleção expirou em %. Entre em contato com o estúdio para reativar o acesso.', to_char(v_gal.expira_em, 'DD/MM/YYYY');
  end if;

  -- "and not bonus" — mesmo que alguém tente mandar o id de uma foto de
  -- bastidores no corpo da requisição, ela não conta como válida aqui
  -- (bastidor nunca é "selecionável", é liberado à parte, de graça).
  select count(*) into v_qtd_valida from selecao_fotos where galeria_id = v_gal.id and id = any(p_foto_ids) and not bonus;
  if v_qtd_valida <> coalesce(array_length(p_foto_ids, 1), 0) then
    raise exception 'Seleção inválida — alguma foto não pertence a essa galeria.';
  end if;

  v_qtd_sel := coalesce(array_length(p_foto_ids, 1), 0);
  v_qtd_extra := greatest(0, v_qtd_sel - v_gal.qtd_incluida);
  v_total := _selecao_calcular_total(v_gal.faixas_preco, v_gal.preco_extra, v_qtd_extra);

  insert into selecao_pedidos (galeria_id, foto_ids, qtd_selecionada, qtd_incluida, qtd_extra, preco_unit_extra, valor_total, status, observacoes, enviado_em)
  values (v_gal.id, p_foto_ids, v_qtd_sel, v_gal.qtd_incluida, v_qtd_extra, v_gal.preco_extra, v_total, 'enviado', p_observacoes, now())
  on conflict (galeria_id) do update set
    foto_ids = excluded.foto_ids, qtd_selecionada = excluded.qtd_selecionada,
    qtd_incluida = excluded.qtd_incluida, qtd_extra = excluded.qtd_extra,
    preco_unit_extra = excluded.preco_unit_extra, valor_total = excluded.valor_total,
    status = case when selecao_pedidos.status in ('pago','liberado') then selecao_pedidos.status else 'enviado' end,
    observacoes = excluded.observacoes, enviado_em = now();

  update selecao_galerias set status = 'enviada' where id = v_gal.id and status = 'ativa';

  insert into auditoria (user_id, user_nome, acao, tabela, registro_id, detalhe)
  values (null, v_gal.cliente_nome, 'enviou pedido de fotos extras — R$ ' || to_char(v_total, 'FM999999990.00'), 'selecao_galerias', v_gal.id, v_gal.titulo);

  return json_build_object('qtd_selecionada', v_qtd_sel, 'qtd_incluida', v_gal.qtd_incluida, 'qtd_extra', v_qtd_extra, 'valor_total', v_total);
end;
$$;

-- devolve as fotos pagas (do pedido) E, separado, os bastidores/brinde
-- da galeria inteira (sempre grátis, sempre liberados junto) — os dois
-- em alta resolução, só depois do pedido estar 'liberado'.
create or replace function selecao_download_liberado(p_token text, p_senha text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_gal record;
  v_pedido record;
  v_paths json;
  v_bastidores json;
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

  select json_agg(json_build_object('id', id, 'storage_path_alta', storage_path_alta) order by ordem)
  into v_bastidores from selecao_fotos where galeria_id = v_gal.id and bonus;

  return json_build_object('fotos', coalesce(v_paths, '[]'::json), 'bastidores', coalesce(v_bastidores, '[]'::json));
end;
$$;
