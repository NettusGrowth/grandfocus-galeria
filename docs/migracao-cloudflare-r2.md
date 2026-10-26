# Migração do armazenamento Grand Focus para Cloudflare R2

Atualizado em 26/10/2026.

## Objetivo e limites

Mover fotografias de galeria, miniaturas e arquivos da Seleção de Fotos para o Cloudflare R2, mantendo o Supabase para PostgreSQL, autenticação, perfis, permissões, tokens privados e regras de negócio. O armazenamento R2 é o custo recorrente aceito pelo projeto; a arquitetura não deve criar serviços Supabase pagos nem depender de uma branch Supabase paga.

A produção continua sem alteração. Esta documentação descreve trabalho preparado na branch `migration/cloudflare-r2-prep`; não significa que a migração já esteja ativa.

## Arquitetura preparada

- Bucket Supabase de origem: `fotos-grandfocus` (privado).
- Bucket R2 de destino: `grandfocus-fotos` (deve permanecer privado; não ativar acesso público ao bucket).
- Fotos principais e miniaturas: caminhos da forma `<uuid-do-evento>/<nome-do-arquivo>`.
- Fotos de Seleção: caminhos da forma `selecoes/<uuid-da-galeria>/<nome-do-arquivo>`.
- Outros assets — imagens de alunos, perfis, escolas, capas de evento, posts e configuração — continuam no Storage do Supabase nesta primeira fase. A regra é que um caminho só seja tratado como R2 quando coincidir com os formatos acima.

As credenciais S3 do R2 permanecem exclusivamente em secrets da Edge Function. O navegador recebe apenas URLs pré-assinadas com prazo limitado, não a chave secreta.

## Código preparado na branch

- `supabase/functions/_shared/r2.ts`: cria URLs GET/PUT pré-assinadas e permite exclusão controlada de objetos no servidor. A assinatura GET define o MIME de resposta pela extensão; a assinatura PUT inclui explicitamente `content-type` entre os cabeçalhos assinados.
- `supabase/functions/r2-storage/index.ts`: adaptador autenticado para assinar URLs, preparar upload direto e apagar objetos R2.
  - Extrai o bearer token do cabeçalho e o passa explicitamente a `auth.getUser(token)` porque o cliente foi criado com `persistSession: false`; assim não depende de uma sessão local inexistente.
  - Usa `meu_perfil()` para obter o papel.
  - Para usuários que não são administradores, confere os caminhos da galeria contra `storage_paths_visiveis()` antes de gerar URL.
  - Somente `admin` e `super_admin` podem solicitar upload ou exclusão pelo adaptador.
  - Limita a quantidade de caminhos por chamada e valida o formato da chave.
- `supabase/functions/galeria-publica/index.ts`: gera links R2 para capas, miniaturas e originais de links privados de evento. A RPC do banco continua validando token/senha.
- `supabase/functions/selecao-publica/index.ts`: gera links R2 para prévias e arquivos de seleção. A função de download continua consultando `selecao_download_liberado()`; a alta resolução não deve ser liberada antes da autorização de pagamento no banco.
- `index.html`: roteia assinatura, upload, download, processamento de miniaturas e exclusão de fotos de galeria/seleção por meio do adaptador R2. Os caminhos de perfil/escola/aluno/post que não correspondem aos padrões de fotos principais continuam no Supabase.
- `scripts/check-inline-js.mjs`: verifica sintaxe dos scripts JavaScript inline de `index.html`.
- `.github/workflows/edge-functions-check.yml`: executa o verificador de sintaxe do app, `deno check` nas Edge Functions da migração, testes unitários de tipos MIME e testes offline para montagem das URLs pré-assinadas GET/PUT.

## Configuração necessária no Cloudflare

### Secrets das Supabase Edge Functions

Configurar no projeto de teste/preview ou, somente na etapa de lançamento aprovada, no projeto de produção. Nunca versionar valores:

- `R2_ENDPOINT`: endpoint S3 da conta R2.
- `R2_ACCESS_KEY_ID`: ID da chave R2 com a permissão mínima necessária.
- `R2_SECRET_ACCESS_KEY`: segredo correspondente.
- `R2_BUCKET`: `grandfocus-fotos`.

Como o adaptador fornece URLs de upload e exclusão, as credenciais do servidor precisam permitir leitura e escrita/exclusão do bucket conforme a necessidade do código. Preferir credencial dedicada ao bucket de destino, sem permissões em outros buckets. Não reutilizar no navegador e não usar prefixos públicos como `NEXT_PUBLIC_`.

### Como cadastrar os secrets no Supabase

No painel do Supabase, abra o projeto **GrandFocus** e acesse **Edge Functions → Secrets** (ou abra diretamente a página de secrets pelo menu Functions). Cadastre os quatro nomes abaixo, cada um com o valor correspondente da conta R2. É possível salvar vários de uma vez.

```dotenv
R2_ENDPOINT=https://763a7874d95665cbe09a06871e44e04b.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=COLE_AQUI_O_ID_DA_CHAVE_NOVA
R2_SECRET_ACCESS_KEY=COLE_AQUI_O_SEGREDO_DA_CHAVE_NOVA
R2_BUCKET=grandfocus-fotos
```

O bloco acima é um modelo: substituir os dois marcadores pelas credenciais novas, nunca por credenciais antigas que já foram compartilhadas. Não enviar as chaves por WhatsApp, chat, issues ou GitHub. Depois de salvar, a função só poderá usar os secrets quando for implantada; cadastrar secrets por si só não ativa a migração. Não implantar as funções alteradas na produção até concluir os testes e aprovar a troca.

### CORS do bucket R2

A política CORS foi configurada via API Cloudflare e conferida por uma leitura posterior. Regra `grandfocus-galeria-site`:

- Origens: `https://galeria.grandfocus.com.br` e `https://grandfocus-galeria.vercel.app`.
- Métodos: `GET`, `HEAD`, `PUT`.
- Cabeçalho permitido: `Content-Type`.
- `ETag` exposto e cache de preflight de 3.600 segundos.
- Verificação da API Cloudflare em 26/10/2026: o domínio gerenciado `r2.dev` está desativado (`enabled: false`) e não há domínios personalizados vinculados ao bucket. O acesso permanece privado, por URLs pré-assinadas.

Isso é uma configuração de infraestrutura realizada, mas não equivale a teste funcional de upload/download. Deploys de preview do Vercel podem usar hosts individuais que não estão nesta lista; só adicionar uma origem de preview quando houver necessidade e ela for conhecida. Não usar wildcard como solução permanente. A política CORS do bucket é diferente dos cabeçalhos CORS da Edge Function.

Documentação oficial: https://developers.cloudflare.com/r2/buckets/cors/

## Cópia e integridade dos arquivos

Auditoria executada anteriormente no ambiente local:

- 2.225 objetos no R2.
- Aproximadamente 14,586 GB em bytes decimais (aprox. 13,584 GiB), conforme inventário da cópia.
- SHA-256 comparado para os 2.225 arquivos locais: 2.225 idênticos, zero divergências, zero erros e zero arquivos locais ausentes.
- Log local: `C:\\GrandFocusBackup\\r2-transfer\\auditoria-sha256.jsonl`.
- Verificação adicional via SQL no Supabase em 26/10/2026: o bucket de origem ainda contém 2.225 objetos e 2.225 caminhos únicos; a soma de `metadata.size` é `14.585.988.073` bytes, igual à soma da listagem Cloudflare R2. Os objetos originais continuam no Supabase e não foram apagados.
- Originais locais: `C:\\GrandFocusBackup\\backup\\fotos\\fotos-grandfocus`.

A auditoria SHA-256 confirma igualdade entre os arquivos locais e os objetos verificados do R2; ela, isoladamente, não comprova que cada registro de metadados do banco tenha caminho correspondente nem valida o comportamento do site.

**Metadados HTTP dos objetos:** em 26/10/2026, a listagem da API Cloudflare confirmou 2.225 objetos (14.585.988.073 bytes) e todos os 2.225 estavam com `Content-Type: application/octet-stream`, apesar das extensões `.jpg`, `.jpeg`, `.png`, `.webp`, `.pdf` e `.mp4`. Isso não altera a integridade dos bytes, mas pode afetar a interpretação de imagens/arquivos no navegador. O helper `signR2Object` agora assina `ResponseContentType` coerente com a extensão, sem precisar retransferir os arquivos existentes; uploads novos já assinam o `Content-Type` correto. Essa correção ainda exige teste funcional com secrets configurados, confirmando o cabeçalho HTTP real de cada tipo de arquivo.

## Observações sobre o inventário Supabase

Consultas de leitura no banco encontraram:

- 925 linhas em `public.fotos`, com 925 `storage_path` e 925 `thumb_path` distintos.
- Nenhuma linha atual em `public.selecao_fotos` ou `public.post_midias` na consulta de inventário.
- 5 capas referenciadas em `eventos.capa_url`; capas/logos de escola e imagens de perfil/aluno usam outros prefixos, que não são roteados para R2 pelo adaptador da galeria.
- Em `storage.objects`, 2.145 objetos estão no grupo de caminhos UUID-raiz usado para fotos/miniaturas, com soma de tamanhos de metadados de 13.499,61 MiB; 80 objetos restantes somam 410,67 MiB. Essa soma precisa ser reconciliada com as leituras anteriores do painel de quotas do Supabase antes de tomar qualquer decisão de limpeza, pois os números de quota observados em momentos anteriores eram diferentes.
- Existe diferença histórica entre 2.225 arquivos locais e uma exportação anterior com 2.224 linhas de `storage.objects`. A contagem atual do banco mostrou 2.225 objetos. Manter essa discrepância documentada até a comparação completa dos caminhos e tamanhos.

### Conferência dos caminhos atuais da galeria com o R2

Em 26/10/2026, todos os 1.850 caminhos atualmente referenciados por `public.fotos.storage_path` e `public.fotos.thumb_path` foram comparados com a listagem do R2, agrupados pelos cinco diretórios de evento ativos. Resultado: **1.850 correspondências, zero caminhos ausentes e zero objetos extras nesses cinco diretórios**. A verificação contou 1.160, 374, 160, 134 e 22 objetos por diretório, respectivamente.

O bucket de origem também possui 2.145 objetos em 17 diretórios no padrão UUID-raiz. Destes, 295 objetos (em outros 12 diretórios) não estão referenciados pela tabela `public.fotos` atual. Esses arquivos permanecem no R2 e no Supabase; podem ser históricos ou pertencer a outros fluxos. **Não excluir nem migrar a rota desses 295 arquivos sem inventariar seus usos primeiro.** Os outros 80 objetos usam prefixos como `alunos`, `config`, `escolas`, `eventos-capa`, `perfis` e `posts`, e continuam fora do roteamento R2 inicial.

Não excluir objetos do Supabase com base apenas nessas contagens.

## Segurança e comportamento esperado

- O bucket R2 deve permanecer privado. Não ativar “public bucket” para simplificar os links.
- As URLs são temporárias. A validade é definida na assinatura.
- Credenciais S3 não devem aparecer no HTML, GitHub, logs de aplicação nem respostas para o navegador.
- A galeria autenticada usa a lista `storage_paths_visiveis()` para restringir acesso aos caminhos próprios do usuário. Os testes precisam cobrir administrador, escola, professor, responsável e aluno com fixtures reais existentes.
- Link privado de evento continua usando as RPCs que validam token e senha.
- A seleção paga continua usando `selecao_download_liberado()`. O webhook InfinitePay deve continuar reconfirmando o pagamento server-to-server antes de liberar pedido; não alterar esse fluxo como parte da migração de arquivos.
- Downloads desktop/Android e iOS, lightbox, edição de álbum e processamento de marca-d'água precisam ser testados em navegador real.
- Uploads diretos com URLs pré-assinadas só funcionam com CORS correto e com `Content-Type` igual ao assinado.
- Após expirar uma URL, o app deve solicitar outra. Não guardar URL pré-assinada como valor permanente no banco.

## Plano de testes antes da virada

1. Obter uma branch/ambiente de teste sem custo adicional. No levantamento atual, a API não retornou branches de desenvolvimento Supabase. Não criar branch Supabase que possa cobrar por hora.
2. Configurar secrets de teste e política CORS de R2 em origens restritas.
3. Executar o workflow. A checagem estática e o teste unitário do mapeamento MIME passam no commit atual; isso não substitui os testes funcionais contra o R2 e o navegador.
4. Conferir por amostragem que os caminhos referenciados por `fotos.storage_path`, `fotos.thumb_path`, capas privadas e seleção existem no R2; incluir a checagem de todos os caminhos, não apenas amostra.
5. Validar a função autenticada `r2-storage`: sessão inexistente/expirada, usuário sem permissão, acesso a foto visível, tentativa de assinar foto alheia, tentativa de upload não administrativo e tentativa de excluir sem papel de administrador.
6. Validar upload de foto original, upload de miniatura, miniatura ausente/regerada, lightbox/original e downloads de alta resolução.
7. Validar links privados com senha correta/incorreta, link expirado, envio de seleção e download negado antes de pagamento confirmado.
8. Validar pagamento no fluxo de teste/ambiente controlado sem realizar cobrança real.
9. Testar Chrome/Edge desktop, Android e Safari/iOS, incluindo salvar imagem, Web Share e URLs que expiram.
10. Fazer um período de observação e confirmar uso/cotas do Supabase após as solicitações passarem a servir fotos do R2.
11. Somente após os testes, aprovar uma virada reversível. Manter o bucket Supabase até confirmar a aplicação, os uploads novos e a recuperação via backup.
12. Remover objetos da origem apenas em uma etapa separada, com inventário de caminhos, contagens, tamanho e export de recuperação verificados.

## Estado atual e bloqueios

- Preparação em branch; Pull Request #1 continua draft/aberto: https://github.com/NettusGrowth/grandfocus-galeria/pull/1
- O deploy de produção não foi executado por esta migração.
- Nenhum objeto do bucket Supabase foi apagado por esta migração.
- A cópia local→R2 tem auditoria SHA-256 completa documentada acima.
- O GitHub Actions terminou com sucesso no commit `3a140684cd9187c727ce13591dbe8d4a3862d160` (runs `40273628618` e `40273633674`, push e pull request): sintaxe do JavaScript inline, `deno check` das quatro Edge Functions e teste unitário do mapeamento MIME. Essa checagem é estática; testes funcionais e configuração dos secrets ainda estão pendentes. As rodadas anteriores também corrigiram a tipagem de `galeria-publica` e ajustaram a validação do bearer JWT no adaptador autenticado para passar o token explicitamente a `auth.getUser(token)`.
- Não há confirmação automática nesta documentação de que todas as URLs R2 estejam funcionais no browser, nem de que o limite de quota do Supabase já tenha sido sanado.
- Não mergear nem publicar até resolver os bloqueios e validar uma forma de rollback.
