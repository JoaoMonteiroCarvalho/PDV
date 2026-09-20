-- Vendedor da venda: quem ATENDEU a cliente.
--
-- Nem sempre é quem operou o caixa. Numa loja com duas pessoas, uma acompanha
-- a prova e a outra fecha a venda — e a comissão é de quem atendeu. Derivar do
-- operador daria a comissão à pessoa errada exatamente nos dias de movimento,
-- que é quando ela mais importa.
--
-- NULÁVEL, e isso não é indecisão: `Venda` é imutável por trigger
-- (ver 20260828120100_imutabilidade_e_ledger). As vendas já registradas não
-- podem receber valor nem por migration, e inventar um vendedor para elas
-- seria fabricar base de comissão. Elas ficam como "não informado" no
-- relatório, que é a verdade sobre o que o sistema sabe.
ALTER TABLE "Venda" ADD COLUMN "vendedorId" TEXT;

ALTER TABLE "Venda"
  ADD CONSTRAINT "Venda_vendedorId_fkey"
  FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sustenta o relatório de comissão: "quanto a Ana vendeu no mês".
CREATE INDEX "Venda_vendedorId_registradaEm_idx" ON "Venda"("vendedorId", "registradaEm");

COMMENT ON COLUMN "Venda"."vendedorId" IS
  'Quem atendeu a cliente. Base da comissao. NULL nas vendas anteriores a este campo — Venda e imutavel e nao aceita backfill.';
