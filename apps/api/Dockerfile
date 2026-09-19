# API do PDV.
#
# O build roda a partir da RAIZ do repositório (ver `context: .` no
# docker-compose.yml): `@pdv/shared` é workspace npm, e uma imagem construída de
# dentro de `apps/api` não enxergaria o pacote irmão.
#
# Duas etapas: a primeira compila, a segunda só executa. O que separa as duas é
# o código-fonte TypeScript, que não precisa existir na imagem final.

# --- Etapa 1: build ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Os manifestos vêm antes do código: enquanto as dependências não mudam, o
# Docker reaproveita a camada do `npm ci`, que é a parte lenta.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pdv/package.json apps/pdv/
COPY e2e/package.json e2e/

# `npm ci` respeita o package-lock e instala os workspaces de uma vez. Os
# scripts de instalação ficam ligados porque o Prisma depende deles.
RUN npm ci --workspace=packages/shared --workspace=apps/api --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# O cliente do Prisma é gerado a partir do schema; sem isto o build do TS
# falha em `@prisma/client`.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# `shared` primeiro: a API importa os tipos dele, que só existem depois do
# `tsc` daquele pacote.
RUN npm run build --workspace=packages/shared \
 && npm run build --workspace=apps/api

# --- Etapa 2: execução ------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# As dependências vêm inteiras da etapa de build, com os symlinks de workspace
# que fazem `@pdv/shared` resolver, e com o cliente Prisma já gerado.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json

COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist

COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
# O schema e as migrations seguem para a imagem: o contêiner aplica as
# migrations pendentes antes de subir.
COPY --from=build /app/apps/api/prisma apps/api/prisma

# Não roda como root: se a API for comprometida, o processo não é dono do
# sistema de arquivos da imagem.
USER node

EXPOSE 3333

# `migrate deploy` aplica só migrations já versionadas — nunca gera uma nova
# nem apaga dado, ao contrário de `migrate dev`. É o comando certo para
# produção, e torna a subida do contêiner idempotente.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/servidor.js"]
