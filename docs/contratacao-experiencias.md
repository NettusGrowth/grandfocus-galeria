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
A publicação administrativa também exige que `INFINITEPAY_API_KEY`, InfiniteTag e `CONTRATACAO_WEBHOOK_TOKEN` estejam configurados e válidos. O painel indica a presença de cada item sem expor valores.
2. Publicar as três Edge Functions com estas opções de JWT.
   - contratacao-publica com verify_jwt=false.
   - contratacao-webhook com verify_jwt=false.
   - contratacao-admin com verify_jwt=true.
   Essas opções já estão declaradas em `supabase/config.toml`; use esse arquivo ao publicar as funções para não depender de padrões implícitos.
3. Configurar INFINITEPAY_API_KEY como secret do Supabase. Nunca colocar essa chave no HTML, JavaScript público ou Git.
   O backend usa a secret key moderna do Supabase somente no cabeçalho `apikey` e preserva o JWT de sessão do administrador no `Authorization`. A chave `service_role` antiga permanece como fallback durante a transição.
   Configurar também `CONTRATACAO_WEBHOOK_TOKEN` como 64 caracteres hexadecimais aleatórios. Gere e cadastre esse segredo diretamente no ambiente privado do Supabase, sem o enviar pelo chat.
4. A função tenta obter a InfiniteTag da configuração existente selecao_config. Se não estiver preenchida ali, configurar INFINITEPAY_HANDLE como secret.
5. O domínio oficial já é permitido por padrão. Para um domínio adicional de homologação, usar CONTRATACAO_ALLOWED_ORIGINS.
6. A página administrativa deve ser usada por uma conta com perfil admin ou super_admin.

## Proteção contra cobranças acidentais

A InfinitePay informa que o Checkout Integrado não oferece ambiente sandbox. Criar um link pela API gera um checkout real.

Por isso, a função pública exige também o secret CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS=true antes de criar qualquer reserva ou link. Sem essa ativação, a solicitação é bloqueada antes de gravar o pedido. Manter esse secret ausente ou diferente de true durante desenvolvimento e homologação.

A ativação desse secret deve ocorrer somente após autorização expressa para iniciar cobranças reais e depois de confirmar a conta InfinitePay, API Key, handle, dados contratuais e campanha.

O checkout assina automaticamente somente os eventos `paid` e `settled`. A documentação pública da InfinitePay mostra o corpo de aprovação sem um campo obrigatório que identifique o tipo do evento. Por segurança, não inscrevemos `refunded`, `canceled` ou `payment_failed` até que o formato desses payloads seja confirmado com o provedor. Isso evita tratar uma notificação de estorno como se fosse uma aprovação.

- `paid` e `settled` só confirmam o pedido quando `/payment_check` retorna `success=true` e `paid=true`.
- Sem confirmação de pagamento, o pedido permanece pendente e a reserva temporária termina no prazo configurado.
- A API da InfinitePay não executa estornos. O estorno deve ser realizado no App ou na Conta Web InfinitePay. Depois de conferir a operação, o administrador registra o estorno no painel com motivo e auditoria.
- O webhook continua preparado para registrar uma notificação de `refunded`, `canceled` ou `payment_failed` caso o provedor passe a entregar um discriminador de evento verificável.

Documentação oficial InfinitePay
https://www.infinitepay.io/checkout-documentacao

## Proteção e privacidade
- O webhook usa um token secreto de 32 bytes, codificado em 64 caracteres hexadecimais. Configure `CONTRATACAO_WEBHOOK_TOKEN` nos secrets das Edge Functions do Supabase; o token é enviado na URL de callback e conferido antes de abrir conexão administrativa ou gravar dados.

- A contratação pública aplica limites de tentativas por IP, e-mail e telefone. O banco armazena somente hashes desses identificadores e remove registros antigos após sete dias.
- O formulário inclui um campo honeypot para descartar envios automatizados simples. Isso reduz abuso básico, mas não substitui um desafio gerenciado como Cloudflare Turnstile caso a campanha receba tráfego automatizado relevante.
- A capacidade máxima de miniensaios não pode exceder o que cabe no período configurado, considerando a duração estimada por bailarina.
- A reserva temporária termina no horário de encerramento das vendas, mesmo que isso seja antes dos 15 minutos padrão.
- Ao republicar uma campanha pausada, a capacidade também não pode ficar abaixo da quantidade de miniensaios já vendidos ou com reserva ativa. A verificação é transacional e usa o mesmo bloqueio de evento das novas reservas.
- Uma campanha marcada como encerrada não pode ser reaberta nem voltar ao estado pausado, inclusive por chamadas diretas à API administrativa. Para um novo evento, é necessário criar uma nova campanha.
- O aceite guarda cópias e hashes SHA-256 da versão dos termos e da política de privacidade exibidas no momento da contratação.
- A ciência da política de privacidade é separada do aceite dos termos e da autorização opcional de uso de imagem.
- O painel administrativo não devolve ao navegador os hashes de acesso, de idempotência ou de requisição dos pedidos.
- As configurações da campanha e dos três pacotes são salvas em uma única transação. Uma falha cancela todas as alterações daquela tentativa.

A página pública permanece fechada enquanto CONTRATACAO_ATIVAR_PAGAMENTOS_REAIS não estiver explicitamente ativado. O painel mostra apenas indicadores de presença das credenciais, nunca seus valores.

## Publicação da campanha

A administração permite configurar data, local, período do miniensaio, duração estimada, capacidade, encerramento das vendas, duração da reserva, prazo de entrega, contato, dados do fornecedor, termos, privacidade e pacotes.

A RPC de publicação recusa a campanha enquanto faltar informação obrigatória. Ela também valida que o encerramento das vendas seja anterior ao início do miniensaio e que o prazo do checkout esteja dentro do limite aceito pela InfinitePay.

O evento cadastrado no banco foi conferido como Entre Estações, da Studio Entrepliés, em 07/11/2026. O horário e o local do miniensaio ainda precisam ser confirmados.

## Verificações

O workflow de CI verifica a sintaxe dos scripts, executa o build estático, os testes de navegador Chromium com checkout simulado, os testes de regras de reserva em PostgreSQL temporário e o `deno check` das Edge Functions. Nenhum teste de navegador cria cobrança na InfinitePay. O build confirma que as duas páginas de contratação foram copiadas para `dist/`.

Não executar compra real como teste sem autorização expressa.
