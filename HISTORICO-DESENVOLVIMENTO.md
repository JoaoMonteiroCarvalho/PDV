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

## Incremento 8 — Histórico de vendas navegável

**O quê:** rota `GET /vendas` com paginação, filtro por sessão de caixa
(não misturar turnos diferentes) e busca por nome de cliente. Cada item traz
um indicador `temDevolucao`, calculado a partir da existência de
`Cancelamento` vinculado — o operador vê de relance, sem abrir cada venda,
quais já tiveram alguma devolução.

Paginação por **offset**, não por chave como no catálogo: aqui é aceitável
porque o volume por sessão de caixa é baixo (vendas de um turno, não 10 mil
SKUs) e vendas nunca são editadas — só inseridas em ordem, sem o risco de
deslocamento de página que a paginação por chave do catálogo existe para
evitar.

`TelaHistorico.tsx` no PWA: lista as vendas da sessão atual, com busca por
cliente e botão "Devolver" por linha, que leva **direto** para
`TelaDevolucao` já com a venda resolvida — sem o operador precisar digitar de
novo o número que acabou de ver na lista. Isso resolve a lacuna criada no
Incremento 7 (devolução exigia o comprovante físico em mãos).

**Correção descoberta escrevendo o teste E2E:** ao concluir uma devolução
iniciada a partir do histórico, a tela volta para a **lista do histórico**
(não para a tela de venda) — comportamento correto, já que é de lá que o
operador veio, e ele já vê o indicador `temDevolucao` atualizado na hora. A
primeira versão do teste presumia (errado) que voltaria para a venda; a
asserção foi corrigida para refletir o comportamento real, não o outro
caminho ajustado.

---

---

# Parte II — Reescrita da interface

O backend dos Incrementos 1–8 permanece intacto. O que foi refeito do zero foi
a **camada de interface**, contra uma especificação nova de design de produto.
A regra de trabalho passou a ser: uma fase por vez, mostrando a tela antes de
avançar para a próxima.

## Fase 0 — Fundação de design e rotas

Stack fixada: React + TypeScript + Vite PWA, React Router, Zustand, Dexie,
Tailwind v4, react-three-fiber. O estado anterior (tela única, tema escuro)
foi removido.

**Duas decisões que valem mais que o resto da fase:**

1. **Tema claro forçado.** `index.html` traz `data-theme="light"` no HTML, e
   `estilo.css` deliberadamente NÃO tem `@media (prefers-color-scheme: dark)`.
   Herdar o modo escuro do sistema causou confusão real durante a prototipação
   — a loja abria o PDV e via outra coisa do que foi desenhado. Escuro existe
   só como escolha manual em Configurações.

2. **Dois sistemas de cor paralelos.** A cor do PRODUTO é independente da cor
   da INTERFACE. Um sutiã vinho é vinho no tema claro, no escuro e no
   comprovante. `design/coresProduto.ts` guarda a paleta de catálogo e tem um
   teste que **lê o próprio arquivo-fonte** e falha se alguém fizer a cor de
   produto derivar de um token de interface (`var(--accent)` etc.). Comentário
   não impede regressão; esse teste impede.

**Dívida assumida explicitamente:** 9 specs E2E exercitavam a UI removida.
Foram marcados como pendentes, com o motivo e a fase de retorno no cabeçalho
de cada arquivo — não apagados nem esvaziados. Um teste que não afirma nada é
pior que um teste vermelho.

---

## Fase 1 — Login com cena 3D

`CenaLogin.tsx` renderiza a caixinha da marca em react-three-fiber.
Restrições que moldaram o resultado:

- **3D só em três telas** (login, consulta de produto, confirmação de venda) —
  nunca na tela de venda, que é a de maior movimento.
- `frameloop="demand"` quando a animação de apresentação termina: a GPU para
  de desenhar em vez de girar um modelo parado.
- **Nada de corpo humano realista.** Formas geométricas abstratas.
- O formulário aparece e recebe foco ANTES da cena carregar. Dá para logar sem
  nunca esperar o 3D, e há teste E2E provando isso.
- Sem WebGL (máquina fraca, driver antigo, efeitos desligados nas
  Configurações), cai em `PalcoEstatico` — não em erro nem em tela branca.

**Problemas resolvidos nesta fase:**

- `@react-three/fiber@9` exige React 19; o projeto está no 18.3.1. Fixado em
  fiber@8.18 / drei@9.122. Subir o React no meio da reescrita seria mexer em
  duas variáveis ao mesmo tempo.
- **Vite estourando memória** no build E no dev ("Zone Allocation failed"). A
  causa foi o import de índice do drei, que puxa centenas de módulos. Trocado
  por imports cirúrgicos (`@react-three/drei/core/RoundedBox.js`). A máquina
  também estava em 95% de RAM.
- A fita da caixinha atravessava o modelo — erro de medida meu: altura 1,42
  numa caixa de 1,15. Corrigida para envolver do fundo à tampa.

---

## Fase 2 — Abertura de caixa

`TelaCaixa.tsx` com três estados: configurar terminal (uma vez por
computador), abrir caixa, e resumo do caixa aberto. Na UI anterior a tela de
resumo era **inatingível** — ela se auto-substituía no instante em que
detectava sessão aberta.

`caixaStore` ganhou a flag `jaConsultou`, que distingue "não há caixa aberto"
de "ainda não perguntei ao servidor". Sem ela o guard de rota expulsava a
operadora da venda mesmo com o caixa aberto, no primeiro render.

O motor de sincronização foi movido para o `useEffect` do `Shell` — ou seja,
só depois do login. Antes rodava em escopo global e tomava 401 sem token.

**Detalhe tipográfico com motivo:** o campo de dinheiro usa a fonte de CORPO
com `tabular-nums`, não a monoespaçada. Em IBM Plex Mono a vírgula ganha
largura de dígito, e em 30px "R$ 200 , 00" fica com um vão feio. A mono
continua nos números que alinham em COLUNA, que é onde ela serve.

---

## Fase 3 — Tela de venda

A tela onde a loja passa o dia. Duas colunas: busca e resultados à esquerda,
carrinho **sempre visível** à direita. Sem 3D, por decisão de projeto.

Navegação por mouse, a pedido — os atalhos F2–F10 foram descartados. O que
ficou foi o campo de busca que aceita código bipado: o leitor da loja funciona
como teclado (digita o código e manda Enter), e sem esse caminho o
equipamento que a loja já tem fica inútil.

### Grade de variação — o problema central do ramo

O servidor manda variantes planas; a vendedora pensa em produto ("o conjunto
de renda, tem no 42 preto?"). `catalogo/grade.ts` faz a tradução, em lógica
pura e testável sem montar tela.

A grade inteira aparece **dentro do card do resultado da busca**. Abrir uma
tela por variação transformaria uma pergunta de dois segundos em quatro
cliques. Cada célula tem três estados, e a diferença entre os dois últimos
importa no balcão:

| célula | significa | o que a vendedora responde |
|---|---|---|
| azul com número | tem peça | "tenho, 3" |
| cinza com 0 | a loja vende, acabou | "chega quinta" |
| tracejada com – | não é vendida | "não trabalhamos nessa" |

Tratar "esgotado" e "não vendemos" como a mesma coisa faz a operadora prometer
reposição de algo que nunca vai chegar.

Célula esgotada **continua clicável** de propósito: o saldo local é da última
sincronização, e travar a venda por um número defasado é pior do que vender a
peça que está na arara. O estoque real vive no servidor.

Ordenação de tamanho é por convenção do varejo, não alfabética — ordenar
"P, M, G, GG" como texto daria "G, GG, M, P" e a vendedora leria a grade
errada.

### Backend tocado nesta fase

- `GET /catalogo` passou a devolver `produtoId` (agrupar por nome seria
  frágil: dois produtos podem se chamar igual) e `saldoEstoque` (consulta
  separada à view `EstoqueAtual`, restrita aos IDs da página).
- Dexie migrou para `version(2)`: limpa o catálogo e a marca de sincronização,
  porque os itens antigos não têm `produtoId`. **A fila de vendas não é
  tocada** — ali há dinheiro que ainda não subiu ao servidor.

### Finalização

`ModalFinalizacao.tsx`. A regra que organiza a tela: **o que falta receber
está sempre na cara da operadora**. Venda dividida (Pix + cartão + dinheiro) é
rotina, e o erro clássico é fechar achando que o cliente pagou tudo. O saldo é
o número maior da tela e "Confirmar" só habilita quando ele zera.

Troco calculado ao vivo, e só em dinheiro — a maquininha opera separada do PDV
e não devolve troco.

Crediário ficou **de fora** desta fase: exige cliente identificado, que é a
Fase 9. Oferecer agora deixaria a operadora escolher uma forma que o servidor
recusa no envio — pendência bloqueada com o comprovante já na mão da cliente.

### Dois bugs reais que os testes acharam

1. **O campo de dinheiro dependia da posição do cursor.** Com "0,00" na tela,
   digitar "4" no fim dava R$ 0,04 e no começo dava R$ 40,00. Um clique no
   meio do número — coisa que acontece o tempo todo — lançava outro valor sem
   a operadora perceber. Reescrito para funcionar como maquininha de verdade:
   `aplicarTecla()` trata dígito e Backspace no `keydown`, ignorando o caret.
   Achado pelo E2E da venda dividida, não por inspeção.

2. **O Enter do leitor caía no vazio.** O scanner digita o código e manda
   Enter em milissegundos, antes do debounce de 180 ms. A busca passou a ser
   refeita no submit, em vez de ler o estado.

Também descoberto: os primeiros testes E2E amarravam o clique ao saldo
("5 em estoque") e por isso dependiam da ordem de execução — estoque é
livro-razão, e uma venda finalizada num teste derruba o saldo do próximo.

### Dívida paga

`venda-produto-simples.spec.ts` (3 testes) voltou a rodar, reescrito contra a
tela nova. Seguem pendentes 6 specs (devolução, fluxo completo, histórico),
que dependem das Fases 5–7.

---

## Fase 4 — Catálogo visual e consulta de produto

Duas telas: `/catalogo` para navegar, `/produto/:produtoId` para consultar uma
peça. É onde a operadora responde "vem em vinho? no GG? qual o código?" sem
abrir o sistema do escritório. Lê do Dexie, nunca da rede.

### A prévia 3D é um símbolo, não uma foto

`PecaAbstrata.tsx` tem três formas, e nenhuma delas tem corpo humano. Roupa
aparece **dobrada**, como fica na prateleira: um manequim numa loja de moda
íntima é constrangedor com a cliente do outro lado do balcão, e uma silhueta
ainda sugeriria caimento que o sistema não conhece.

| forma | quando | como é feita |
|---|---|---|
| `dobrada` | peça com grade de tamanho | três lâminas empilhadas e giradas |
| `frasco` | categoria Perfumaria/Cosméticos | cilindro, ombro, gargalo, tampa |
| `bloco` | o resto | embalagem neutra |

A escolha sai da categoria e da existência de grade (`formaDaPeca.ts`), nunca
do nome do produto — adivinhar por texto erraria em cadastro escrito de outro
jeito, e erraria em silêncio.

A tela traz uma legenda fixa dizendo que a imagem indica a **cor**, não o
modelo. Sem ela a operadora pode tomar a prévia por foto e descrever para a
cliente uma peça que não existe.

### Prévia 3D em cada card, com UM contexto WebGL

O catálogo mostra a peça em 3D em todos os cards. O que torna isso viável é
não haver um `<Canvas>` por card: o navegador só mantém 8 a 16 contextos WebGL
vivos e passa a **descartar os mais antigos em silêncio** — os primeiros cards
virariam retângulos pretos sem erro nenhum no console.

A solução é o `View` do drei: **um** canvas fixo cobrindo a janela desenha N
viewports recortados por scissor, cada um seguindo o retângulo de um card. Um
contexto, quantos cards a loja quiser. O teste E2E protege exatamente essa
invariante — a grade tem vários cards e `page.locator('canvas')` tem contagem
1.

Economia de GPU, que aqui pesa mais que na consulta (dezenas de peças em vez
de uma): `frameloop="demand"` (parado não desenha nada; rolar ou passar o
mouse é que pede quadro), só a peça sob o cursor gira, `IntersectionObserver`
com margem de 240 px para só o card visível virar peça na cena, e `dpr` teto
1,25. O canvas tem `pointer-events: none`, então o clique atravessa e chega no
link do card.

A malha foi extraída para `MalhaDaPeca`, compartilhada entre o card e a
consulta — sem isso as duas divergiriam na primeira alteração.

O resto da economia de GPU é a mesma do login: `frameloop="demand"` ao
repousar, `dpr` em 1.5, aba em segundo plano para tudo, e a cena destruída ao
trocar de rota (teste E2E cobre isso).

### Bug de produto achado pelo E2E

O teste "consultar sem caixa aberto" foi o único que abria o catálogo **sem
passar pela tela de venda** — e falhou. A causa não era o teste: as duas telas
liam o Dexie **uma vez na montagem e nunca mais**. Quem abrisse o catálogo
enquanto a primeira carga ainda descia via "o catálogo ainda não sincronizou"
e continuava vendo, mesmo depois de os produtos chegarem. Só sair e voltar
resolvia, e a operadora não tem como saber disso.

Corrigido com `liveQuery` do Dexie nas duas telas: a lista se preenche sozinha
conforme o motor grava. É o comportamento correto para um app offline-first,
onde o banco local muda embaixo da tela o tempo todo.

Também virou lacuna de acessibilidade fechada: o botão de cor não tinha rótulo
próprio, e o nome acessível saía da amostra mais o texto. Agora tem
`aria-label` explícito, como o de tamanho já tinha.

### Detalhes que vieram do balcão

- A tela abre na primeira combinação **com saldo**, não na primeira cadastrada
  (`primeiraCombinacaoDisponivel`). Abrir num tamanho esgotado faria a
  operadora ler "0" e achar que o produto inteiro acabou.
- Tamanho que não existe naquela cor continua clicável, e o rótulo diz "não
  vendido nesta cor". Desabilitar deixaria a operadora sem saber se o problema
  é a cor ou o tamanho.
- A rota aceita id de produto **ou** de variante. A tela de venda trabalha com
  variantes, e um link colado de lá não pode dar "não encontrado" por uma
  diferença que a operadora não vê.
- Consultar funciona sem caixa aberto; só o botão de lançar fica desabilitado,
  com o motivo escrito e um link para abrir o caixa. Consultar produto é o que
  a loja mais faz, inclusive antes de abrir o turno.

---

## Fases restantes da interface

5. Finalização e comprovante em tela, com animação 3D de confirmação
6. Fechamento de caixa (conferência às cegas)
7. Sangria e suprimento
8. Estoque e produtos (upload de XML)
9. Clientes e fiado (validação de CPF)
10. Relatórios (exportar CSV, gráficos simples — nunca gráfico 3D)
11. Configurações e usuários (inclui o interruptor do 3D e o texto da
    política de troca)

---

## Estado ao final desta sessão

- **441 testes passando**: 272 unitários (90 em `packages/shared`, 7 em
  `apps/api`, 175 em `apps/pdv`), 107 de integração contra Postgres real, e 62
  E2E no Playwright. `tsc --strict` limpo nos quatro workspaces.
- Fases 0 a 4 da interface concluídas: venda, catálogo visual e consulta de
  produto com prévia 3D.
- **7 specs E2E seguem pendentes** (devolução, fluxo completo, histórico).
  Não estão quebrados: a funcionalidade existe e tem cobertura de integração
  no backend; o que falta é a tela, que volta nas Fases 5 a 7. Cada arquivo
  traz no cabeçalho o motivo e a fase de retorno.
- Pendências antigas ainda abertas: ícones reais do PWA (hoje são
  placeholder), impressora térmica real nunca testada fisicamente.
- Quatro bancos PostgreSQL em uso: `pdv` (desenvolvimento), `pdv_teste`
  (integração), `pdv_e2e` (Playwright), todos no mesmo contêiner Docker na
  porta 5433 (não 5432, por conflito com Postgres nativo da máquina).

### Restrição de ambiente que atrapalha os testes

A máquina de desenvolvimento tem 7,3 GB de RAM, e o gargalo **não é a RAM
física** — é o *commit limit* do Windows. Medido com a suíte quebrando:

    Fisica livre : 0,18 GB   <- normal no Windows, ele usa RAM como cache
    Commit usado : 28,11 GB de 29,28 GB  (96%)   <- ESTE e o problema

Quando o commit chega no teto, qualquer alocação nova falha na hora. É o que
produz `FATAL ERROR: Zone Allocation failed` no worker do Playwright e
`HTTP 500` no login (o scrypt pede 32 MB por chamada e não consegue). Os
testes quebram em lugares **diferentes a cada rodada** — sinal de contenção,
nunca de regressão. Antes de investigar um teste vermelho, medir o commit.

O que estava consumindo (private bytes, medido com `Get-Process`):

| processo | commit | observação |
|---|---|---|
| vmmem + vmmemWSL | 4,3 GB | as duas VMs do Docker/WSL |
| msedgewebview2 (41 proc.) | 2,7 GB | webviews do VS Code |
| Code (18 proc.) | 2,4 GB | VS Code |
| **oracle** | 2,1 GB | Oracle XE como serviço automático |
| sqldeveloper64W | 0,9 GB | Oracle SQL Developer |
| **mysqld** | 0,7 GB | MySQL como serviço automático |

Oracle XE e MySQL sobem sozinhos com o Windows e **não são usados por este
projeto** — o PDV só precisa do Postgres, que roda no Docker. Pará-los devolveu
2,4 GB e a folga de commit foi de 1,17 GB para 3,61 GB, o bastante para a
suíte E2E completa passar inteira pela primeira vez.

Comando (exige administrador; os serviços voltam sozinhos no próximo boot):

```powershell
Stop-Service OracleServiceXE, OracleOraDB21Home1TNSListener,
             OracleOraDB21Home1MTSRecoveryService, MySQL97 -Force
```

Outras folgas disponíveis, se precisar de mais: criar `~/.wslconfig`
limitando a VM do Docker a 2 GB (não existe hoje, então o WSL pode reservar
até metade da máquina), e aumentar o arquivo de paginação para subir o teto de
commit — só há 15,9 GB livres no disco, então cabe pouco.

O custo do scrypt **não foi reduzido** e não deve ser: baixá-lo enfraqueceria
a senha de todos os operadores para resolver um problema de memória da máquina
de desenvolvimento.

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
