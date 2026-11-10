# Grand Focus 360 — Arquitetura integrada (proposta técnica, 09/11/2026)

> **Estado:** desenho validado contra o esquema Supabase real. A migração 093 introduz somente base de dados e dois funis, sem automação em produção, sem reconciliação financeira histórica e sem criar contas Auth. Não confundir “infraestrutura criada” com “fluxo entregue”.
>
> **Princípios:** uma identidade por pessoa quando verificada, fonte da verdade por domínio, ações idempotentes, mínimo de dados, preservação dos legados, segurança de menores, nenhuma receita presumida.

## 1. Diagnóstico fundamentado

| Domínio | Fonte atual e escopo | Separação atual |
|---|---|---|
| Pessoas com login | `perfis`, `auth.users` | Só com Auth — não pode representar todo contato do formulário |
| Alunas | `alunos` (`escola_id`, `turma`, `turma_id`) | Não se conecta às respostas de formulário automaticamente |
| Responsáveis com login | `responsavel_alunos` | Usa `user_id`, não aceita contato público sem login |
| Escolas cadastradas | `escolas` | Representam operação/fotografias, não necessariamente cada alvo da prospecção |
| CRM | `crm_leads`, `crm_pipelines`, `crm_etapas` | Pipeline único e leads desacoplados de contatos/escolas reais |
| Agenda | `agenda_compromissos`, `agenda_historico` | Já suporta `evento_id` e `escola_id`, mas não `resposta_id` |
| Contratações | `gf_contratacao_eventos`, `gf_contratacao_form_respostas`, `gf_contratacao_pedidos` | Eventos já possuem escola e evento vinculados; respostas não geram registros canônicos |
| Galeria | `eventos`, `fotos`, `foto_aluno`, `selecao_galerias` | Marcação de fotos por aluna é possível; família e pedido não são usados como agrupadores |
| Financeiro | `gr_lancamentos`, `gf_contratacao_pagamentos`, `selecao_pedidos` | Gold Reserve manual pode não incluir recebimentos comprovados de outros módulos |

## 2. Identidade única sem união incorreta

**Cadastro comercial `gf_contatos` NÃO equivale a usuário autenticado `perfis`.**

- Cada pessoa física usa um contato canônico: mãe, pai, bailarina adulta, responsável ou outro familiar. Uma mesma pessoa pode acumular vários papéis.
- A aluna mantém registro específico em `alunos`, vinculado à escola. `gf_contato_alunos` registra `mae`, `pai`, `responsavel_legal`, `proprio_aluno` etc. Uma pessoa que é simultaneamente bailarina e mãe tem um único contato e dois vínculos.
- O mesmo telefone pode pertencer a membros diferentes da família. **Nunca unir automaticamente só por telefone, e-mail ou nome.**
- Reutilização automática é permitida após um vínculo pré-existente validado (ex.: sessão Auth vinculada ou identificação por código/OTP para o contato); coincidências não verificadas viram **candidatos para revisão**.
- Formulário deve perguntar explicitamente “Quem está preenchendo?” com opções: `mãe`, `pai`, `outro responsável legal`, `própria bailarina`, `outro familiar`.
- Se “própria bailarina”, perguntar se é **maior de 18 anos**. Se adulta, contato e `alunos` representam a mesma pessoa em papéis distintos; se menor, coletar dados mínimos do responsável e exigir autorização legal verificável antes de liberar fotos pessoais e contratos.
- Registro de compra/execução, autorização para uso/divulgação de imagem, e preferência para receber marketing são **controles separados**. Uma opção “já paguei” NÃO confirma receita, e um clique de menor não substitui autorização parental.

**Fluxo de identificação após formulário:** criar evento idempotente por `resposta_id` → verificar correspondência inequívoca → vincular contato já validado ou criar novo contato operacional → vincular ou propor revisão de alunas existentes da escola → criar `gf_form_contatos`/`gf_form_alunos` → não conceder acesso a galeria sem confirmação de identidade/vínculo.

**Não cadastrar automaticamente um `auth.users` com senha aleatória nem vincular fotos a contas que não foram autenticadas.**

## 3. Escolas: prospecção versus parceria operacional

- **Prospect B2B:** `crm_leads.tipo_contato='escola'`, pipeline `Parcerias com Escolas`, sem criar `escolas` ainda. Campos estruturados: cidade, interesse, origem, pessoa decisora, etapa, próximo contato.
- **Parceira operacional:** ação administrativa explícita “Converter em escola parceira”, que pesquisa possíveis cadastros em `escolas`, permite escolher um existente ou criar outro com confirmação, e vincula `crm_leads.escola_id`.
- **Escola informada pela família e não encontrada:** registrar pendência “escola não localizada”, nunca cadastrar automaticamente como parceira e jamais marcar “fechada” só porque apareceu no formulário.
- **Família por escola:** `gf_form_respostas → gf_contratacao_eventos.escola_id → escolas` e `gf_contato_alunos → alunos.escola_id`. Mostrar responsáveis e alunas por escola, permitindo famílias com estudantes em escolas diferentes.
- Futuramente, implementar matrícula multi-escola por associação `aluno_escolas` em vez de sobrescrever `alunos.escola_id`, se a operação exigir.

## 4. CRM: funis e estados por propósito

**B2B — Parcerias com Escolas**: Mapeada → Primeiro contato → Conversa ativa → Reunião agendada → Proposta enviada → Negociação → Parceria fechada (ganho) / Não convertida (perdido).

**B2C — Famílias e Ensaios**: Contato recebido → Em atendimento → Orçamento enviado → Agendamento solicitado → Aguardando pagamento → Contratação confirmada (ganho) / Não convertida (perdido).

- Cadastro de responsável cria/atualiza ficha operacional de contato, **não deve automaticamente iniciar sequência de marketing**. A oportunidade B2C deve surgir só quando houver demanda/atendimento comercial legítimo, com comunicação adequada e opção de descadastro.
- Um contato pode ter vários ensaios sem virar duplicatas de lead: CRM mostra histórico de compras/atendimentos, enquanto uma nova oportunidade tem vínculo à transação original.
- O estado de produção (fotografando/editando/entregue) NÃO é etapa de vendas; é workflow operacional separado.
- Filtragem: prospectada, parceira cadastrada, sem escola, escola especificada, escola ligada, aluna, responsável, evento de origem, próximo contato, valor potencial, pagamentos e status de entrega.

## 5. Jornada de contratação e Agenda

1. Escola existente e evento fotográfico são vinculados à campanha `gf_contratacao_eventos`. Se `evento_id` já existe, reutilizar; nunca criar álbum duplicado.
2. Selecionar sessão gera **retenção de 10 minutos**, não compromisso definitivo.
3. Envio cria `gf_contratacao_form_respostas` e uma solicitação. A central mostra “aguardando pagamento/conferência”.
4. Só quando houver **agendamento confirmado** inserir ou atualizar `agenda_compromissos` pela chave única `gf_form_agenda_vinculos.resposta_id`. Dados: escola, evento, data, horário inicial, horário final = 15 min por bailarina, local e responsável.
5. Remarcação atualiza o compromisso *existente*, gravando `agenda_historico`; cancelamento marca cancelado e libera vaga conforme regras, sem excluir compromissos ou recebimentos.
6. Agenda mostra em paralelo (a) reservas pendentes no painel de contratação e (b) ensaios confirmados no calendário — nunca bloqueios de 10 minutos como compromissos públicos.
7. Reprocessar o mesmo evento não gera segundo compromisso (chave única + ação idempotente).

## 6. Ensaio, fotos, identificação e entregas

- A partir da sessão confirmada, gerar lista operacional `família → alunas → escola/turma → sessão → pacote → fotos esperadas → pagamentos`.
- Oferecer QR/código de atendimento **não público** por aluna e por família para facilitar a identificação no set, sem expor nomes/dados pessoais ao público.
- Ao subir as fotos, selecionar o evento existente; classificar `bastidores`, `palco`, `retratos`, `família`. Marcar uma foto para várias alunas usando `foto_aluno`, sem duplicar arquivos.
- Para familiares sem conta, permitir uma associação de contato apenas para organização interna, sem tornar a imagem visível para qualquer pessoa que digitar o telefone.
- Entrega ideal: uma galeria segura por família/pedido, mas com vínculo individual dos arquivos por aluna e permissões verificadas. Links com token não adivinhável, validade e revogação.
- Worklist: sessão confirmada → realizada → fotos importadas → identificação revisada → seleção/edição → pronto para entrega → entregue → pós-venda.
- Exceções: foto com várias crianças, menor sem autorização, mãe com duas alunas, pagamento parcial, reembolso, troca de figurino, erro de marcação, responsável compartilhando telefone.

## 7. Financeiro: uma fonte da verdade, não dois lançamentos

**Separar:** orçado / contratado / a receber / pago confirmado / repassado na conta / reembolsado.

- `gr_lancamentos`: despesas e receitas manuais externas continuam possíveis (ensaio sem formulário, aluguel, Uber, despesas, álbuns avulsos).
- `gf_contratacao_pedidos` + `gf_contratacao_pagamentos`: pedidos de contratação; somente pagamentos efetivamente verificados por confirmação oficial têm valor realizado.
- `gf_contratacao_form_respostas`: quando a equipe registrar e conferir `pago_manual` com `valor_recebido_centavos`, gera receita confirmada. A declaração “já paguei” continua **não conferida**.
- `selecao_pedidos`: receita de fotos adicionais apenas se o pagamento for comprovadamente recebido, não apenas porque a galeria foi liberada.
- A visão financeira reúne fontes **por identificador de transação / pedido**, sem copiar os mesmos reais em `gr_lancamentos`. A tabela `gf_financeiro_fontes` guardará o vínculo de conciliação e impede duplicação de uma fonte.
- Painéis: faturamento contratado, recebido bruto, taxas reais do provedor, recebido líquido, despesas pagas, margem por evento/escola, valores pendentes, recebimentos por forma de pagamento e período.
- Pix externo, crédito transferido diretamente e pagamentos sem webhook continuarão sujeitos a conciliação; **não há integração mágica com o extrato bancário**.
- Em compras parceladas separar valor de venda, recebimento/prazo de liquidação e taxa da operadora. Nunca tratar estimativa de taxa como desconto real conciliado.
- Reembolso gera estorno/ajuste com trilha de auditoria, em vez de excluir receita histórica.
- Diferenças entre pagamentos e recebimentos são sinalizadas em “Conciliação pendente”, sem inventar status pago.

## 8. Integrações confiáveis

A arquitetura adota o padrão **Outbox + Idempotência + Processador**:

1. Cada evento de negócio ganha chave estável, como `formulario_recebido:<uuid>` ou `pagamento_confirmado:<transaction_nsu>`.
2. O registro de origem é salvo primeiro; o outbox garante o processamento subsequente por consumidor autorizado.
3. Consumidor tenta atualizar contatos, CRM, agenda, listas de ensaio e financeiro com `upsert` por chaves únicas. Se falhar, registra erro/retry, sem perder o original.
4. Falhas de CRM não podem fazer uma contratação paga “desaparecer”. Fechamento de negócio não pode ser confundido com confirmação bancária.
5. Painel administrativo mostra fila de integrações pendentes/erros, horário da última sincronização e opção de “reprocessar” para perfis autorizados.

**Regras de segurança:** RLS em todas as tabelas novas; acesso pessoal a pai/aluna apenas após autenticação ou token seguro e vínculo verificado; Gold Reserve restrito a superadmin; auditoria de mesclagens e alterações financeiras; retenção e eliminação/anonymização conforme finalidade e obrigações; menor de idade com verificações adicionais.

## 9. Plano de implementação sem interrupção

| Fase | Entrega | Gatilho de publicação |
|---|---|---|
| 0 · Inventário | Mapear tabelas/relacionamentos, contagem de históricos, origem de cada valor | Sem alterações |
| 1 · Estrutura | Migration 093: contatos, vínculos, filas, reconciliação e funis B2B/B2C | RLS, testes PostgreSQL, backup, nenhum fluxo alterado |
| 2 · Formulário | Perguntar tipo de preenchedor/maioridade; registrar vínculo idempotente e pendências de identidade | Testes com responsável, bailarina adulta e menor |
| 3 · Agenda + operação | Sincronizar somente sessões confirmadas e gerar checklist de produção | Testes cancelamento, remarcação, 1–4 alunas |
| 4 · CRM | Enriquecer lead existente ou criar oportunidade com autorização e política de comunicação | Testes de duplicidade e funis existentes |
| 5 · Financeiro | Agregar fontes reais, conciliar e exibir no Gold Reserve sem duplicação | Comparação de valores por transação e teste de estorno |
| 6 · Galeria | Tags, agrupamento familiar e rastreio até entrega | Revisão de privacidade, teste de acesso indevido e links |
| 7 · Histórico | Reprocessar formulários antigos **somente em modo de análise**, revisão humana de ambiguidades | Backfill auditado, nunca reclassificar pagamento sozinho |

**Feature flags por fase:** padrão desligado; ativar somente após CI e revisão. **Rollback:** desativar processadores; manter filas/eventos para reprocessar; não remover colunas/tabelas antigas. A migração 093 não executa sincronizações e não altera pedidos, cadastros Auth ou movimentações financeiras.

## 10. Critérios de aceite

- Mesma mãe preenche 3 formulários → 1 contato validado + 3 jornadas comerciais, sem 3 logins.
- Bailarina adulta compra ensaio → a ficha pode representar pagadora e fotografada sem criar duas pessoas.
- Duas irmãs, 1 mãe, 1 reserva → 2 alunas vinculadas e 1 compromisso de agenda com duração total.
- Outra família usa o mesmo telefone → não mesclar pessoas nem liberar fotos sem revisão.
- Escola prospectada vira parceira → vincular `escolas.id` sem duplicar nome; preservar histórico B2B.
- “Já paguei” é marcado sem comprovante → CRM acompanha, mas Gold Reserve NÃO registra entrada confirmada.
- Webhook repetido 3 vezes → receita contada uma única vez.
- Pagamento manual foi conciliado com pagamento online → impedir receita duplicada.
- Remarcação/cancelamento → agenda atualizada uma vez e registro auditável.
- Foto de duas alunas → uma fotografia com duas tags, acesso somente aos autorizados.
- 42 inscrições legadas → permanecem intactas até o procedimento explícito de reconciliação.

## 11. Decisões pendentes de produto (não impedem infraestrutura)

- Ativação de atendimento por WhatsApp com verificação de identidade, ou painel admin inicial manual.
- Necessidade de matrícula multi-escola.
- Se as escolas parceiras poderão acessar um resumo operacional restrito, sem valores financeiros da Grand Focus.
- Forma de confirmação de consentimento parental, publicação de imagens e acesso à galeria.
- Credenciais para integração de pagamentos externos (sujeita a suporte real do provedor).

**Status de desenvolvimento:** construir primeiro a infraestrutura com dados privados e sem automações. Nenhum login, cadastro real, lead, lançamento financeiro ou pagamento deve ser criado nos testes.
