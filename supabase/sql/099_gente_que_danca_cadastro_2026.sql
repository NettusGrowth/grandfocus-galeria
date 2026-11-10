-- Gente que Dança: cadastro operacional idempotente, em rascunho.
-- Os termos só prometem o que está efetivamente pactuado com a escola.
do $gente$
declare school_id uuid;event_id uuid;campaign_id uuid;
 provider public.gf_contratacao_eventos%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext('gf_gente_que_danca_cadastro_2026'));
 select id into school_id from public.escolas
 where lower(btrim(nome))=lower('Gente que Dança')
 order by criado_em asc limit 1;
 if school_id is null then
  insert into public.escolas(nome,descricao)
  values('Gente que Dança','Escola parceira da experiência fotográfica de 15/12/2026; participação opcional, contratação e atendimento pela Grand Focus.')
  returning id into school_id;
 end if;
 select id into event_id from public.eventos
 where escola_id=school_id and data=date '2026-12-15'
 and nome='Experiência Fotográfica · Gente que Dança'
 limit 1;
 if event_id is null then
  insert into public.eventos(nome,data,escola_id,tipo)
  values('Experiência Fotográfica · Gente que Dança','2026-12-15',school_id,'evento')
  returning id into event_id;
 end if;
 select * into provider from public.gf_contratacao_eventos where slug='natal-fada-acucarada-2026';
 if provider.id is null or nullif(btrim(provider.fornecedor_documento),'') is null
 then raise exception 'Os dados de fornecedor Grand Focus não estão cadastrados.';end if;
 select id into campaign_id from public.gf_contratacao_eventos
 where slug='gente-que-danca-2026' for update;
 if campaign_id is null then
  insert into public.gf_contratacao_eventos(
   evento_id,escola_id,slug,nome_publico,status,local,data_evento,
   duracao_minutos,reserva_minutos,vendas_encerram_em,
   whatsapp_atendimento,termos_versao,termos_conteudo,
   privacidade_url,privacidade_versao,privacidade_conteudo,
   fornecedor_nome,fornecedor_documento,fornecedor_endereco,fornecedor_email,
   formulario_modelo,formulario_versao
  ) values (
   event_id,school_id,'gente-que-danca-2026',
   'Experiência Fotográfica · Gente que Dança 2026','rascunho',
   'Escola Gente que Dança','2026-12-15',5,15,
   make_timestamptz(2026,12,15,18,0,0,'America/Sao_Paulo'),
   provider.whatsapp_atendimento,
   '2026-11-10',
   $gf_terms$Quem organiza
A experiência será oferecida pela Grand Focus Fotografia, CNPJ 69.691.249/0001-97, em parceria com a Escola Gente que Dança. A escola disponibiliza o espaço e apoia a comunicação, mas não recebe pagamentos em nome da Grand Focus. Atendimento: grandfocusfotografia@gmail.com ou WhatsApp (34) 99263-2922.

Data, local e participação
A ação está prevista para terça-feira, 15 de dezembro de 2026, a partir das 18h, na Escola Gente que Dança. A participação é totalmente opcional. O horário individual, quando houver distribuição de atendimentos, será informado pela equipe. O formulário de interesse não garante um horário individual exclusivo nem reserva automática.

Valor e contratação
O investimento é de R$ 150,00 por criança. A inscrição pode contemplar de uma a quatro crianças da mesma família. O total mostrado equivale a R$ 150,00 multiplicado pela quantidade informada. O preenchimento representa solicitação de participação e não constitui pagamento nem confirmação definitiva. A Grand Focus entrará em contato diretamente com a família para orientar a contratação e confirmar o recebimento.

Pagamento
As opções indicadas são Pix e cartão de crédito. Eventuais taxas da operadora e condições de parcelamento devem ser informadas antes da operação, sem cobrança automática pelo formulário. A escola não é responsável pelo pagamento ou sua cobrança. Nenhum dado de cartão é solicitado neste site.

Fotografias, entrega e mudanças
A Grand Focus organizará a equipe, realizará a sessão, selecionará, tratará e entregará os arquivos nas condições comunicadas à família antes da confirmação. O acordo com a escola não estabelece número exato de fotografias, duração individual ou prazo fechado de entrega; esses elementos devem ser informados na contratação particular, sem promessa presumida neste formulário. Se houver alteração de data ou formato, a Grand Focus entrará em contato com as famílias envolvidas.

Direitos e cancelamento
A contratação observará o Código de Defesa do Consumidor, inclusive o direito de arrependimento nas hipóteses legais de contratação fora do estabelecimento. Solicitações de cancelamento, correção ou reembolso devem ser encaminhadas à Grand Focus pelo atendimento. Não há autorização automática de uso das fotografias em publicidade, redes sociais ou portfólio.

Crianças e privacidade
A inscrição de menores exige responsável legal ou pessoa devidamente autorizada. Os dados são usados exclusivamente para organizar a experiência, entrar em contato, conferir o pagamento e entregar as fotografias. O uso publicitário de imagens exige autorização específica e separada, quando aplicável. Consulte a Política de Privacidade.$gf_terms$,
   'https://galeria.grandfocus.com.br/contratar/gente-que-danca/privacidade.html',
   '2026-11-10',
   $gf_privacy$Quem trata os dados
A Grand Focus Fotografia, CNPJ 69.691.249/0001-97, é a responsável pelo tratamento dos dados relativos à contratação e execução da experiência fotográfica. Contato: grandfocusfotografia@gmail.com ou WhatsApp (34) 99263-2922.

Quais dados e para quê
O formulário solicita nome e WhatsApp do responsável, nomes das crianças, quantidade de participantes, preferência de pagamento e aceites. Os dados são necessários para responder ao interesse, organizar o ensaio, orientar o pagamento e entregar as fotografias. Logs técnicos proporcionais poderão ser processados para prevenir abusos e duplicidades. Preferência de pagamento não é confirmação de pagamento.

Crianças e imagens
Os dados de menores são tratados respeitando o seu melhor interesse. Responsáveis podem solicitar correções e informações. Fotografias podem ser dados pessoais; sua disponibilização deve seguir controles de acesso e a comprovação da relação com o aluno. O preenchimento não autoriza divulgação em redes sociais ou portfólio.

Compartilhamentos
Os dados serão acessados pela equipe da Grand Focus e, se estritamente necessário à organização da experiência, pela equipe da escola parceira. Fornecedores de infraestrutura e armazenamento técnico podem processar as informações para prestar os serviços contratados. Não vendemos cadastros nem fotografias.

Conservação e direitos
Os registros serão mantidos pelo período necessário à prestação da experiência, cumprimento de obrigações legais e defesa de direitos; após isso, serão eliminados ou anonimizados quando cabível. Titulares e responsáveis podem solicitar acesso, correção, informações sobre compartilhamento e demais direitos legais pelo e-mail de contato, mediante identificação apropriada.

Segurança e atualizações
Adotamos medidas de proteção adequadas aos dados pessoais e não solicitamos cartão ou senha neste formulário. Esta política poderá ser atualizada, preservando o registro da versão aceita quando aplicável.$gf_privacy$,
   provider.fornecedor_nome,provider.fornecedor_documento,
   provider.fornecedor_endereco,provider.fornecedor_email,
   jsonb_build_object('aparencia',jsonb_build_object(
    'cor','#4B0416','fundo','#F8F3F2',
    'titulo','Uma experiência especial para guardar.',
    'introducao','Experiência fotográfica em 15/12/2026, a partir das 18h, na Escola Gente que Dança. Participação opcional, R$150 por criança. Atendimento direto pela Grand Focus.'
    ),'perguntas','[]'::jsonb),1
  ) returning id into campaign_id;
 end if;
 if not exists(select 1 from public.gf_contratacao_pacotes
  where evento_contratacao_id=campaign_id and codigo='experiencia-por-crianca') then
  insert into public.gf_contratacao_pacotes(
   evento_contratacao_id,codigo,nome,descricao,preco_centavos,
   inclui_miniensaio,inclui_palco,ativo,ordem)
  values(campaign_id,'experiencia-por-crianca',
   'Experiência Fotográfica · R$ 150 por criança',
   '["Participação opcional","Atendimento e pagamento diretamente com a Grand Focus","Fotografias e entrega nas condições comunicadas individualmente antes da confirmação"]'::jsonb,
   15000,false,false,true,1);
 end if;
 if not exists(select 1 from public.gf_contratacao_auditoria
  where evento_contratacao_id=campaign_id and acao='gente_parceria_2026_registrada') then
  insert into public.gf_contratacao_auditoria(evento_contratacao_id,acao,detalhes)
  values(campaign_id,'gente_parceria_2026_registrada',
    jsonb_build_object('data','2026-12-15','inicio','18:00',
    'valor_por_crianca_centavos',15000,
    'comissao_confirmados',jsonb_build_array(
      jsonb_build_object('min',0,'max',9,'percentual',0),
      jsonb_build_object('min',10,'max',24,'percentual',10),
      jsonb_build_object('min',25,'max',29,'percentual',15),
      jsonb_build_object('min',30,'max',35,'percentual',20)),
    'acima_35','negociacao_escrita','pagamentos','somente Grand Focus'));
 end if;
end $gente$;
