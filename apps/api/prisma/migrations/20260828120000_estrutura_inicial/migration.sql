-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('OPERADOR', 'GERENTE', 'ADMIN');

-- CreateEnum
CREATE TYPE "StatusSessaoCaixa" AS ENUM ('ABERTA', 'FECHADA');

-- CreateEnum
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('ABERTURA', 'SUPRIMENTO', 'SANGRIA', 'VENDA_DINHEIRO', 'RECEBIMENTO_CREDIARIO', 'CANCELAMENTO', 'FECHAMENTO');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'DEBITO', 'CREDITO', 'PIX', 'CREDIARIO');

-- CreateEnum
CREATE TYPE "TipoMovimentoEstoque" AS ENUM ('ENTRADA_COMPRA', 'VENDA', 'CANCELAMENTO_VENDA', 'DEVOLUCAO', 'AJUSTE_INVENTARIO', 'PERDA', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "StatusTitulo" AS ENUM ('ABERTO', 'QUITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusParcela" AS ENUM ('ABERTA', 'PAGA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'OPERADOR',
    "limiteDescontoBps" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "limiteCrediarioCentavos" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "marca" TEXT,
    "categoriaId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ncm" TEXT,
    "cest" TEXT,
    "origem" INTEGER,
    "situacaoTributaria" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variante" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "codigoBarras" TEXT,
    "tamanho" TEXT,
    "cor" TEXT,
    "precoCentavos" INTEGER NOT NULL,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessaoCaixa" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "status" "StatusSessaoCaixa" NOT NULL DEFAULT 'ABERTA',
    "fundoTrocoCentavos" INTEGER NOT NULL DEFAULT 0,
    "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadaEm" TIMESTAMP(3),
    "valorContadoCentavos" INTEGER,
    "diferencaCentavos" INTEGER,

    CONSTRAINT "SessaoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoCaixa" (
    "id" TEXT NOT NULL,
    "sessaoCaixaId" TEXT NOT NULL,
    "tipo" "TipoMovimentoCaixa" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "observacao" TEXT,
    "usuarioId" TEXT NOT NULL,
    "autorizadoPorId" TEXT,
    "documentoTipo" TEXT,
    "documentoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venda" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "sessaoCaixaId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "clienteId" TEXT,
    "subtotalCentavos" INTEGER NOT NULL,
    "descontoCentavos" INTEGER NOT NULL DEFAULT 0,
    "totalCentavos" INTEGER NOT NULL,
    "criadaEmCliente" TIMESTAMP(3) NOT NULL,
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVenda" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "tamanho" TEXT,
    "cor" TEXT,
    "quantidade" INTEGER NOT NULL,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "descontoCentavos" INTEGER NOT NULL DEFAULT 0,
    "totalCentavos" INTEGER NOT NULL,
    "autorizadoPorId" TEXT,

    CONSTRAINT "ItemVenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "trocoCentavos" INTEGER NOT NULL DEFAULT 0,
    "bandeira" TEXT,
    "autorizacao" TEXT,
    "parcelasCartao" INTEGER,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancelamento" (
    "id" TEXT NOT NULL,
    "vendaOriginalId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "autorizadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancelamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoEstoque" (
    "id" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "tipo" "TipoMovimentoEstoque" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitarioCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendaId" TEXT,
    "documentoTipo" TEXT,
    "documentoId" TEXT,
    "usuarioId" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TituloCrediario" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "valorTotalCentavos" INTEGER NOT NULL,
    "status" "StatusTitulo" NOT NULL DEFAULT 'ABERTO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TituloCrediario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelaCrediario" (
    "id" TEXT NOT NULL,
    "tituloId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "StatusParcela" NOT NULL DEFAULT 'ABERTA',

    CONSTRAINT "ParcelaCrediario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecebimentoParcela" (
    "id" TEXT NOT NULL,
    "parcelaId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "sessaoCaixaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecebimentoParcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroAuditoria" (
    "id" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "autorizadoPorId" TEXT,
    "valorAntes" JSONB,
    "valorDepois" JSONB,
    "terminalId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_login_key" ON "Usuario"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cpf_key" ON "Cliente"("cpf");

-- CreateIndex
CREATE INDEX "Cliente_nome_idx" ON "Cliente"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nome_key" ON "Categoria"("nome");

-- CreateIndex
CREATE INDEX "Produto_nome_idx" ON "Produto"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Variante_sku_key" ON "Variante"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Variante_codigoBarras_key" ON "Variante"("codigoBarras");

-- CreateIndex
CREATE INDEX "Variante_atualizadoEm_idx" ON "Variante"("atualizadoEm");

-- CreateIndex
CREATE INDEX "Variante_produtoId_idx" ON "Variante"("produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_nome_key" ON "Terminal"("nome");

-- CreateIndex
CREATE INDEX "SessaoCaixa_terminalId_status_idx" ON "SessaoCaixa"("terminalId", "status");

-- CreateIndex
CREATE INDEX "MovimentoCaixa_sessaoCaixaId_criadoEm_idx" ON "MovimentoCaixa"("sessaoCaixaId", "criadoEm");

-- CreateIndex
CREATE INDEX "Venda_sessaoCaixaId_idx" ON "Venda"("sessaoCaixaId");

-- CreateIndex
CREATE INDEX "Venda_registradaEm_idx" ON "Venda"("registradaEm");

-- CreateIndex
CREATE INDEX "ItemVenda_varianteId_idx" ON "ItemVenda"("varianteId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemVenda_vendaId_sequencia_key" ON "ItemVenda"("vendaId", "sequencia");

-- CreateIndex
CREATE INDEX "Pagamento_vendaId_idx" ON "Pagamento"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "Cancelamento_vendaOriginalId_key" ON "Cancelamento"("vendaOriginalId");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_varianteId_criadoEm_idx" ON "MovimentoEstoque"("varianteId", "criadoEm");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_criadoEm_idx" ON "MovimentoEstoque"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "TituloCrediario_vendaId_key" ON "TituloCrediario"("vendaId");

-- CreateIndex
CREATE INDEX "TituloCrediario_clienteId_status_idx" ON "TituloCrediario"("clienteId", "status");

-- CreateIndex
CREATE INDEX "ParcelaCrediario_vencimento_status_idx" ON "ParcelaCrediario"("vencimento", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaCrediario_tituloId_numero_key" ON "ParcelaCrediario"("tituloId", "numero");

-- CreateIndex
CREATE INDEX "RecebimentoParcela_parcelaId_idx" ON "RecebimentoParcela"("parcelaId");

-- CreateIndex
CREATE INDEX "RegistroAuditoria_acao_criadoEm_idx" ON "RegistroAuditoria"("acao", "criadoEm");

-- CreateIndex
CREATE INDEX "RegistroAuditoria_entidade_entidadeId_idx" ON "RegistroAuditoria"("entidade", "entidadeId");

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoCaixa" ADD CONSTRAINT "SessaoCaixa_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoCaixa" ADD CONSTRAINT "SessaoCaixa_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_sessaoCaixaId_fkey" FOREIGN KEY ("sessaoCaixaId") REFERENCES "SessaoCaixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_sessaoCaixaId_fkey" FOREIGN KEY ("sessaoCaixaId") REFERENCES "SessaoCaixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancelamento" ADD CONSTRAINT "Cancelamento_vendaOriginalId_fkey" FOREIGN KEY ("vendaOriginalId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancelamento" ADD CONSTRAINT "Cancelamento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancelamento" ADD CONSTRAINT "Cancelamento_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloCrediario" ADD CONSTRAINT "TituloCrediario_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloCrediario" ADD CONSTRAINT "TituloCrediario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaCrediario" ADD CONSTRAINT "ParcelaCrediario_tituloId_fkey" FOREIGN KEY ("tituloId") REFERENCES "TituloCrediario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoParcela" ADD CONSTRAINT "RecebimentoParcela_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaCrediario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoParcela" ADD CONSTRAINT "RecebimentoParcela_sessaoCaixaId_fkey" FOREIGN KEY ("sessaoCaixaId") REFERENCES "SessaoCaixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoParcela" ADD CONSTRAINT "RecebimentoParcela_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAuditoria" ADD CONSTRAINT "RegistroAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAuditoria" ADD CONSTRAINT "RegistroAuditoria_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

