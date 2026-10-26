# Plano de migração do Storage para Cloudflare R2

## Estado
Preparação apenas. A produção continua apontando para Supabase Storage. Não excluir objetos, alterar DNS nem publicar mudanças de armazenamento nesta etapa.

## Arquitetura alvo
- Supabase continua responsável por PostgreSQL, Auth, sessões, perfis, permissões e regras de negócio.
- Cloudflare R2 guarda os arquivos de imagem.
- Um endpoint server-side autenticado/validado gera URLs temporárias para objetos privados. Credenciais S3 do R2 nunca vão para o navegador.
- Galeria autenticada, links privados de evento e seleção paga devem manter seus controles de acesso atuais.

## Compatibilidade que precisa ser preservada
- Bucket de origem no Supabase: `fotos-grandfocus` (privado). Bucket de destino no Cloudflare R2: `grandfocus-fotos`. Os nomes são diferentes intencionalmente; `R2_BUCKET` deve apontar para o nome do bucket no R2.
- Os registros de fotos têm caminhos de original e, quando aplicável, `thumb_path` para prévia.
- Links públicos de evento usam token/senha e URLs assinadas temporárias.
- Seleção paga só libera alta resolução após confirmação do pagamento pelo fluxo atual; não tornar originais públicos.
- Downloads desktop/Android são sequenciais, com download nativo; no iOS o fluxo usa Web Share em lotes de até 4 fotos e exige novo toque por lote.
- As imagens do grid/lightbox precisam terminar com uma URL HTTPS real para o menu nativo “Salvar Imagem” no Safari; não deixar blob URL como URL final.
- Não gerar ZIP de downloads em massa.

## Implementação preparada na branch de migração
- Adaptador compartilhado `supabase/functions/_shared/r2.ts` gera URLs GET assinadas para objetos privados usando AWS SDK S3 e credenciais apenas no ambiente das Edge Functions.
- `galeria-publica` e `selecao-publica` foram adaptadas para usar o adaptador R2; RPCs, tokens, senha e verificação de liberação de pagamento continuam no Supabase.
- Esta alteração está somente na branch `migration/cloudflare-r2-prep`. Não publicar em produção antes de configurar secrets, executar testes e validar previews/downloads.

### Secrets necessários nas Supabase Edge Functions
Configurar no ambiente de teste, sem commitar valores no repositório:
- `R2_ENDPOINT` — endpoint S3 do bucket/account Cloudflare.
- `R2_ACCESS_KEY_ID` — Access Key ID do token R2 com permissão mínima necessária de leitura.
- `R2_SECRET_ACCESS_KEY` — secret correspondente.
- `R2_BUCKET` — `grandfocus-fotos`.

Não usar prefixo `NEXT_PUBLIC_`, não inserir valores nos arquivos e nunca enviar segredos ao navegador. Para gerar URLs GET, o token deve permitir leitura dos objetos. Se também for usado para upload pela aplicação, separar credenciais e permissões.

## Fases e critérios de aceite
1. Criar bucket R2 privado e credenciais S3 com permissões mínimas.
2. Criar adaptador server-side para assinar URLs e ler/escrever objetos R2 sem expor segredos.
3. Criar script de cópia idempotente usando os caminhos exatos dos metadados, registrando sucesso/erro, tamanho e hash quando possível.
4. Conferir contagens, tamanhos e hashes. Auditoria completa do R2 concluída: 2.225 objetos, aproximadamente 14,586 GB (decimal), e SHA-256 idêntico para os 2.225 arquivos locais, sem divergências ou erros. Antes da virada, ainda investigar a discrepância histórica entre 2.225 arquivos locais e 2.224 linhas de uma exportação anterior de `storage.objects`, para garantir que todos os caminhos referenciados pelo banco tenham objeto correspondente.
5. Adaptar galerias autenticadas, galerias por link e seleção paga sem alterar regras de autorização.
6. Testar login, perfis, acesso por escola/aluno, link privado, senha, pagamento/liberação e downloads no Safari/WebKit e Android.
7. Publicar primeiro em preview/staging. Produção só muda após validação explícita.
8. Manter Supabase Storage intacto durante período de observação; remoção só depois de cópia e recuperação comprovadas.

## Bloqueios antes da publicação
- Configurar os quatro secrets R2 no ambiente de teste das Supabase Edge Functions.
- Validar compilação/deploy em ambiente de teste, assinatura de URL e acesso aos objetos reais.
- Fazer testes funcionais completos antes de qualquer publicação em produção.
- A cópia foi verificada por tamanho e por SHA-256 para todos os 2.225 arquivos locais; os conteúdos são idênticos e houve zero erros. A investigação da discrepância histórica dos metadados e os testes funcionais permanecem pendentes.
