# Contratação de experiências fotográficas

Módulo isolado da galeria Grand Focus. A página pública fica em
https://galeria.grandfocus.com.br/contratar/entre-estacoes/ e a administração em
https://galeria.grandfocus.com.br/contratar/entre-estacoes/admin/.

## Estado desta implementação

- Código preparado na branch feature/contratacao-experiencias.
- A migration 080_contratacao_experiencias.sql ainda não foi executada no Supabase.
- As Edge Functions contratacao-publica, contratacao-webhook e contratacao-admin ainda não foram publicadas.
- Nenhum domínio, DNS, configuração de produção ou arquivo principal da galeria foi alterado.
- Nenhum link de pagamento foi criado e nenhuma cobrança foi realizada.
- A campanha entre-estacoes nasce como rascunho. Horários, local, capacidade, prazos, fornecedor e termos não são presumidos.

## Rotas e arquivos

- contratar/entre-estacoes/ contém a página pública, CSS e JavaScript próprios.
- contratar/entre-estacoes/admin/ contém a administração independente.
- supabase/functions/contratacao-publica/ recebe dados públicos, cria reservas e gera o checkout.
- supabase/functions/contratacao-webhook/ reconfirma os pagamentos com /payment_check antes de atualizar pedidos.
- supabase/functions/contratacao-admin/ valida a sessão e o perfil administrativo.
- supabase/functions/_shared/contratacao.ts concentra os helpers da integração.
- scripts/build-gallery.cjs copia a pasta contratar/ para dist/ sem reescrever o index.html de origem.

## Configuração necessária antes de publicar

1. Aplicar a migration 080 somente depois de revisar e autorizar a alteração do banco.
2. Publicar as três Edge Functions com estas opções de JWT.
   - contratacao-publica com verify_jwt=false.
   - contratacao-webhook com verify_jwt=false.
   - contratacao-admin com verify_jwt=true.
3. Configurar INFINITEPAY_API_KEY como secret do Supabase. Nunca colocar essa chave no HTML, JavaScript público ou Git.
4. A função tenta obter a InfiniteTag da configuração existente selecao_config. Se não estiver preenchida ali, configurar INFINITEPAY_HANDLE como secret.
5. O domínio oficial já é permitido por padrão. Para um domínio adicional de homologação, usar CONTRATACAO_ALLOWED_ORIGINS.
6. A página administrativa deve ser usada por uma conta com perfil admin ou super_admin.

## Proteção contra cobranças acidentais

A InfinitePay informa que o Checkout Integrado não oferece ambiente sandbox. Criar um link pela API gera um checkout real.

Por isso, a função pública exige também o secret CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS=true antes de criar qualquer reserva ou link. Sem essa ativação, a solicitação é bloqueada antes de gravar o pedido. Manter esse secret ausente ou diferente de true durante desenvolvimento e homologação.

A ativação desse secret deve ocorrer somente após autorização expressa para iniciar cobranças reais e depois de confirmar a conta InfinitePay, API Key, handle, dados contratuais e campanha.

Documentação oficial InfinitePay
https://www.infinitepay.io/checkout-documentacao

## Publicação da campanha

A administração permite configurar data, local, período do miniensaio, duração estimada, capacidade, encerramento das vendas, duração da reserva, prazo de entrega, contato, dados do fornecedor, termos, privacidade e pacotes.

A RPC de publicação recusa a campanha enquanto faltar informação obrigatória. Ela também valida que o encerramento das vendas seja anterior ao início do miniensaio e que o prazo do checkout esteja dentro do limite aceito pela InfinitePay.

O evento cadastrado no banco foi conferido como Entre Estações, da Studio Entrepliés, em 07/11/2026. O horário e o local do miniensaio ainda precisam ser confirmados.

## Verificações

O workflow de CI verifica a sintaxe dos scripts, executa o build estático e faz deno check das novas Edge Functions. O build confirma que as duas páginas de contratação foram copiadas para dist/.

Não executar compra real como teste sem autorização expressa.
