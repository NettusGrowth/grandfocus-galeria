# Contratações e experiências fotográficas

Módulo da galeria Grand Focus para criar páginas públicas de contratação, configurar experiências fotográficas e acompanhar pedidos e pagamentos.

## Estado verificado em 04/11/2026

- A campanha entre-estacoes existe no banco e está marcada como publicado.
- As Edge Functions de produção são contratacao-publica v6, contratacao-webhook v3 e contratacao-admin v4.
- A implantação de produção do Vercel ainda aponta para o commit 90d54ce4088e548862281324699ebdefa2167882, de 28/10/2026. As alterações do PR #10 ainda não estão no site de produção.
- O PR #10 está em rascunho na branch feature/grandfocus-branding-package-explainer. Ele reúne identidade visual, explicação das experiências, proteção do checkout e o novo gerenciador reutilizável.
- A migration 083_contratacao_gerenciador_dinamico.sql está no PR e ainda não foi aplicada ao banco de produção.
- Nenhum secret foi alterado e nenhum checkout ou pagamento real foi criado durante o desenvolvimento.
- Existe um pedido anterior preservado como aguardando pagamento, sem URL de checkout salva e sem confirmação de pagamento.

## Novo fluxo administrativo preparado no PR #10

O menu principal da galeria passa a ter a área **Contratações e experiências**, que abre o gerenciador central.

O fluxo para criar uma nova campanha será único.

1. Escolher uma escola já cadastrada na galeria.
2. Informar o nome e a data do evento.
3. Confirmar o endereço público da contratação.
4. Criar o evento da galeria e a contratação vinculada na mesma transação.
5. Abrir a configuração da campanha e cadastrar as experiências, valores, descrições, horários, prazos e textos legais.
6. Salvar como rascunho, revisar e publicar quando as configurações e a integração de pagamento estiverem liberadas.

A criação do evento e da contratação usa uma única função transacional do PostgreSQL. Se qualquer etapa falhar, as duas inserções são desfeitas. O gerenciador não cria uma nova escola; ele vincula o evento a uma escola já cadastrada na galeria.

## Experiências configuráveis

O editor deixa de depender dos três itens fixos de Entre Estações. Cada campanha poderá ter até 20 experiências, cada uma com nome, descrição, preço, disponibilidade e indicação de quais itens inclui.

As experiências podem incluir miniensaio, fotografias de palco ou outros formatos compatíveis com o formulário. Campanhas sem miniensaio não precisam preencher horários ou capacidade de miniensaio.

Para preservar o histórico, uma experiência que já aparece em pedidos não pode ter seus dados comerciais alterados. Ela pode ser desativada, e uma nova experiência pode ser criada no lugar.

## Rotas preparadas

- /contratar/admin/ lista as campanhas e cria evento e contratação.
- /contratar/:slug/admin/ configura uma campanha e consulta seus pedidos.
- /contratar/:slug/ é a página pública da campanha.

As rotas dinâmicas usam a página Entre Estações como modelo estático, mas a página e as APIs resolvem os dados pelo slug da URL. A campanha entre-estacoes continua usando o mesmo endereço.

## Arquitetura

- contratar/admin/ contém a listagem central e o formulário de criação.
- contratar/entre-estacoes/ contém o modelo da página pública e seus estilos.
- contratar/entre-estacoes/admin/ contém o editor reutilizável de campanha.
- supabase/functions/contratacao-publica/ carrega os dados da campanha pelo slug, registra pedidos e solicita checkouts.
- supabase/functions/contratacao-admin/ valida a sessão administrativa, lista campanhas e escolas, cria campanhas e limita cada ação de pedido à campanha selecionada.
- supabase/functions/contratacao-webhook/ reconfirma os pagamentos com payment_check antes de atualizar pedidos.
- supabase/sql/083_contratacao_gerenciador_dinamico.sql cria o evento e a contratação na mesma transação, amplia os códigos de experiência e atualiza as regras de configuração e publicação.
- scripts/build-gallery.cjs copia as páginas e valida que o gerenciador central também foi incluído em dist/.

## Segurança de pagamentos

A InfinitePay não oferece ambiente sandbox. Criar um link pela API gera um checkout real.

A branch do PR #10 implementa a verificação efetiva do secret CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS. Sem esse secret configurado como true, a API pública bloqueia a criação de pedidos e a API administrativa não publica campanhas. O valor padrão é bloqueado.

**Não ativar esse secret nem implantar as funções com pagamentos reais sem autorização expressa.** Antes de qualquer ativação, confirmar Checkout Integrado, API Key, InfiniteTag, token do webhook, dados contratuais e campanha.

A criação de checkout também depende de INFINITEPAY_API_KEY, CONTRATACAO_WEBHOOK_TOKEN e da InfiniteTag configurada. Esses valores devem permanecer somente nos secrets do Supabase. Nunca devem ser colocados no HTML, no JavaScript público ou no Git.

O checkout assina somente os eventos paid e settled. Esses eventos só confirmam o pedido quando /payment_check retorna success=true e paid=true. Notificações de estorno, cancelamento ou falha não devem ser tratadas como aprovação.

- Sem confirmação de pagamento, o pedido permanece pendente.
- A API da InfinitePay não executa estornos. O estorno deve ser feito no App ou na Conta Web InfinitePay e registrado no painel após conferência.
- O webhook usa um token secreto e não depende de JWT Supabase.
- A API pública aplica limites de tentativas e campo honeypot.
- O painel não devolve hashes privados de acesso, idempotência ou requisição.
- O aceite preserva cópias e hashes SHA-256 dos termos e da política de privacidade exibidos no momento da contratação.

## Publicação e implantação

A publicação de produção ainda não foi autorizada nem executada.

Ordem necessária antes de disponibilizar o gerenciador:

1. Revisar o PR #10 e aguardar os testes de CI.
2. Autorizar e aplicar a migration 083_contratacao_gerenciador_dinamico.sql no Supabase.
3. Publicar as Edge Functions atualizadas com as opções de JWT definidas em supabase/config.toml.
   - contratacao-publica com verify_jwt=false.
   - contratacao-webhook com verify_jwt=false.
   - contratacao-admin com verify_jwt=true.
4. Confirmar os secrets e a configuração da InfinitePay sem expor seus valores.
5. Validar o build e a implantação do Vercel.
6. Testar a navegação, o cadastro de evento e contratação, a edição das experiências e a página pública com pagamentos reais ainda bloqueados.
7. Somente após autorização expressa, avaliar a ativação do checkout real.

A migration 083 não deve ser executada antes da revisão. A atualização das Edge Functions e do site também não deve ser considerada concluída enquanto os respectivos serviços não confirmarem a implantação.

## Verificações automatizadas

O workflow de CI verifica scripts, build estático, testes de navegador Chromium com checkout simulado, regras de reserva em PostgreSQL temporário e deno check das Edge Functions. Os testes não criam cobranças na InfinitePay.

Não executar compra real como teste sem autorização expressa.
