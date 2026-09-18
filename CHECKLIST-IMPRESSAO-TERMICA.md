# Checklist de validação — impressão térmica com hardware real

## Contexto

O sistema **nunca imprimiu num equipamento físico**. A investigação a seguir
separa o que já foi validado (formatação de texto, HTML gerado) do que só um
teste com impressora real resolve.

## O que existe hoje

`apps/pdv/src/impressao/`:

- **`comprovante.ts`** — monta o texto do comprovante em colunas fixas
  (`COLUNAS = 48`), com testes cobrindo truncamento, alinhamento e conteúdo
  (`comprovante.test.ts`, 18 casos).
- **`imprimir.ts`** — abre uma janela com esse texto num `<pre>` monoespaçado
  e chama `window.print()`. Agora tem testes (`imprimir.test.ts`, 5 casos)
  cobrindo o HTML gerado, escape de conteúdo e o caminho de pop-up bloqueado.

**Não existe nenhum código ESC/POS.** A impressão passa pelo diálogo de
impressão do sistema operacional, não por bytes de controle enviados
diretamente à porta da impressora. Isso foi decisão deliberada documentada no
próprio arquivo: funciona com qualquer impressora que tenha driver Windows,
inclusive térmicas, sem amarrar o sistema a um fabricante.

## Duas descobertas desta revisão

### 1. 48 colunas para 80mm está correto, mas não é universal

Pesquisa em especificações públicas de fabricantes (Epson, Star, Bixolon)
confirma: papel de 80mm em fonte padrão (Font A, 12×24) comporta **42, 48 ou
56 colunas**, dependendo do modelo. 48 é o valor mais comum e uma escolha
razoável — mas **não há garantia de que a impressora específica da loja usa
exatamente 48**. Se a impressora real usar 42, o comprovante estoura a
margem direita; se usar 56, sobra papel em branco à direita, sem quebrar
nada.

**Uma impressora de 58mm usa 30/32/35 colunas** — bem menos que 48. O sistema
**não tem tratamento nenhum para 58mm** hoje: `imprimir.ts` declara
`@page { size: 80mm auto }` fixo, e `COLUNAS = 48` é uma constante única, não
configurável por terminal.

### 2. `@page { size: Nmm auto }` não é confiável em todos os cenários do Chromium

Ao tentar medir programaticamente se 48 colunas cabem fisicamente em 80mm,
gerei um PDF a partir do mesmo HTML/CSS que `imprimir.ts` produz, pedindo
`preferCSSPageSize: true`. **O Chromium ignorou o `@page` e gerou um PDF em
tamanho Carta (215,9 × 279,4mm)** — não 80mm.

Isso tem registro público: há relatos de inconsistência entre impressão
interativa (`window.print()`, que abre o diálogo do SO) e geração de PDF
headless quanto ao respeito ao `@page` em milímetros. A leitura honesta:

- **Em produção, com o diálogo de impressão real do Windows aberto**, o
  driver da impressora térmica normalmente assume o tamanho de página fixo
  configurado nele (a maioria dos drivers de térmica já vem travada em
  "80mm × contínuo"), e nesse caso o `@page` do CSS tende a ser respeitado
  ou irrelevante — quem manda é o driver.
- **Isso não foi verificado nesta revisão** porque exige o diálogo de
  impressão real do SO com um driver de térmica instalado, que um teste
  automatizado headless não abre.
- A geração de PDF headless (o único jeito de medir automaticamente) **não
  é um substituto confiável** para essa verificação — ela reproduziu um modo
  de falha diferente do caminho real de produção.

**Conclusão prática: não dá para provar por teste automatizado que o
comprovante cabe fisicamente em 80mm. Isso só se resolve imprimindo numa
impressora térmica de verdade.**

## Checklist para quando o hardware chegar

Marque cada item testando na impressora real da loja, não em simulação.

### Largura e corte

- [ ] Imprimir um comprovante com todas as seções preenchidas (itens com
      variação de tamanho/cor, desconto, troco, parcelas de crediário,
      política de troca completa) e conferir que **nenhuma linha corta** à
      direita.
- [ ] Se cortar: medir quantas colunas a impressora realmente aceita e
      ajustar `COLUNAS` em `comprovante.ts` (hoje fixo em 48) para esse
      valor.
- [ ] Testar especificamente a linha `ITEM QTD UNIT TOTAL` e a linha de cada
      item — são as mais longas e as primeiras a estourar.
- [ ] Se a loja usar impressora de **58mm**, todo o layout provavelmente
      precisa de uma segunda constante de colunas (30–35) e um jeito de a
      tela de Configurações escolher qual usar por terminal — hoje não
      existe esse controle.

### Corte de papel

- [ ] Conferir se a impressora corta automaticamente ao fim do
      `window.print()`, ou se corta no meio do comprovante por a página CSS
      ter altura errada (`size: 80mm auto` pede altura automática — algumas
      impressoras/drivers lidam mal com isso e cortam numa altura fixa).
- [ ] Se cortar no meio: pode ser necessário forçar uma altura de página
      generosa (`auto` real) ou investigar a opção "página contínua" no
      driver específico da impressora.

### Codificação de caracteres (acentuação)

- [ ] O comprovante grava em português com acentos (`á`, `ã`, `ç`) em
      `montarComprovante`. Conferir se eles saem corretos no papel — muitas
      térmicas usam a página de código do driver, e um acento pode virar
      caractere estranho ou espaço.
- [ ] Se acentuação falhar, o caminho mais seguro é remover acentos do texto
      antes de imprimir (como o sistema já faz deliberadamente na política
      de troca, por este mesmo motivo — ver comentário em
      `impressao/politicaTroca.ts`).

### Diálogo de impressão

- [ ] Confirmar que o diálogo de impressão do Windows abre com a impressora
      térmica pré-selecionada quando ela é a única/padrão — hoje
      `janela.print()` sempre abre o diálogo, exigindo confirmação manual da
      operadora a cada venda. Perguntar à loja se isso é aceitável no
      ritmo do balcão ou se vale investigar impressão silenciosa
      (`kiosk printing` / política de grupo do Windows para pular o
      diálogo).
- [ ] Testar o fluxo com o diálogo cancelado pela operadora por engano —
      confirmar que a venda já gravada não é perdida (ela não deveria ser:
      a impressão acontece depois do registro).

### Caminho de fallback

- [ ] `imprimirComprovante` cai para download de `.txt` quando
      `window.open` devolve `null` (pop-up bloqueado). Testar esse caminho
      de verdade num navegador com bloqueio de pop-up ativo, e confirmar que
      o arquivo baixado abre e imprime corretamente por fora do sistema.

## O que NÃO fazer sem hardware

Não escrever um gerador de bytes ESC/POS "no escuro". Protocolos ESC/POS têm
variações reais entre fabricantes (comandos de corte, gaveta, code page), e
código escrito sem uma impressora para testar contra tem alta chance de
precisar reescrita completa no primeiro teste real. Se a decisão for migrar
de `window.print()` para ESC/POS bruto no futuro, isso deve vir depois de
escolher o modelo de impressora da loja, não antes.
