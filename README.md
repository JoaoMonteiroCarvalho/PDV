# PDV — moda íntima

Ponto de venda web, offline-first, para loja de moda íntima com roupa feminina,
pijama, moda praia, perfumaria e sexshop.

**Esta versão não emite documento fiscal.** Imprime comprovante de venda **não
fiscal**. O módulo fiscal está preparado no schema (campos nuláveis) e desligado
por configuração — nenhum cálculo de venda depende dele.

## Contexto operacional

| Item | Definição |
|---|---|
| Caixas simultâneos | 1 |
| SKUs | mais de 10.000 (tamanho × cor conta como SKU) |
| Internet | estável — offline é rede de segurança, não modo padrão |
| Cartão | maquininha **separada**, sem integração com o PDV |
| Impressora | ainda não adquirida — comprovante 80mm via impressão do navegador |
| Regime tributário | **a definir com o contador** |
| Operações v1 | crediário/fiado, desconto com alçada, sessão de caixa |

### Pendências de negócio

- **Regime tributário indefinido.** Não bloqueia nada nesta versão. Os campos
  fiscais (`ncm`, `cest`, `origem`, `situacaoTributaria`) existem, são nuláveis
  e não são lidos. `situacaoTributaria` é string livre de propósito: serve para
  CSOSN (Simples Nacional) ou CST (Lucro Presumido) sem exigir remodelagem.
  **Nenhuma premissa fiscal foi inventada.**
- **UF não informada.** Só será necessária quando a NFC-e for ligada.

## Stack

- **Frontend:** React + TypeScript + Vite, PWA instalável
- **Backend:** Node.js + Fastify + TypeScript, REST validada com Zod
- **Banco:** PostgreSQL + Prisma, migrations versionadas
- **Estado do caixa:** IndexedDB via Dexie.js
- **Testes:** Vitest (unitário) + Playwright (E2E do fluxo de venda)
- **Empacotamento:** Docker Compose

## Decisões de engenharia

### Dinheiro é inteiro em centavos

`packages/shared/src/dinheiro.ts` é a única aritmética monetária do sistema.
O tipo `Centavos` é *branded*: passar um `number` cru onde se espera dinheiro
não compila. O parse de valores digitados (`deReais`) trabalha só com strings —
nenhum float é criado em momento algum, nem na entrada, nem na formatação.

`formatarBRL` é o único ponto que produz `"R$"`, e monta a string dígito a
dígito em vez de dividir por 100.

`ratear` e `ratearProporcional` garantem que a soma das partes seja **sempre**
igual ao total: é o que impede parcela de crediário e rateio de desconto de
perderem ou criarem centavo.

### Venda é imutável — imposta pelo banco

Não existe coluna de status em `Venda`. Venda cancelada é aquela que **tem** um
registro em `Cancelamento` apontando para ela. A tabela é estritamente
insert-only.

Isso não é convenção: a migration `20260828120100_imutabilidade_e_ledger`
instala triggers que rejeitam `UPDATE` e `DELETE` em `Venda`, `ItemVenda`,
`Pagamento`, `Cancelamento`, `MovimentoEstoque` e `RegistroAuditoria`. Um
script rodado direto no `psql` também é barrado.

A mesma migration adiciona *checks* que impedem venda com total incoerente
(`total = subtotal - desconto`) chegar ao banco.

### Estoque é livro-razão

Não existe campo `quantidadeAtual`. O saldo vem da view `EstoqueAtual`, que
soma `MovimentoEstoque`. Cada movimento carrega tipo, quantidade com sinal,
custo unitário e referência ao documento que o originou.

### Catálogo com variantes

`Produto` é o item comercial; `Variante` é o que tem preço, código de barras e
estoque. Lingerie e pijama têm várias variantes (tamanho × cor); perfume e item
de sexshop têm uma só. O caixa sempre vende uma `Variante` — sem tabelas
paralelas por tipo de produto.

`Variante.atualizadoEm` é indexado porque, com mais de 10 mil SKUs, a
sincronização precisa ser incremental (só o que mudou), nunca catálogo inteiro.

### Segredos

Nada de credencial no código. Tudo em `.env`, que é ignorado pelo git.
`.env.example` documenta cada variável.

## Rodando

```bash
npm install
cp .env.example .env         # POSTGRES_PASSWORD, JWT_SEGREDO e as duas DATABASE_URL
npm run db:up                # Postgres em container
npm run db:migrate           # migrations do banco de desenvolvimento
npm run db:migrate:teste     # migrations do banco de teste
npm run seed -w @pdv/api     # catalogo de exemplo + sessao de caixa aberta

npm run dev -w @pdv/api      # API   -> http://localhost:3333
npm run dev -w @pdv/caixa    # Caixa -> http://localhost:5173

npm test                     # unitarios (nao precisam de banco)
npm run test:integracao      # contra o Postgres real
```

Usuarios do seed (**apenas desenvolvimento**): `ana`/`caixa123` (operadora, ate
5% de desconto), `bia`/`gerente123` (gerente), `admin`/`admin123`.

O seed imprime o id da sessao de caixa aberta. Cole no console do navegador uma
vez, ate a tela de abertura de caixa existir:
`localStorage.setItem('pdv.sessaoCaixaId', '<id>')`.

> **Porta 5433, nao 5432.** E comum a maquina ja ter um PostgreSQL nativo na
> 5432. Com os dois na mesma porta, quem atende vira loteria e o sintoma e
> "authentication failed" intermitente.

> **Dois bancos.** `pdv` para desenvolvimento, `pdv_teste` para os testes de
> integracao, que dao TRUNCATE em tudo a cada caso.

## O caixa (PWA)

Instalavel, roda em tela cheia. Continua vendendo com a internet caida:

- **Catalogo em IndexedDB**, sincronizado por paginacao de chave. Depois da
  primeira carga, so baixa o que mudou — com +10 mil SKUs, carga completa a
  cada 10 minutos deixaria o caixa lento na hora do movimento.
- **Busca local** por codigo de barras, SKU ou texto, sem acento e conjuntiva
  ("renda preto" nao traz tudo que e renda mais tudo que e preto). Os tokens
  sao calculados na gravacao, nao a cada tecla.
- **Venda gravada localmente primeiro**, com UUID gerado no cliente antes de
  qualquer rede, e enfileirada para envio.
- **Fila com espera exponencial e jitter**. Erro transitorio (offline, 5xx,
  timeout, token expirado) retenta; recusa por regra de negocio (4xx) vira
  pendencia VISIVEL, nunca descarte silencioso — a venda existe no mundo real.
- **Indicador de status** permanente: online/offline, quantas vendas aguardam
  sincronizacao, quantas travaram, quantos produtos ha no caixa.
- **Comprovante 80mm** impresso localmente, sempre, sem depender de resposta do
  servidor.

### O mesmo calculo nos dois lados

`calcularVenda` vive em `packages/shared` e e executado **identico** no caixa e
no servidor. Se o caixa tivesse a propria conta de rateio de desconto, o total
impresso no comprovante poderia divergir do gravado no banco, e a loja so
descobriria no fechamento.

## Abertura, sangria e fechamento de caixa

O `localStorage.setItem('pdv.sessaoCaixaId', ...)` manual saiu do fluxo.
Agora, ao abrir o caixa:

1. **Primeiro acesso no computador**: a tela pede o ID do terminal (uma vez
   so, fica salvo local).
2. **Sem sessao aberta nesse terminal**: tela de abertura — define o fundo de
   troco e chama `POST /sessoes-caixa`.
3. **Com sessao aberta**: tela de caixa aberto, com sangria, suprimento e
   fechamento.

**Sangria e suprimento nao tem alcada de valor** — ao contrario do desconto de
venda, que o operador concede sozinho ate um limite. Toda sangria, mesmo de
R$ 1,00, exige que um GERENTE se autentique ali na hora (login e senha
proprios, sem trocar a sessao do operador que esta vendendo). E o ponto
classico de fraude interna que a auditoria cobre sem excecao.

**O fechamento nunca e bloqueado por divergencia.** A loja precisa poder
encerrar o caixa fisico mesmo que a gaveta nao bata — mas a diferenca vira
`RegistroAuditoria` sempre que for diferente de zero.

## Testes de ponta a ponta (Playwright)

Cobrem o fluxo real, clicando na tela — não só chamando funções isoladas:

```bash
npm run test:e2e          # roda toda a suíte E2E (Chromium)
npm run test -w @pdv/e2e -- --ui     # modo interativo
```

Rodam contra um **quarto banco**, `pdv_e2e`, exclusivo deles: o `globalSetup`
recria e semeia esse banco do zero a cada execução (`e2e/seed-e2e.ts`), então
os testes nunca dependem de estado deixado por uma rodada anterior. A API e o
PWA sobem em portas próprias (3334/5174), diferentes das de desenvolvimento
(3333/5173) — dá para rodar o E2E com `npm run dev` já aberto.

**O E2E encontrou um bug real de produção**, não só validou o que já estava
certo: `saldoAPagar` comparava o total da venda contra o valor BRUTO recebido
em dinheiro, sem descontar o troco. Pagar R$ 100,00 por uma venda de R$ 89,90
gera R$ 10,10 de troco — o saldo ficava em `-10,10` (nunca zero) e o botão
"Finalizar e imprimir", que exige saldo exato, nunca habilitava. Nenhum teste
unitário cobria pagamento em dinheiro com troco; o E2E, ao clicar de verdade
nos botões, expôs a composição errada entre `saldoAPagar` e `calcularTroco`.
Corrigido para usar o líquido (recebido − troco), com dois testes unitários
novos cobrindo exatamente esse caso.

**Também revelou uma navegação impossível na UI**: o botão "Caixa" (para
voltar da venda e conferir/fechar o caixa) levava a uma tela que detectava a
sessão já aberta e pulava de volta para a venda no mesmo instante — a tela de
sangria/fechamento nunca chegava a aparecer. Corrigido distinguindo, no
`App.tsx`, "acabei de entrar, pule para a venda se já houver sessão" de
"cliquei em Caixa de propósito, quero ver a gestão mesmo com sessão aberta".

## Cancelamento / devolução

Devolução é **por item, com quantidade parcial** — o caso real de moda íntima:
cliente compra 3 peças, devolve 1. A venda original **nunca é alterada**; o
banco impede fisicamente qualquer `UPDATE` nela (e agora também em
`ItemCancelamento`, que entra no mesmo regime de imutabilidade).

Isso exigiu remodelar o schema: `Cancelamento` deixou de ser 1:1 com `Venda`
(uma venda só podia ser cancelada por inteiro, uma vez) e virou o cabeçalho de
um documento — uma venda pode ter várias devoluções ao longo do tempo, e
`ItemCancelamento` registra quanto de cada item foi devolvido em cada uma.
Nenhuma devolução consegue ultrapassar o disponível (vendido − já devolvido
antes), verificado tanto pelo serviço quanto pela view `DevolucaoPorItem`.

**Devolução exige gerente, sem alçada de valor** — mesma disciplina de
sangria/suprimento: mesmo devolver R$ 5,00 exige login e senha de um GERENTE
digitados na hora, sem trocar a sessão do operador que está atendendo.

**A forma de estorno decide o que acontece no caixa**: dinheiro e PIX saem da
gaveta na hora (`MovimentoCaixa` negativo); cartão não pode ser estornado
automaticamente — a maquininha opera separada do PDV — e vira só um registro
informativo; vale-troca não mexe em caixa nenhum.

**Localização da venda**: o operador digita o número impresso no comprovante,
ou o código curto do UUID quando a venda ainda está na fila offline (o número
sequencial só existe depois que o servidor confirma — o código de 8
caracteres é impresso sempre, mesmo sem rede).

## Estado atual

| Modulo | Situacao |
|---|---|
| Aritmetica monetaria | pronta — 26 testes |
| Regras da venda (calculo, rateio, alcada, pagamento, parcelas) | pronta — 30 testes |
| Regras de caixa (abertura, sangria/suprimento, fechamento) | pronta — 14 testes |
| Regras de devolucao (parcial, alcada de gerente, forma de estorno) | pronta — 20 testes |
| Autenticacao (scrypt + JWT) | pronta — 7 testes |
| Schema, imutabilidade e ledger | verificados contra Postgres real — 16 testes |
| API — vendas e catalogo | verificada de ponta a ponta — 39 testes |
| API — sessao de caixa (abrir, sangria, suprimento, fechar) | verificada de ponta a ponta — 17 testes |
| API — devolucao (parcial, busca por numero/codigo, alcada) | verificada de ponta a ponta — 23 testes |
| Seed | 8 produtos, 60 variantes, sessao de caixa aberta |
| Banco local do caixa (IndexedDB) | pronto |
| Fila de sincronizacao | pronta — 25 testes |
| Carrinho | pronto — 23 testes (2 novos: saldo com troco) |
| Sincronizacao e busca do catalogo | pronta — 17 testes |
| Comprovante 80mm | pronto — 12 testes |
| Tela de venda + abertura/fechamento de caixa + devolucao + PWA instalavel | verificada de ponta a ponta — **7 testes Playwright** |

**269 testes de API/unitarios** (174 unitarios + 95 de integracao) **+ 7
testes E2E**, `tsc --strict` limpo nos quatro workspaces.
