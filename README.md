# PDV — ponto de venda web, offline-first

Sistema de ponto de venda para varejo físico, construído para continuar
vendendo com a internet fora do ar e para tratar dinheiro com o rigor que
sistema financeiro exige.

O domínio é varejo de vestuário: catálogo grande, produto com grade de
tamanho × cor, crediário próprio, sessão de caixa com sangria e fechamento.
Nada aqui é genérico por acidente — cada decisão abaixo resolve um problema
concreto de balcão.

**Esta versão não emite documento fiscal.** Imprime comprovante de venda **não
fiscal**. O módulo fiscal está preparado — campos nuláveis no schema e uma
porta (`EmissorFiscal`) que o registro de venda já chama — e desligado por
configuração. Nenhum cálculo de venda depende dele.

## Premissas do projeto

| Item | Definição |
|---|---|
| SKUs | mais de 10.000 (tamanho × cor conta como SKU) |
| Internet | estável — offline é rede de segurança, não modo padrão |
| Cartão | maquininha **separada**, sem integração com o PDV |
| Impressora | comprovante 80mm via impressão do navegador |
| Operações | crediário, desconto com alçada, sessão de caixa, devolução parcial |

Os campos fiscais (`ncm`, `cest`, `origem`, `situacaoTributaria`) existem, são
nuláveis e não são lidos. `situacaoTributaria` é string livre de propósito:
serve para CSOSN (Simples Nacional) ou CST (Lucro Presumido) sem exigir
remodelagem.

## A porta do documento fiscal

Ligar a NFC-e um dia **não pode significar abrir o serviço que registra a
venda** — o código mais sensível do sistema — e costurar chamadas de rede no
meio de uma transação que hoje é toda local. Seria cirurgia no coração do PDV
feita sob pressão de prazo fiscal.

Por isso a porta existe antes do emissor. `registrar-venda.ts` já chama
`EmissorFiscal.emitir()`; a implementação de hoje é `emissorDesligado`, que
devolve `DESLIGADO` e não faz nada. Ligar vira trocar o retorno de
`criarEmissorFiscal` — um ramo, num arquivo.

Três regras que a porta impõe, e que valem para qualquer emissor futuro:

**A venda já aconteceu.** Quando a porta é chamada, o dinheiro entrou na
gaveta e a cliente foi embora. SEFAZ fora do ar não desfaz isso. `emitir`
nunca lança para cancelar a venda: devolve uma *situação*, e
indisponibilidade é situação prevista, não exceção. Se um emissor quebrar o
contrato e lançar, o serviço converte em `INDISPONIVEL` — uma venda paga e
entregue não vira erro 500 porque uma biblioteca estourou.

**A emissão é fora da transação.** Emitir dentro dela manteria uma transação
de banco aberta pelo tempo de resposta da SEFAZ e, no timeout, desfaria o
registro de uma venda real.

**Desligado não custa nada.** Com `habilitado: false` o payload sequer é
montado — nem a consulta do cliente roda. Os campos fiscais do produto vêm na
mesma consulta que já existia, e são capturados no momento da venda: corrigir
o NCM na semana que vem não pode mudar o documento de ontem.

`INDISPONIVEL` é separado de `REJEITADO` porque o que a loja faz depois é
diferente: rejeição é dado errado que alguém corrige; SEFAZ fora é esperar ou
entrar em contingência.

A flag `FISCAL_HABILITADO=true` **derruba a API na partida**, de propósito:
existe a porta, não existe emissor, e deixar subir faria a loja acreditar que
emite documento fiscal enquanto não emite.

## Stack

- **Frontend:** React + TypeScript + Vite, PWA instalável
- **Backend:** Node.js + Fastify + TypeScript, REST validada com Zod
- **Banco:** PostgreSQL + Prisma, migrations versionadas
- **Estado do caixa:** IndexedDB via Dexie.js
- **Testes:** Vitest (unitário e integração) + Playwright (E2E)
- **Infra local:** Postgres em container via Docker Compose

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
(`total = subtotal - desconto`) chegar ao banco. Um bug de cálculo que
escapasse dos testes falharia ao tentar persistir.

### Estoque é livro-razão

Não existe campo `quantidadeAtual`. O saldo vem da view `EstoqueAtual`, que
soma `MovimentoEstoque`. Cada movimento carrega tipo, quantidade com sinal,
custo unitário e referência ao documento que o originou.

### Catálogo com variantes

`Produto` é o item comercial; `Variante` é o que tem preço, código de barras e
estoque. Peças de vestuário têm várias variantes (tamanho × cor); acessórios e
itens avulsos têm uma só. O caixa sempre vende uma `Variante` — sem tabelas
paralelas por tipo de produto.

`Variante.atualizadoEm` é indexado porque, com mais de 10 mil SKUs, a
sincronização precisa ser incremental (só o que mudou), nunca catálogo inteiro.

### Autorização de gerente é um token assinado, não um identificador

Operações sensíveis — devolução, sangria, suprimento, desconto acima da alçada
— exigem que um gerente libere na hora. O desenho ingênuo (e a primeira versão
deste projeto) autentica o gerente numa telinha e envia o **id** dele junto da
operação. Isso não prova nada: qualquer operador autenticado pode montar a
requisição à mão com o id de um gerente e registrar uma devolução
"autorizada" sem que ninguém tenha digitado senha.

A versão atual emite, em `POST /sessao/autorizar`, um JWT assinado de vida
curta. Quem autorizou é lido **da assinatura**, nunca do corpo da requisição —
forjar exige o segredo do servidor. Um campo `tipo` separa token de sessão de
token de autorização nos dois sentidos: o token de 12 h do gerente não vira
liberação permanente, e o token de autorização não navega o sistema.

A venda aceita token expirado **de propósito**: ela fecha offline e pode subir
horas depois, e recusar pelo prazo descartaria venda já paga e impressa. O que
impede forjar é a assinatura, não o prazo.

### Cabeçalhos de segurança

`@fastify/helmet` com a CSP mais fechada que existe: `default-src 'none'`.
Esta API devolve JSON e nada mais — nunca HTML, nunca script. Se uma resposta
dela for renderizada como página, por engano de configuração ou por injeção,
ela não consegue carregar recurso nenhum nem executar script.

`frame-ancestors 'none'` impede que a API seja embutida num iframe de outra
origem, que é o caminho do clickjacking sobre uma sessão já autenticada. HSTS
só liga em produção: em desenvolvimento a API roda em `http://localhost`.

`crossOriginResourcePolicy: cross-origin` é obrigatório aqui — o PWA roda em
5173 e a API em 3333, e o padrão `same-origin` do helmet bloquearia
justamente o caixa.

### Segredos e superfície de ataque

Nada de credencial no código. Tudo em `.env`, ignorado pelo git;
`.env.example` documenta cada variável. Senha com scrypt da biblioteca padrão
(sem dependência nativa, que seria atrito num PC de loja), comparação em tempo
constante e mensagem única para login inexistente e senha errada — não se
entrega ao atacante quais logins existem.

CORS com allowlist explícita (`ORIGENS_PERMITIDAS`) e rate limit global, bem
mais apertado nas rotas que recebem senha.

## Rodando

```bash
npm install
cp .env.example .env         # POSTGRES_PASSWORD, JWT_SEGREDO e as DATABASE_URL
npm run db:up                # Postgres em container
npm run db:migrate           # migrations do banco de desenvolvimento
npm run db:migrate:teste     # migrations do banco de teste
npm run seed -w @pdv/api     # catalogo de exemplo + sessao de caixa aberta

npm run dev -w @pdv/api      # API   -> http://localhost:3333
npm run dev -w @pdv/caixa    # Caixa -> http://localhost:5173

npm test                     # unitarios (nao precisam de banco)
npm run test:integracao      # contra o Postgres real
npm run test:e2e             # Playwright
```

Usuarios do seed (**apenas desenvolvimento**): `ana`/`caixa123` (operadora, ate
5% de desconto), `bia`/`gerente123` (gerente), `admin`/`admin123`.

> **Porta 5433, nao 5432.** E comum a maquina ja ter um PostgreSQL nativo na
> 5432. Com os dois na mesma porta, quem atende vira loteria e o sintoma e
> "authentication failed" intermitente.

> **Bancos separados.** `pdv` para desenvolvimento, `pdv_teste` para os testes
> de integracao (que dao TRUNCATE a cada caso) e `pdv_e2e` para o Playwright.

### Banco e API em container

```bash
docker compose up -d --build   # Postgres + API -> http://localhost:3333
```

O `Dockerfile` da API constroi a partir da RAIZ do repositorio, nao de
`apps/api`: `@pdv/shared` e workspace npm, e um build feito de dentro da pasta
da API nao enxergaria o pacote irmao.

O container aplica as migrations pendentes (`prisma migrate deploy`) antes de
subir o servidor. `deploy` so aplica migrations ja versionadas — nunca gera uma
nova nem apaga dado, ao contrario de `migrate dev`.

O PWA nao esta no Compose: em desenvolvimento ele roda pelo Vite, e em producao
e um bundle estatico servido por qualquer servidor web.

### Backup

```bash
npm run db:backup          # grava em ./backups e verifica o arquivo
npm run db:testar-backup   # restaura num banco descartavel e confere
```

Todo o historico financeiro da loja — venda, caixa, crediario, auditoria —
vive num volume Docker. Volume some: por `docker compose down -v` digitado sem
pensar, por disco que falha, por maquina trocada.

O dump sai no formato **custom** do `pg_dump` (`-Fc`): comprimido, restauravel
tabela a tabela, e com indice que o `pg_restore --list` le sem restaurar nada.
E assim que o backup se verifica sozinho logo depois de gravar — se o arquivo
saiu truncado, a falha aparece hoje, e nao no dia em que a loja precisar dele.

**Um backup que nunca foi restaurado nao e backup, e um arquivo.** Por isso
existe `db:testar-backup`: ele cria um banco descartavel, restaura o dump mais
recente, conta as linhas das tabelas principais, recusa um backup que volte
sem nenhum usuario (sem usuario ninguem entra no sistema, entao a loja nao
voltaria a operar) e apaga o banco de teste no fim.

Restaurar POR CIMA do banco em uso nao e oferecido de proposito: e uma
operacao que apaga o presente para trazer o passado. Restaure num banco novo
(`npm run db:restaurar -- --para pdv_recuperado`), confira, e so entao aponte
`DATABASE_URL` para ele.

`backups/` e `*.dump` estao no `.gitignore`: o dump contem o cadastro de
clientes com CPF e telefone.

**Agendamento.** No Windows, Agendador de Tarefas com acao
`npm run db:backup` na pasta do projeto. Num VPS Linux, cron:

```cron
0 22 * * *  cd /opt/pdv && npm run db:backup >> /var/log/pdv-backup.log 2>&1
0 3 * * 0   cd /opt/pdv && npm run db:testar-backup >> /var/log/pdv-backup.log 2>&1
```

O script sai com codigo de erro quando falha, para o agendador conseguir
avisar. Backup que falha em silencio e pior que nao ter backup: cria a
confianca sem o arquivo.

## O caixa (PWA)

Instalável, roda em tela cheia. Continua vendendo com a internet caída:

- **Catálogo em IndexedDB**, sincronizado por paginação de chave. Depois da
  primeira carga, só baixa o que mudou — com +10 mil SKUs, carga completa a
  cada 10 minutos deixaria o caixa lento na hora do movimento.
- **Busca local** por código de barras, SKU ou texto, sem acento e conjuntiva
  ("renda preto" não traz tudo que é renda mais tudo que é preto). Os tokens
  são calculados na gravação, não a cada tecla.
- **Venda gravada localmente primeiro**, com UUID gerado no cliente antes de
  qualquer rede, e enfileirada para envio. Esse UUID é a chave de idempotência:
  o mesmo envio repetido nunca gera duas vendas.
- **Fila com espera exponencial e jitter**. Erro transitório (offline, 5xx,
  timeout, token expirado) retenta; recusa por regra de negócio (4xx) vira
  pendência VISÍVEL, nunca descarte silencioso — a venda existe no mundo real.
- **Indicador de status** permanente: online/offline, quantas vendas aguardam
  sincronização, quantas travaram, quantos produtos há no caixa.
- **Comprovante 80mm** impresso localmente, sempre, sem depender de resposta do
  servidor.

### O mesmo cálculo nos dois lados

`calcularVenda` vive em `packages/shared` e é executado **idêntico** no caixa e
no servidor. Se o caixa tivesse a própria conta de rateio de desconto, o total
impresso no comprovante poderia divergir do gravado no banco, e a loja só
descobriria no fechamento.

## Abertura, sangria e fechamento de caixa

1. **Primeiro acesso no computador**: a tela pede o ID do terminal (uma vez
   só, fica salvo local).
2. **Sem sessão aberta nesse terminal**: tela de abertura — define o fundo de
   troco e chama `POST /sessoes-caixa`.
3. **Com sessão aberta**: tela de caixa aberto, com sangria, suprimento e
   fechamento.

**Sangria e suprimento não têm alçada de valor** — ao contrário do desconto de
venda, que o operador concede sozinho até um limite. Toda sangria, mesmo de
R$ 1,00, exige que um gerente se autentique ali na hora, sem trocar a sessão do
operador que está vendendo. É o ponto clássico de fraude interna que a
auditoria cobre sem exceção.

**O fechamento nunca é bloqueado por divergência.** A loja precisa poder
encerrar o caixa físico mesmo que a gaveta não bata — mas a diferença vira
`RegistroAuditoria` sempre que for diferente de zero.

## Devolução

Devolução é **por item, com quantidade parcial** — o caso real do balcão:
cliente compra 3 peças, devolve 1. A venda original **nunca é alterada**; o
banco impede fisicamente qualquer `UPDATE` nela (e também em
`ItemCancelamento`, que entra no mesmo regime de imutabilidade).

Isso exigiu remodelar o schema: `Cancelamento` deixou de ser 1:1 com `Venda`
(uma venda só podia ser cancelada por inteiro, uma vez) e virou o cabeçalho de
um documento — uma venda pode ter várias devoluções ao longo do tempo, e
`ItemCancelamento` registra quanto de cada item foi devolvido em cada uma.
Nenhuma devolução consegue ultrapassar o disponível (vendido − já devolvido
antes), verificado tanto pelo serviço quanto pela view `DevolucaoPorItem`.

**A forma de estorno decide o que acontece no caixa**: dinheiro e PIX saem da
gaveta na hora (`MovimentoCaixa` negativo); cartão não pode ser estornado
automaticamente — a maquininha opera separada do PDV — e vira só um registro
informativo; vale-troca não mexe em caixa nenhum.

**Localização da venda**: o operador digita o número impresso no comprovante,
ou o código curto do UUID quando a venda ainda está na fila offline (o número
sequencial só existe depois que o servidor confirma — o código de 8
caracteres é impresso sempre, mesmo sem rede).

## Histórico de vendas

Resolve o caso em que o operador não tem o comprovante em mãos. `GET /vendas`
lista as vendas **da sessão de caixa atual** — não mistura turnos — com busca
por nome de cliente e paginação. Cada linha mostra um indicador `temDevolucao`
para o operador ver de relance quais vendas já tiveram devolução.

Clicar em "Devolver" numa linha leva **direto** para a tela de devolução com a
venda já resolvida — sem digitar de novo o número que acabou de aparecer.

A paginação aqui é por **offset**, diferente da paginação por chave do
catálogo: aceitável porque o volume por sessão de caixa é baixo e vendas nunca
são editadas, só inseridas em ordem — não há o risco de deslocamento de página
que a paginação por chave existe para evitar.

## Cadastro de catálogo

Produto nasce com a **grade inteira**. Peça de lingerie chega em P/M/G × três
cores; cadastrar o produto e depois nove variações, uma requisição cada,
transformaria a chegada da coleção numa tarde de trabalho — e deixaria produto
sem variação nenhuma toda vez que alguém desistisse no meio. A tela tem um
gerador: escolhe tamanhos, escolhe cores, monta as combinações com SKU
sugerido, e deixa editar antes de salvar.

**Ler é de operador, escrever é de gerente.** Consultar ficha de produto é
trabalho de balcão; mudar preço, criar SKU ou desativar peça é decisão de quem
responde pela margem. Sem essa separação a alçada de desconto não significaria
nada — bastaria baixar o preço da peça.

Nada é apagado, só desativado: variante assina `ItemVenda` e
`MovimentoEstoque`. `ativo: false` também é o canal pelo qual o caixa remove o
item do índice local.

**Alteração de preço vira auditoria**, com o antes, o depois e quem fez. É o
registro que responde "por que essa peça saiu por R$ 40?" — a venda congela o
preço praticado, mas não guarda quem o alterou no catálogo.

## Inventário e movimentação

O ajuste de inventário recebe a quantidade **contada na arara**, não a
diferença: quem confere estoque conta peça, não calcula delta, e errar o sinal
inverteria o ajuste.

O estoque continua sendo livro-razão. O ajuste não escreve um saldo — lança o
movimento que falta para o saldo bater com a contagem. Contagem que bate não
lança nada (movimento de quantidade zero é proibido pelo schema), mas é
auditada de qualquer forma: a conferência que não achou diferença é o que diz
desde quando aquele saldo é confiável.

O extrato de cada variação reconstrói o saldo de trás para frente, do saldo de
hoje desfazendo movimento a movimento. É assim que se responde "vendi ou
sumiu?", que é a pergunta que traz alguém a essa tela.

## Relatório Z e auditoria

O fechamento devolvia três números — esperado, contado, diferença. Isso
responde "bateu?" e nada mais; a pergunta seguinte é "bateu com o quê?". O
relatório do turno quebra por forma de pagamento, líquido do troco.

**Só dinheiro entra na conferência da gaveta.** Cartão e Pix vão direto para a
conta da loja (a maquininha opera separada do PDV) e crediário não é dinheiro
recebido, é promessa. Somá-los ao esperado faria toda gaveta fechar com sobra
fantasma.

A auditoria já era gravada em oito pontos e **nada lia**. `GET /auditoria`
(só gerente) filtra por ação e período, no dia da loja, e mostra quem fez e
quem autorizou. Somente leitura: o registro é insert-only e não existe caminho
no código para alterá-lo.

## Testes

```bash
npm test                  # unitarios, sem banco
npm run test:integracao   # contra Postgres real
npm run test:e2e          # Playwright (Chromium)
```

| Camada | Testes |
|---|---|
| Unitários (`packages/shared`) — dinheiro, venda, caixa, devolução, CPF | 105 |
| Unitários (`apps/api`) — autenticação | 7 |
| Unitários (`apps/pdv`) — carrinho, desconto, fila, catálogo, comprovante, telas | 492 |
| Integração (`apps/api`) — contra Postgres real, rotas e porta fiscal | 232 |
| E2E (Playwright) — fluxo real, clicando na tela | 149 |
| **Total** | **985** |

`tsc --strict` limpo nos quatro workspaces.

O E2E roda contra um banco exclusivo, recriado e semeado do zero a cada
execução (`e2e/seed-e2e.ts`), então nunca depende de estado deixado por uma
rodada anterior. A API e o PWA sobem em portas próprias (3334/5174),
diferentes das de desenvolvimento — dá para rodar o E2E com `npm run dev` já
aberto.

### O E2E encontrou bugs reais, não só validou o que já estava certo

**Saldo com troco:** `saldoAPagar` comparava o total da venda contra o valor
BRUTO recebido em dinheiro, sem descontar o troco. Pagar R$ 100,00 por uma
venda de R$ 89,90 gera R$ 10,10 de troco — o saldo ficava em `-10,10` (nunca
zero) e o botão "Finalizar e imprimir", que exige saldo exato, nunca
habilitava. Nenhum teste unitário cobria pagamento em dinheiro com troco; o
E2E, ao clicar de verdade nos botões, expôs a composição errada entre
`saldoAPagar` e `calcularTroco`.

**Navegação impossível:** o botão "Caixa" levava a uma tela que detectava a
sessão já aberta e pulava de volta para a venda no mesmo instante — a tela de
sangria/fechamento nunca chegava a aparecer. Corrigido distinguindo "acabei de
entrar, pule para a venda se já houver sessão" de "cliquei em Caixa de
propósito, quero ver a gestão mesmo com sessão aberta".

## Limitações conhecidas

- **Sem emissão fiscal.** Comprovante não fiscal apenas. A porta
  (`EmissorFiscal`) está pronta e testada, mas não há emissor: ligar a NFC-e
  exige certificado digital, contrato com SEFAZ ou gateway, e a definição do
  regime tributário pelo contador. Falta também decidir onde o estado do
  documento (autorizado, rejeitado, em contingência) será persistido — hoje a
  porta devolve a situação e quem chama decide o que fazer com ela.
- **Impressora térmica não validada em hardware.** A impressão passa pelo
  diálogo do sistema operacional (`window.print()` com `@page`), o que funciona
  com qualquer driver, mas largura de coluna e corte de papel só se confirmam
  imprimindo de verdade. O que falta checar está em
  `CHECKLIST-IMPRESSAO-TERMICA.md`.
- **Sem CI.** Os testes rodam localmente; não há pipeline bloqueando merge.
  Sem isso, uma mudança de permissão numa rota já passou despercebida até a
  suíte de integração ser rodada à mão, dias depois.
- **`servidor.ts` concentra todas as rotas.** São mais de trinta agora. Está
  coberto por testes, mas pede divisão em plugins por domínio — é o próximo
  refactor que se paga.
- **Sem Pix integrado.** A forma de pagamento é registrada, mas não há geração
  de QR nem conferência automática: a baixa é manual, olhando o app do banco.
- **Sem etiquetas nem estoque mínimo.** Não há geração de etiqueta de preço e
  nada avisa quando uma variação está acabando — a ruptura só aparece quando
  alguém olha o saldo.
- **Backup é local por padrão.** `npm run db:backup` grava em `./backups`, na
  mesma máquina do banco. Copiar para fora (nuvem, pen drive) ainda é passo
  manual, e um backup que mora no disco que pode falhar protege menos do que
  parece.
