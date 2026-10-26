# Plano de migração do Storage para Cloudflare R2

## Estado
Preparação apenas. A produção continua apontando para Supabase Storage. Não excluir objetos, alterar DNS nem publicar mudanças de armazenamento nesta etapa.

## Arquitetura alvo
- Supabase continua responsável por PostgreSQL, Auth, sessões, perfis, permissões e regras de negócio.
- Cloudflare R2 guarda os arquivos de imagem.
- Um endpoint server-side autenticado/validado gera URLs temporárias para objetos privados. Credenciais S3 do R2 nunca vão para o navegador.
- Galeria autenticada, links privados de evento e seleção paga devem manter seus controles de acesso atuais.

## Compatibilidade que precisa ser preservada
- O bucket atual é privado: `fotos-grandfocus`.
- Os registros de fotos têm caminhos de original e, quando aplicável, `thumb_path` para prévia.
- Links públicos de evento usam token/senha e URLs assinadas temporárias.
- Seleção paga só libera alta resolução após confirmação do pagamento pelo fluxo atual; não tornar originais públicos.
- Downloads desktop/Android são sequenciais, com download nativo; no iOS o fluxo usa Web Share em lotes de até 4 fotos e exige novo toque por lote.
- As imagens do grid/lightbox precisam terminar com uma URL HTTPS real para o menu nativo “Salvar Imagem” no Safari; não deixar blob URL como URL final.
- Não gerar ZIP de downloads em massa.

## Fases e critérios de aceite
1. Criar bucket R2 privado e credenciais S3 com permissões mínimas.
2. Criar adaptador server-side para assinar URLs e ler/escrever objetos R2 sem expor segredos.
3. Criar script de cópia idempotente usando os caminhos exatos dos metadados, registrando sucesso/erro, tamanho e hash quando possível.
4. Conferir contagens, tamanhos e amostras; resolver a discrepância conhecida entre 2.225 arquivos locais e 2.224 linhas exportadas de `storage.objects` antes da virada.
5. Adaptar galerias autenticadas, galerias por link e seleção paga sem alterar regras de autorização.
6. Testar login, perfis, acesso por escola/aluno, link privado, senha, pagamento/liberação e downloads no Safari/WebKit e Android.
7. Publicar primeiro em preview/staging. Produção só muda após validação explícita.
8. Manter Supabase Storage intacto durante período de observação; remoção só depois de cópia e recuperação comprovadas.

## Bloqueios antes da implementação completa
- É necessário criar o bucket R2 na conta Cloudflare e obter endpoint, Access Key ID e Secret Access Key. Não colocar segredos no GitHub nem em variáveis públicas `NEXT_PUBLIC_*`.
- Confirmar como o ambiente de deploy vai armazenar segredos server-side.
- A cópia local de fotos ainda não está comprovada como completa; validar os 2.225 arquivos e resolver a diferença de metadados antes de declarar backup íntegro.
