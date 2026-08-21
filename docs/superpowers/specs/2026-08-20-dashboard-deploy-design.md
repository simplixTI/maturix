# Design: Correção do Build Pipeline e Deploy na VPS

**Data:** 2026-08-20  
**Escopo:** Corrigir migração incompleta de frontend (Vite → Next.js) e preparar deploy com Docker no Hostinger

---

## Contexto

O projeto é um sistema de aquecimento (maturação) de chips WhatsApp com:
- **Backend:** Fastify + TypeScript + Prisma + PostgreSQL + Socket.IO + Baileys
- **Frontend:** Dashboard Next.js 14 (migrado do Vite, mas migração incompleta)

A migração do frontend de `web/` (Vite) para `dashboard/` (Next.js 14) foi feita mas não concluída. O Dockerfile, os scripts do `package.json` e as URLs hardcoded ainda apontam para o caminho antigo, tornando o build e o deploy impossíveis.

---

## Problema Raiz

| Arquivo | Estado atual | Efeito |
|---|---|---|
| `Dockerfile` | `COPY web ./web` + `COPY --from=build /app/web/dist ./web/dist` | Falha — `web/src/` não existe mais |
| `package.json` scripts | `npm --prefix web run build` | Falha — `web/` não tem source |
| `dashboard/src/lib/api.ts` | Default `http://localhost:3000` | Quebra em produção |
| `dashboard/src/lib/socket.ts` | Default `http://localhost:3000` | Socket.IO não conecta em produção |
| Dotfiles | `gitignore`, `dockerignore` (sem `.`) | Git e Docker ignoram os arquivos |
| `docker-compose.yml` | Não existe | Sem como subir na VPS |

---

## Decisões de Arquitetura

### Opção escolhida: Container único (Option A)

- Um único container Docker serve API + dashboard estático na porta 3000
- Next.js compilado como **static export** (`output: 'export'`) → gera HTML/CSS/JS puro em `dashboard/out/`
- Dockerfile copia `dashboard/out/` para `web/dist/` na imagem de runtime
- `server.ts` já serve de `web/dist` com SPA fallback — **nenhuma mudança necessária**
- PostgreSQL como segundo serviço no `docker-compose.yml`

**Por que static export funciona:** Todas as páginas do dashboard usam `"use client"` (CSR puro). Não há Server Components com lógica de servidor, API Routes do Next.js, nem Image Optimization — portanto `output: 'export'` é compatível.

### URLs relativas

Como o dashboard é servido pela mesma origem da API (porta 3000), todas as chamadas HTTP e Socket.IO devem usar URLs relativas, eliminando a necessidade de configurar `NEXT_PUBLIC_API_URL` em produção.

---

## Fluxo de Build (após correção)

```
dashboard/ (Next.js 14)
    ↓  npm --prefix dashboard run build
    ↓  (next.config.mjs: output: 'export')
dashboard/out/          ← HTML/CSS/JS estáticos gerados
    ↓  Dockerfile: COPY --from=build /app/dashboard/out ./web/dist
web/dist/               ← Fastify serve daqui (server.ts inalterado)
    ↓
Container porta 3000:
  /           → dashboard (SPA)
  /api/*      → Fastify routes
  /socket.io/ → Socket.IO
```

---

## Arquivos a Modificar

### 1. `dashboard/next.config.mjs`

Adicionar `output: 'export'` e `trailingSlash: true`:

```js
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { webpackMemoryOptimizations: true },
};
```

`trailingSlash: true` garante que `/overview/` gera `overview/index.html`, compatível com o SPA fallback do Fastify.

### 2. `dashboard/src/lib/api.ts`

Mudar default de URL para string vazia (URL relativa):

```ts
// Antes:
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Depois:
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
```

URLs relativas (`/api/...`) funcionam quando servidas da mesma origem. Em dev local, setar `NEXT_PUBLIC_API_URL=http://localhost:3000` no `.env.local` do dashboard.

### 3. `dashboard/src/lib/socket.ts`

Usar `window.location.origin` como fallback (avaliado em runtime no browser):

```ts
// Antes:
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Depois:
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");
```

### 4. `package.json` (raiz)

Atualizar scripts para apontar para `dashboard/`:

```json
"dev":       "concurrently -k -n api,web -c green,cyan \"npm:dev:api\" \"npm:dev:web\"",
"dev:api":   "tsx watch src/index.ts",
"dev:web":   "npm --prefix dashboard run dev",
"build:web": "npm --prefix dashboard run build",
"setup":     "npm install && npm --prefix dashboard install",
```

### 5. `Dockerfile`

Substituir bloco `web/` pelo `dashboard/`:

```dockerfile
FROM node:20-bookworm AS build

WORKDIR /app

# Backend deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

# Backend compile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
RUN npm run build

# Dashboard (Next.js static export)
COPY dashboard ./dashboard
RUN npm --prefix dashboard install --no-audit --no-fund \
    && npm --prefix dashboard run build

# ─────────────────────────────────────────────────────────
FROM node:20-bookworm AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard/out ./web/dist

RUN mkdir -p sessions media/images media/audio media/stickers media/video media/uploads
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

### 6. `docker-compose.yml` (criar)

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOST: "0.0.0.0"
    volumes:
      - sessions_data:/app/sessions
      - media_data:/app/media
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: maturador
      POSTGRES_USER: maturador
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U maturador"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  postgres_data:
  sessions_data:
  media_data:
```

### 7. `.env.example` (criar / restaurar dotfile)

```env
# Banco de dados (usado pelo Docker Compose e Prisma)
DATABASE_URL=postgresql://maturador:SENHA_AQUI@postgres:5432/maturador
POSTGRES_PASSWORD=SENHA_AQUI

# Auth
JWT_SECRET=gere-com-openssl-rand-base64-32

# Admin inicial (criado no primeiro boot)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=troca-isso

# API pública (deixar vazio = URLs relativas, mesma origem)
NEXT_PUBLIC_API_URL=

# CORS (deixar vazio em produção = same-origin)
CORS_ORIGIN=
```

### 8. Dotfiles — restaurar o `.`

Renomear os arquivos que perderam o ponto:
- `gitignore` → `.gitignore`
- `dockerignore` → `.dockerignore`
- `gitattributes` → `.gitattributes`
- `env.example` → `.env.example` (substituído pelo novo acima)
- `env.easypanel.example` → `.env.easypanel.example`
- `env.production.example` → `.env.production.example`

---

## Fluxo de Deploy no Hostinger

```bash
# 1. Na VPS — clonar o repo
git clone <repo-url> maturador
cd maturador

# 2. Criar .env a partir do exemplo
cp .env.example .env
nano .env   # preencher JWT_SECRET, POSTGRES_PASSWORD, ADMIN_*

# 3. Build e subir
docker compose up -d --build

# 4. Ver logs
docker compose logs -f app
```

Após o primeiro boot, acessar `http://ip-da-vps:3000` → dashboard.

---

## Fora de Escopo (próxima iteração)

- Completar páginas stub: Chats, Envios, Descobrir, Aquecimento
- Implementar refresh de token JWT
- Completar Settings (salvar) e Perfil (salvar foto)
- Nginx/Caddy para HTTPS e domínio personalizado

---

## Critérios de Sucesso

- [ ] `docker compose build` completa sem erros
- [ ] `docker compose up -d` sobe app + postgres
- [ ] `http://vps:3000` carrega o dashboard
- [ ] Login funciona e redireciona para `/overview`
- [ ] Páginas Overview, Accounts, Warmup, Metrics, Proxies, Logs carregam dados reais
- [ ] Socket.IO conecta (indicador verde no sidebar)
