-- Numero da venda passa a ser UNIQUE.
--
-- E o identificador que o operador digita para localizar uma venda ao
-- atender uma devolucao (o comprovante imprime "Venda: {numero}", nao o
-- UUID interno). Sem unicidade o Prisma nao pode usar findUnique nele, e em
-- teoria (ainda que improvavel com SERIAL) duas vendas poderiam colidir.
CREATE UNIQUE INDEX "Venda_numero_key" ON "Venda"("numero");
