# Maturador WhatsApp — imagem única (API Fastify + socket.io + frontend web/).
# Build multi-stage: compila backend (tsc) e frontend (vite), roda enxuto.
#
# Base bookworm (não-slim) porque bcrypt/sharp/ffmpeg-static usam binários
# nativos; a imagem cheia evita libs faltando em runtime.
FROM node:20-bookworm AS build

WORKDIR /app

# 1) Dependências do backend (cache de camada). Precisa do schema para o
#    `prisma generate` no postinstall/geração explícita abaixo.
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

# 2) Código do backend + gera Prisma Client + compila TS -> dist/
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
RUN npm run build

# 3) Frontend (web/). O `file:..` do web/package.json resolve para /app.
COPY web ./web
RUN npm --prefix web install --no-audit --no-fund \
    && npm --prefix web run build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Só o necessário para rodar.
COPY package*.json ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
# Diretórios de estado montados como volumes em produção (persistência).
# sessions/ = credenciais dos chips; media/ = mídias enviadas pelo painel.
RUN mkdir -p sessions media/images media/audio media/stickers media/video media/uploads
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# Aplica o schema no banco (prisma db push) e sobe o servidor.
ENTRYPOINT ["./docker-entrypoint.sh"]
