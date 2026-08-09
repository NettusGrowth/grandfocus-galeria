-- ════════════════════════════════════════════════════════════════
-- GALERIA GRAND FOCUS — Bloco 11: desconto progressivo por faixa de
-- fotos extras na Seleção de Fotos. Hoje `preco_extra` é um valor único
-- (toda foto extra custa o mesmo); isso adiciona `faixas_preco` (jsonb,
-- opcional) com faixas tipo [{"ate":5,"preco":15},{"ate":10,"preco":12},
-- {"ate":null,"preco":10}] — "ate":null = "daqui pra cima". O preço é
-- MARGINAL por faixa (cada unidade só custa o preço da faixa em que ela
-- cai, não a faixa mais cara aplicada em tudo) — é o modelo padrão de
-- desconto progressivo e bate com o exemplo que o Luiz mandou (1-5 a
-- R$15, 6-10 a R$12, 11+ a R$10 -> 12 fotos extras = 5×15 + 5×12 + 2×10).
--
-- `preco_extra` continua existindo e é o fallback quando `faixas_preco`
-- é null/vazio (galeria antiga sem faixa configurada nunca muda de
-- comportamento, nem pedido já enviado é recalculado retroativamente).
-- Rodar depois de 001 a 037. Aditiva.
-- ════════════════════════════════════════════════════════════════

alter table selecao_galerias add column if not exists faixas_preco jsonb;

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

  select json_agg(json_build_object('id', id, 'storage_path', storage_path, 'ordem', ordem) order by ordem)
  into v_fotos from selecao_fotos where galeria_id = v_gal.id;

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
      'foto_ids', v_pedido.foto_ids, 'status', v_pedido.status, 'valor_total', v_pedido.valor_total,
      'qtd_extra', v_pedido.qtd_extra, 'observacoes', v_pedido.observacoes
    ) end,
    'pix', json_build_object('chave', v_pix.pix_chave, 'nome', v_pix.pix_nome, 'qrcode_url', v_pix.pix_qrcode_url)
  );
end;
$$;

-- calcula o total marginal por faixa — reaproveitada pelo registro do
-- pedido (abaixo) e futuramente por qualquer outro ponto que precise do
-- mesmo cálculo (ex.: liberação automática por webhook, Estágio 3).
create or replace function _selecao_calcular_total(p_faixas jsonb, p_preco_flat numeric, p_qtd_extra int)
returns numeric
language plpgsql
immutable
as $$
declare
  v_faixa jsonb;
  v_ate int;
  v_preco numeric;
  v_anterior int := 0;
  v_restante int := p_qtd_extra;
  v_nesta_faixa int;
  v_total numeric := 0;
begin
  if p_qtd_extra <= 0 then return 0; end if;
  if p_faixas is null or jsonb_array_length(p_faixas) = 0 then
    return p_qtd_extra * p_preco_flat;
  end if;
  for v_faixa in select * from jsonb_array_elements(p_faixas) order by (value->>'ate') is null, (value->>'ate')::int loop
    exit when v_restante <= 0;
    v_ate := (v_faixa->>'ate')::int;
    v_preco := (v_faixa->>'preco')::numeric;
    v_nesta_faixa := case when v_ate is null then v_restante else least(v_restante, greatest(0, v_ate - v_anterior)) end;
    v_total := v_total + v_nesta_faixa * v_preco;
    v_restante := v_restante - v_nesta_faixa;
    v_anterior := coalesce(v_ate, v_anterior + v_nesta_faixa);
  end loop;
  return v_total;
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

  select count(*) into v_qtd_valida from selecao_fotos where galeria_id = v_gal.id and id = any(p_foto_ids);
  if v_qtd_valida <> coalesce(array_length(p_foto_ids, 1), 0) then
    raise exception 'Seleção inválida — alguma foto não pertence a essa galeria.';
  end if;

  v_qtd_sel := coalesce(array_length(p_foto_ids, 1), 0);
  v_qtd_extra := greatest(0, v_qtd_sel - v_gal.qtd_incluida);
  -- único ponto que decide o valor cobrado — sempre a partir do que está
  -- salvo na galeria (faixas ou preço fixo), nunca de nada que o client
  -- mande; é isso que impede adulteração no navegador.
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
