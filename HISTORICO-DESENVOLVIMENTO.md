# Histórico de desenvolvimento — PDV Moda Íntima

Este arquivo registra o que foi construído, as decisões tomadas e o porquê,
sessão por sessão. Existe para que o trabalho possa ser retomado em qualquer
máquina (o histórico de conversa do Claude Code fica local ao notebook onde
foi feito — este arquivo é o que viaja pelo Git).

Para o estado técnico atual (como rodar, testes, arquitetura), veja o
[README.md](./README.md). Este documento é sobre **como chegamos até aqui**.

---

## Contexto do negócio

Loja de moda íntima: roupa feminina, pijama, moda praia, perfumaria e
sexshop. Peças de vestuário têm variação de tamanho/cor; perfume e itens de
sexshop são produto simples (uma variante só). O catálogo precisa suportar os
dois formatos ao mesmo tempo, sem tabelas paralelas.

Premissas fechadas com o usuário no início do projeto:

| Item | Definição |
|---|---|
| Caixas simultâneos | 1 |
| SKUs | mais de 10.000 |
| Internet | estável — offline é rede de segurança, não modo padrão |
| Cartão | maquininha separada, sem integração com o PDV |
| Regime tributário | indefinido — módulo fiscal desligado, campos preparados |
| Emissão fiscal | nenhuma nesta versão — comprovante não fiscal |
| Operações v1 | crediário, desconto com alçada, sessão de caixa |

Regras de engenharia inegociáveis definidas desde o início:
- Dinheiro é sempre inteiro em centavos, nunca float.
- Venda finalizada é imutável — correção só via documento novo vinculado.
- Estoque é livro-razão (soma de movimentos), nunca campo editado.
- Auditoria em tudo que envolve dinheiro.
- Sem segredo em código — tudo via variável de ambiente.
- Offline-first: o caixa vende com a internet caída.

---

## Incremento 1 — Fundação (dinheiro, schema, Docker)

**O quê:**
- Monorepo com npm workspaces (`packages/shared`, `apps/api`, depois `apps/pdv`, depois `e2e`).
- `packages/shared/src/dinheiro.ts`: todo o sistema monetário. Tipo `Centavos`
  *branded* (um `number` cru não compila onde se espera dinheiro). Parse de
  valores digitados (`deReais`) trabalha só com strings, nunca cria float.
  `ratear`/`ratearProporcional` garantem que a soma das partes nunca diverge
  do total (usado em parcelas de crediário e rateio de desconto).
- Schema Prisma completo: usuários, catálogo (Produto/Variante), sessão de
  caixa, venda, pagamento, estoque (livro-razão), crediário, auditoria.
- Migration de imutabilidade: triggers Postgres que **recusam fisicamente**
  `UPDATE`/`DELETE` em `Venda`, `ItemVenda`, `Pagamento`, `MovimentoEstoque`,
  `RegistroAuditoria`. Não é convenção de código — é garantia do banco.
- `docker-compose.yml` + `.env.example`.

**Decisões e correções no caminho:**
- Removida a coluna `status` de `Venda`: venda cancelada é reconhecida pela
  *existência* de um documento `Cancelamento` apontando para ela, não por um
  campo mutável — mantém a tabela estritamente insert-only.
- **Obstáculo real: Docker Desktop não subia.** Diagnóstico levou a descobrir
  que o WSL2 não estava instalado na máquina. A conta do usuário não tinha
  privilégio de administrador (domínio corporativo TSTECK) — o usuário tinha
  a senha de admin e autorizou a elevação via UAC, e o `wsl --install` correu
  com sucesso. Depois de reiniciar, o Docker subiu.
- **Conflito de porta 5432**: a máquina já tinha um PostgreSQL 18 nativo
  ocupando a porta padrão. O contêiner do projeto foi movido para 5433, com
  isso documentado no `.env.example` porque é um problema recorrente em
  qualquer máquina com Postgres pré-instalado.

**Verificação:** testes de integração escritos para provar — não presumir —
que os triggers de imutabilidade funcionam contra um Postgres real.

---

## Incremento 2 — Regras da venda

**O quê:** `packages/shared/src/venda.ts` (mais tarde promovido para cá, ver
Incremento 4) com `calcularVenda`: rateio de desconto entre itens, alçada de
desconto do operador vs. exigência de gerente, validação de pagamento
dividido em várias formas, cálculo de parcelas de crediário.

`packages/shared/src/autenticacao.ts`: hash de senha com `scrypt` do
`node:crypto` (sem dependência nativa como bcrypt/argon2, que exigiriam
compilador na loja).

**Bug real encontrado pelos próprios testes:** o `scrypt` do Node tem limite
de memória padrão de 32 MB; os parâmetros de custo escolhidos precisavam de
exatamente 32 MB, estourando por muito pouco. Corrigido calculando a folga de
memória a partir dos próprios parâmetros de custo.

---

## Incremento 3 — API completa, idempotência provada

**O quê:** servidor Fastify com rotas de login, registro de venda e
sincronização de catálogo. Serviço de registro de venda transacional
(venda + itens + pagamentos + movimentos de estoque numa única transação).

**Decisão de negócio importante:** o servidor **nunca rejeita** uma venda por
divergência entre o preço praticado (registrado offline, possivelmente horas
atrás) e o preço atual do catálogo — a venda já aconteceu no mundo real,
recusar criaria um estado pior (dinheiro na gaveta sem registro no sistema).
A divergência vira registro de auditoria, não erro.

**Idempotência**, o requisito mais crítico do offline-first: o mesmo UUID de
venda nunca gera duas vendas, mesmo sob reenvio concorrente. Isso foi
verificado com um **teste de mutação real**: desligou-se deliberadamente o
tratamento de concorrência no serviço, confirmou-se que o teste de "3 envios
simultâneos" **falha** sem a proteção, e volta a passar com ela — prova de
que o teste realmente testa o que diz testar, não só decora a suíte.

**Correção de arquitetura:** os testes de integração e o ambiente de
desenvolvimento inicialmente compartilhavam o mesmo banco — os testes fazem
`TRUNCATE` a cada caso, o que apagaria dados de desenvolvimento a cada
execução. Corrigido criando um segundo banco (`pdv_teste`), com uma guarda no
setup que recusa rodar se as duas URLs apontarem para o mesmo lugar.

---

## Incremento 4 — PWA do caixa (offline-first de verdade)

**O quê:**
- Banco local em IndexedDB (Dexie): catálogo replicado, fila de sincronização
  de vendas, metadados de sincronização.
- Sincronização incremental do catálogo por **paginação de chave**
  (`atualizadoEm` + `id`), não por offset — com mais de 10 mil SKUs, offset
  sofre de escritas concorrentes deslocando páginas e pulando registros.
- Busca local sem acento, conjuntiva (buscar "renda preto" não traz tudo que
  é renda mais tudo que é preto), com tokens pré-calculados na gravação.
- Fila de sincronização com backoff exponencial + jitter. Decisão central:
  erro transitório (rede caiu, 5xx) retenta; erro de regra de negócio (4xx)
  vira **pendência visível**, nunca é descartado silenciosamente — a venda já
  foi impressa e o dinheiro já entrou na gaveta.
- Comprovante 80mm com aviso obrigatório "NÃO É DOCUMENTO FISCAL" antes dos
  valores, não escondido no rodapé.
- Tela de venda em React, com indicador permanente de status
  (online/offline/pendências).

**Refatoração importante:** `calcularVenda` foi movido de `apps/api` para
`packages/shared`, porque o caixa também precisava dele. Se o caixa tivesse a
própria implementação, o total impresso no comprovante poderia divergir
silenciosamente do total gravado no servidor — a loja só descobriria no
fechamento do caixa, tarde demais.

---

## Incremento 5 — Abertura, sangria e fechamento de caixa

**O quê:** `packages/shared/src/caixa.ts` com as regras puras; rotas de
abertura de sessão, sangria/suprimento, fechamento; telas correspondentes no
PWA.

**Decisão de negócio:** sangria e suprimento **não têm alçada de valor** —
diferente do desconto de venda (que o operador concede sozinho até um
limite), aqui **todo** valor exige gerente, sem exceção, porque mexer na
gaveta fora do fluxo normal de venda é o ponto clássico de fraude interna.

O fechamento de caixa **nunca é bloqueado** por divergência entre o valor
contado e o esperado — a loja precisa poder encerrar o dia mesmo com a gaveta
batendo errado — mas toda divergência ≠ 0 vira registro de auditoria
automaticamente.

---

## Incremento 6 — Playwright cobrindo o fluxo completo

**O quê:** suíte de testes E2E com Chromium, rodando contra um **quarto
banco** (`pdv_e2e`), recriado e semeado do zero a cada execução. API e PWA
sobem em portas próprias (3334/5174) para não colidir com o ambiente de
desenvolvimento aberto.

**Dois bugs de produção reais encontrados pelo E2E** (não hipotéticos —
descobertos ao clicar de verdade nos botões):

1. **`saldoAPagar` comparava contra o valor bruto recebido, não o líquido.**
   Pagar R$ 100,00 numa venda de R$ 89,90 gera R$ 10,10 de troco; o saldo
   ficava permanentemente em `-10,10` e o botão "Finalizar e imprimir" nunca
   habilitava. Nenhum teste unitário cobria pagamento em dinheiro com troco —
   só PIX/débito, que nunca geram troco. Corrigido para usar o líquido
   (recebido − troco), com dois testes unitários novos.
2. **Navegação "voltar ao caixa" era impossível na prática.** O botão levava
   a uma tela que detectava a sessão já aberta e pulava de volta para a venda
   no mesmo instante da montagem — sangria e fechamento nunca chegavam a
   aparecer visualmente. Corrigido distinguindo, no componente principal,
   "acabei de logar, pule para a venda se já houver sessão" de "cliquei em
   Caixa de propósito, quero ver a gestão mesmo com sessão aberta".

Esse incremento é a prova de por que E2E importa: nenhum dos dois bugs seria
pego por testes unitários isolados, porque cada peça (`saldoAPagar`,
`calcularTroco`, a lógica de navegação) "funcionava" isoladamente — só a
composição real, clicada na tela, expunha o problema.

---

## Incremento 7 — Cancelamento / devolução

**O quê:** devolução **por item, com quantidade parcial** — o caso real de
moda íntima (cliente compra 3 peças, devolve 1).

**Remodelagem de schema necessária:** o modelo original tinha `Cancelamento`
1:1 com `Venda` (`@unique`), suportando só cancelamento total, uma vez. Isso
foi identificado antes de codificar e confirmado explicitamente com o
usuário (a alternativa mais simples seria manter só cancelamento total).
Remodelado para `Cancelamento` ser o cabeçalho de um documento — uma venda
pode ter várias devoluções ao longo do tempo — com `ItemCancelamento`
registrando quanto de cada item foi devolvido em cada uma. Nova tabela
entrou no mesmo regime de imutabilidade das demais (trigger de bloqueio de
UPDATE/DELETE).

**Decisões de negócio:**
- Devolução exige gerente **sem alçada de valor**, mesma disciplina de
  sangria/suprimento — mesmo devolver R$ 5,00 exige autenticação de gerente.
- A **forma de estorno** decide o que acontece no caixa: dinheiro e PIX saem
  da gaveta na hora (movimento de caixa negativo); cartão não pode ser
  estornado automaticamente (a maquininha é separada do PDV) e vira só
  registro informativo; vale-troca não mexe em caixa nenhum.
- Nenhuma devolução pode ultrapassar o disponível (vendido − já devolvido
  antes) — verificado pelo serviço e apoiado por uma view de conferência.

**Problema descoberto no meio do trabalho (não hipotético):** o comprovante
imprime "Venda: pendente" enquanto a venda está na fila offline — o número
sequencial só existe depois que o servidor confirma. Isso deixava a
devolução sem como localizar uma venda ainda não sincronizada. Perguntado ao
usuário e resolvido adicionando busca também pelo **código curto do UUID**
(sempre impresso no comprovante, mesmo offline), com tratamento explícito do
caso improvável de colisão de prefixo (recusa com erro claro, nunca escolhe
a venda errada em silêncio).

---

## Estado ao final desta sessão

- **276 testes passando** (174 unitários + 95 de integração + 7 E2E),
  `tsc --strict` limpo nos quatro workspaces (`packages/shared`, `apps/api`,
  `apps/pdv`, `e2e`).
- **Nada commitado ainda** — o repositório Git foi inicializado mas está
  inteiramente untracked. Ver seção "Próximos passos" no README para o que
  falta (cancelamento em rota já existe; falta tela de histórico de vendas
  navegável, ícones reais do PWA, impressora térmica real testada).
- Quatro bancos PostgreSQL em uso: `pdv` (desenvolvimento), `pdv_teste`
  (integração), `pdv_e2e` (Playwright), todos no mesmo contêiner Docker na
  porta 5433 (não 5432, por conflito com Postgres nativo da máquina).

## Para retomar em outra máquina

1. Clonar o repositório.
2. `npm install` na raiz.
3. Copiar `.env.example` para `.env`, gerar `POSTGRES_PASSWORD` e
   `JWT_SEGREDO` novos (não precisam ser os mesmos valores).
4. Docker Desktop instalado e rodando (no Windows, exige WSL2 — se não
   tiver, `wsl --install --no-distribution` como administrador + reboot).
5. `npm run db:up`, depois aplicar as migrations nos três bancos (dev, teste,
   e2e — comandos exatos no README).
6. `npm run seed -w @pdv/api` para o catálogo de exemplo.
7. Ler o README.md para o restante (comandos de dev, estrutura de pastas,
   convenções).
