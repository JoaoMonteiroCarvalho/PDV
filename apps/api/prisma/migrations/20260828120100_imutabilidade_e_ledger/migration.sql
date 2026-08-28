-- ============================================================================
-- Imutabilidade de documentos financeiros + apoio ao livro-razão de estoque
--
-- Esta migration existe porque "a aplicação não faz UPDATE" é uma promessa, e
-- promessa não sobrevive a um hotfix às 19h de sábado, a um script de
-- correção rodado direto no psql, ou a um ORM mal usado. A regra passa a ser
-- imposta pelo banco: quem tentar alterar uma venda fechada recebe erro.
--
-- Tabelas travadas (INSERT-only):
--   Venda, ItemVenda, Pagamento, Cancelamento  -> o documento de venda
--   MovimentoEstoque                           -> o livro-razão
--   RegistroAuditoria                          -> a trilha de auditoria
--
-- Correção de uma venda errada NÃO é UPDATE: é um registro em Cancelamento
-- apontando para a venda original, mais os movimentos de estoque de retorno.
-- O histórico do que aconteceu de fato nunca é reescrito.
--
-- Observação: triggers de linha não disparam em TRUNCATE, então a limpeza de
-- base entre testes automatizados continua possível via TRUNCATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION pdv_bloquear_alteracao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'PDV: documento financeiro imutavel. Tentativa de % na tabela "%" foi bloqueada. Para corrigir, registre um documento de cancelamento/devolucao vinculado ao original.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION pdv_bloquear_alteracao() IS
  'Impede UPDATE e DELETE em tabelas de documento financeiro. Ver migration 20260828120100.';

-- --- Documento de venda -----------------------------------------------------

CREATE TRIGGER venda_imutavel
  BEFORE UPDATE OR DELETE ON "Venda"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

CREATE TRIGGER item_venda_imutavel
  BEFORE UPDATE OR DELETE ON "ItemVenda"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

CREATE TRIGGER pagamento_imutavel
  BEFORE UPDATE OR DELETE ON "Pagamento"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

CREATE TRIGGER cancelamento_imutavel
  BEFORE UPDATE OR DELETE ON "Cancelamento"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

-- --- Livro-razão de estoque -------------------------------------------------

CREATE TRIGGER movimento_estoque_imutavel
  BEFORE UPDATE OR DELETE ON "MovimentoEstoque"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

-- --- Trilha de auditoria ----------------------------------------------------

CREATE TRIGGER auditoria_imutavel
  BEFORE UPDATE OR DELETE ON "RegistroAuditoria"
  FOR EACH ROW EXECUTE FUNCTION pdv_bloquear_alteracao();

-- ============================================================================
-- Regras de integridade que o schema Prisma não consegue expressar
-- ============================================================================

-- Movimento de estoque com quantidade zero é ruído no livro-razão.
ALTER TABLE "MovimentoEstoque"
  ADD CONSTRAINT "movimento_estoque_quantidade_nao_zero"
  CHECK ("quantidade" <> 0);

-- Preço e custo nunca são negativos.
ALTER TABLE "Variante"
  ADD CONSTRAINT "variante_preco_nao_negativo" CHECK ("precoCentavos" >= 0),
  ADD CONSTRAINT "variante_custo_nao_negativo" CHECK ("custoCentavos" >= 0);

-- Quantidade vendida é sempre positiva; devolução é documento separado.
ALTER TABLE "ItemVenda"
  ADD CONSTRAINT "item_venda_quantidade_positiva" CHECK ("quantidade" > 0),
  ADD CONSTRAINT "item_venda_desconto_nao_negativo" CHECK ("descontoCentavos" >= 0),
  ADD CONSTRAINT "item_venda_preco_nao_negativo" CHECK ("precoUnitarioCentavos" >= 0);

-- O desconto nunca pode exceder o valor bruto do item (total negativo).
ALTER TABLE "ItemVenda"
  ADD CONSTRAINT "item_venda_total_coerente"
  CHECK ("totalCentavos" = "precoUnitarioCentavos" * "quantidade" - "descontoCentavos"
         AND "totalCentavos" >= 0);

-- O total da venda tem que fechar com subtotal menos desconto. Se um bug de
-- cálculo escapar dos testes, ele para aqui e não vira dinheiro errado no caixa.
ALTER TABLE "Venda"
  ADD CONSTRAINT "venda_total_coerente"
  CHECK ("totalCentavos" = "subtotalCentavos" - "descontoCentavos"
         AND "totalCentavos" >= 0
         AND "descontoCentavos" >= 0);

-- Troco só existe em pagamento; valor de pagamento é positivo.
ALTER TABLE "Pagamento"
  ADD CONSTRAINT "pagamento_valor_positivo" CHECK ("valorCentavos" > 0),
  ADD CONSTRAINT "pagamento_troco_nao_negativo" CHECK ("trocoCentavos" >= 0);

-- Parcela de crediário sempre tem valor positivo.
ALTER TABLE "ParcelaCrediario"
  ADD CONSTRAINT "parcela_valor_positivo" CHECK ("valorCentavos" > 0);

-- ============================================================================
-- Saldo de estoque: derivado, nunca armazenado
--
-- Esta view é a ÚNICA fonte de verdade sobre quantidade disponível. Não existe
-- coluna "quantidadeAtual" em lugar nenhum para alguém editar à mão.
-- ============================================================================

CREATE VIEW "EstoqueAtual" AS
SELECT
  v."id"                                   AS "varianteId",
  v."sku",
  v."produtoId",
  COALESCE(SUM(m."quantidade"), 0)::int    AS "saldo",
  MAX(m."criadoEm")                        AS "ultimoMovimentoEm"
FROM "Variante" v
LEFT JOIN "MovimentoEstoque" m ON m."varianteId" = v."id"
GROUP BY v."id", v."sku", v."produtoId";

COMMENT ON VIEW "EstoqueAtual" IS
  'Saldo de estoque derivado da soma do livro-razao MovimentoEstoque. Nao ha campo de saldo editavel no sistema.';

-- Índice que sustenta a soma do saldo por variante.
CREATE INDEX IF NOT EXISTS "MovimentoEstoque_varianteId_quantidade_idx"
  ON "MovimentoEstoque" ("varianteId") INCLUDE ("quantidade");
