# Maturix — container único (API Fastify + dashboard Next.js estático).
# Build multi-stage: compila backend (tsc) e dashboard (next export), roda enxuto.
#
# Base bookworm (não-slim) porque bcrypt/sharp/ffmpeg-static usam binários
# nativos; a imagem cheia evita libs faltando em runtime.
FROM node:20-bookworm AS build

WORKDIR /app

# 1) Dependências do backend (cache de camada).
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

# 2) Código do backend + gera Prisma Client + compila TS -> dist/
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
RUN npm run build

# 3) Dashboard Next.js (static export -> dashboard/out/).
#    NEXT_PUBLIC_API_URL vazio = URLs relativas (same-origin em produção).
COPY dashboard ./dashboard
RUN npm --prefix dashboard install --no-audit --no-fund \
    && npm --prefix dashboard run build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static export do Next.js vai para web/dist — Fastify já serve daqui.
COPY --from=build /app/dashboard/out ./web/dist

RUN mkdir -p sessions media/images media/audio media/stickers media/video media/uploads
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
