-- Configuração da loja: linha única.
--
-- O CHECK no id é o que garante a unicidade. Sem ele, um segundo INSERT criaria
-- uma segunda "loja" e o comprovante passaria a depender de qual linha o código
-- leu primeiro — bug silencioso num documento que a cliente leva embora.
CREATE TABLE "ConfiguracaoLoja" (
    "id" TEXT NOT NULL DEFAULT 'loja',
    "nome" TEXT NOT NULL DEFAULT 'Loja',
    "endereco" TEXT,
    "telefone" TEXT,
    "cnpj" TEXT,
    "politicaTrocaExtra" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoLoja_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configuracao_loja_linha_unica" CHECK ("id" = 'loja')
);

-- A linha nasce junto da tabela: o app nunca precisa tratar "ainda não existe".
INSERT INTO "ConfiguracaoLoja" ("id", "nome", "atualizadoEm")
VALUES ('loja', 'Loja', NOW());
