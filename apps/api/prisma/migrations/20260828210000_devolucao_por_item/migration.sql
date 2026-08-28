-- ============================================================================
-- Devolução por item, com quantidade parcial.
--
-- Antes: Cancelamento era 1:1 com Venda (uma venda só podia ser cancelada por
-- inteiro, uma vez). Isso não cobre o caso real de moda íntima: cliente
-- compra 3 peças e devolve 1. Agora Cancelamento é o CABEÇALHO do documento
-- de devolução (pode haver vários por venda, ao longo do tempo) e
-- ItemCancelamento registra quanto de cada ItemVenda foi devolvido.
--
-- A Venda original PERMANECE INTOCADA — nenhuma coluna nela muda. Devolução
-- é, como cancelamento sempre foi neste sistema, um documento novo.
-- ============================================================================

CREATE TYPE "FormaEstorno" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'VALE_TROCA');

-- Cancelamento deixa de ser único por venda: uma venda pode ter várias
-- devoluções parciais ao longo do tempo.
DROP INDEX "Cancelamento_vendaOriginalId_key";

ALTER TABLE "Cancelamento" ADD COLUMN "formaEstorno" "FormaEstorno" NOT NULL;

CREATE TABLE "ItemCancelamento" (
    "id" TEXT NOT NULL,
    "cancelamentoId" TEXT NOT NULL,
    "itemVendaId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,

    CONSTRAINT "ItemCancelamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ItemCancelamento_cancelamentoId_idx" ON "ItemCancelamento"("cancelamentoId");
CREATE INDEX "ItemCancelamento_itemVendaId_idx" ON "ItemCancelamento"("itemVendaId");
CREATE INDEX "Cancelamento_vendaOriginalId_idx" ON "Cancelamento"("vendaOriginalId");

ALTER TABLE "ItemCancelamento" ADD CONSTRAINT "ItemCancelamento_cancelamentoId_fkey"
  FOREIGN KEY ("cancelamentoId") REFERENCES "Cancelamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemCancelamento" ADD CONSTRAINT "ItemCancelamento_itemVendaId_fkey"
  FOREIGN KEY ("itemVendaId") REFERENCES "ItemVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Coerência de valores — mesma disciplina da migration de imutabilidade.
-- ============================================================================

ALTER TABLE "ItemCancelamento"
  ADD CONSTRAINT "item_cancelamento_quantidade_positiva" CHECK ("quantidade" > 0),
  ADD CONSTRAINT "item_cancelamento_valor_positivo" CHECK ("valorCentavos" > 0);

ALTER TABLE "Cancelamento"
  ADD CONSTRAINT "cancelamento_valor_positivo" CHECK ("valorCentavos" > 0);

-- ============================================================================
-- Imutabilidade: ItemCancelamento é documento financeiro, entra no mesmo
-- regime de UPDATE/DELETE bloqueados que Venda, ItemVenda, Pagamento etc.
-- (função pdv_bloquear_alteracao já existe, criada em 20260828120100).
-- ============================================================================

CREATE TRIGGER item_cancelamento_imutavel
  BEFORE UPDATE OR DELETE ON "ItemCancelamento"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

-- Cancelamento em si já tinha o trigger de imutabilidade desde a migration
-- anterior; ele continua valendo sem alteração.

-- ============================================================================
-- View de conferência: quanto de cada ItemVenda já foi devolvido.
--
-- O serviço usa isto para impedir devolver mais do que foi vendido — mas a
-- soma agregada por si não é um CHECK simples de linha, por isso vive aqui
-- como view de apoio, não como constraint. A garantia dura é feita pelo
-- serviço dentro de uma transação; esta view é a ferramenta de auditoria e
-- de leitura, não a fonte da regra.
-- ============================================================================

CREATE VIEW "DevolucaoPorItem" AS
SELECT
  iv."id"                                    AS "itemVendaId",
  iv."vendaId",
  iv."quantidade"                            AS "quantidadeVendida",
  COALESCE(SUM(ic."quantidade"), 0)::int     AS "quantidadeDevolvida",
  (iv."quantidade" - COALESCE(SUM(ic."quantidade"), 0)::int) AS "quantidadeDisponivel"
FROM "ItemVenda" iv
LEFT JOIN "ItemCancelamento" ic ON ic."itemVendaId" = iv."id"
GROUP BY iv."id", iv."vendaId", iv."quantidade";

COMMENT ON VIEW "DevolucaoPorItem" IS
  'Quanto de cada item vendido ja foi devolvido. quantidadeDisponivel e o limite para uma nova devolucao.';
