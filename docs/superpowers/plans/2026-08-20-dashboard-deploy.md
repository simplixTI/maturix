# Dashboard Deploy Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a migração incompleta do frontend (Vite → Next.js) e preparar o sistema para deploy em VPS Hostinger via Docker em container único.

**Architecture:** Next.js 14 compilado como static export (`output: 'export'`) gera HTML/CSS/JS em `dashboard/out/`. O Dockerfile copia esse output para `web/dist/`, que o Fastify já serve com SPA fallback. API + dashboard rodam na mesma porta 3000 — sem CORS, sem proxy reverso.

**Tech Stack:** Node.js 20, Fastify 5, Next.js 14, TypeScript, Prisma + PostgreSQL, Socket.IO, Docker, docker-compose v2.

---

## Mapa de Arquivos

| Arquivo | Ação | O que muda |
|---|---|---|
| `gitignore` | Modificar + renomear para `.gitignore` | Remover linha `dashboard/` |
| `dockerignore` | Modificar + renomear para `.dockerignore` | Remover linha `dashboard` |
| `gitattributes` | Renomear para `.gitattributes` | Sem mudança de conteúdo |
| `env` | Renomear para `.env` | Sem mudança de conteúdo (dev local) |
| `env.example` | Renomear para `.env.example` | Conteúdo substituído (adicionar JWT_SECRET, ADMIN_*) |
| `env.easypanel.example` | Renomear para `.env.easypanel.example` | Sem mudança |
| `env.production.example` | Renomear para `.env.production.example` | Sem mudança |
| `dashboard/next.config.mjs` | Modificar | Adicionar `output: 'export'`, `trailingSlash: true` |
| `dashboard/src/lib/api.ts` | Modificar linha 1 | Default URL de `"http://localhost:3000"` para `""` |
| `dashboard/src/lib/socket.ts` | Modificar linha 6 | Default URL para `window.location.origin` |
| `Dockerfile` | Reescrever bloco do frontend | Trocar `web/` por `dashboard/` |
| `package.json` | Modificar scripts | `dev:web`, `build:web`, `setup` apontam para `dashboard/` |
| `docker-compose.yml` | Criar | Serviços `app` + `postgres` + volumes |
| `.env.example` | Criar (conteúdo novo) | Template com todas as variáveis para VPS |

---

## Task 1: Restaurar `.gitignore` sem a linha `dashboard/`

**Files:**
- Modify + rename: `gitignore` → `.gitignore`

**Contexto crítico:** O arquivo `gitignore` (sem ponto) não é reconhecido pelo Git — atualmente não há regras ativas de ignore. Mas ele contém `dashboard/` nas linhas 16-17. Se simplesmente renomearmos sem remover essa linha, o Git passaria a ignorar todo o dashboard.

- [ ] **Step 1: Criar `.gitignore` com conteúdo corrigido**

Criar o arquivo `.gitignore` com o conteúdo do `gitignore` atual mas **sem** as linhas 16-17 (`# Frontend Next.js abandonado` e `dashboard/`):

```
node_modules/
dist/
.env
*.log
media/images/*
media/stickers/*
media/audio/*
!media/images/.gitkeep
!media/stickers/.gitkeep
!media/audio/.gitkeep
dashboard/.next/
dashboard/node_modules/
sessions/
```

- [ ] **Step 2: Deletar o `gitignore` antigo (sem ponto)**

```bash
git rm --cached gitignore 2>/dev/null || true
rm "gitignore"
```

- [ ] **Step 3: Verificar que `.gitignore` está ativo**

```bash
git check-ignore -v dashboard/src/app/page.tsx
```

Esperado: **sem output** (o dashboard NÃO deve ser ignorado agora).

- [ ] **Step 4: Commit parcial**

```bash
git add .gitignore
git commit -m "fix: restore .gitignore and stop ignoring dashboard/"
```

---

## Task 2: Restaurar `.dockerignore` sem a linha `dashboard`

**Files:**
- Modify + rename: `dockerignore` → `.dockerignore`

**Contexto crítico:** `dockerignore` (sem ponto) não é reconhecido pelo Docker. O conteúdo tem `dashboard` na linha 4, que excluiria o dashboard do build context se o arquivo fosse ativado.

- [ ] **Step 1: Criar `.dockerignore` com conteúdo corrigido**

Criar `.dockerignore` com o conteúdo do `dockerignore` atual mas **sem** a linha `dashboard`:

```
# Nunca mandar dependências, builds ou SEGREDOS para o contexto/imagem.
node_modules
web/node_modules
dist
web/dist

# Segredos e estado local
.env
.env.*
!.env.production.example
!.env.easypanel.example

# Credenciais de WhatsApp (auth state dos chips) — jamais na imagem
sessions

# Uploads locais (vêm de volume em produção); mantém só a estrutura via .gitkeep
media/images/*
media/audio/*
media/stickers/*
media/video
media/uploads
!media/images/.gitkeep
!media/audio/.gitkeep
!media/stickers/.gitkeep

# Lixo
*.log
.git
.vscode
.idea
scripts/*.ps1
```

- [ ] **Step 2: Deletar o `dockerignore` antigo**

```bash
rm "dockerignore"
```

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "fix: restore .dockerignore and allow dashboard/ in build context"
```

---

## Task 3: Renomear demais dotfiles

**Files:**
- Rename: `gitattributes` → `.gitattributes`
- Rename: `env` → `.env` (arquivo de dev local, gitignored)
- Rename: `env.example` → será substituído na Task 9
- Rename: `env.easypanel.example` → `.env.easypanel.example`
- Rename: `env.production.example` → `.env.production.example`

- [ ] **Step 1: Renomear `gitattributes`**

```bash
git mv gitattributes .gitattributes 2>/dev/null || mv gitattributes .gitattributes
```

- [ ] **Step 2: Renomear `env` para `.env` (dev local)**

O arquivo `env` contém credenciais de desenvolvimento local. Ele deve ser `.env` (gitignored).

```bash
mv env .env
```

Verificar que `.gitignore` vai ignorar:
```bash
git check-ignore -v .env
```
Esperado: `.gitignore:3:.env    .env`

- [ ] **Step 3: Renomear os `.example` files**

```bash
mv env.easypanel.example .env.easypanel.example
mv env.production.example .env.production.example
```

- [ ] **Step 4: Commit**

```bash
git add .gitattributes .env.easypanel.example .env.production.example
git commit -m "fix: restore dotfile names (.gitattributes, .env.*.example)"
```

---

## Task 4: Corrigir `dashboard/next.config.mjs` para static export

**Files:**
- Modify: `dashboard/next.config.mjs`

**Por quê `trailingSlash: true`:** Com static export, Next.js gera `overview/index.html` (não `overview.html`). O SPA fallback do Fastify (`reply.sendFile('index.html')`) precisa receber a rota sem extensão, o que funciona com trailing slash.

- [ ] **Step 1: Atualizar `dashboard/next.config.mjs`**

Substituir o conteúdo do arquivo por:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verificar que o build local funciona**

```bash
cd dashboard && npm run build
```

Esperado: output em `dashboard/out/` com `index.html`, `overview/index.html`, `login/index.html`, etc.

```bash
ls dashboard/out/
```

Esperado: ver `index.html`, `overview/`, `login/`, `accounts/`, etc.

- [ ] **Step 3: Commit**

```bash
git add dashboard/next.config.mjs
git commit -m "fix: add Next.js static export output for single-container deploy"
```

---

## Task 5: Corrigir URLs em `api.ts` e `socket.ts` para same-origin

**Files:**
- Modify: `dashboard/src/lib/api.ts` (linha 1)
- Modify: `dashboard/src/lib/socket.ts` (linha 6)

**Por quê:** Com `NEXT_PUBLIC_API_URL` vazio em produção, as chamadas HTTP usam URL relativa (`/api/...`) e Socket.IO usa `window.location.origin` — ambos resolvem para o mesmo Fastify na porta 3000. Em dev, setar `NEXT_PUBLIC_API_URL=http://localhost:3000` no `dashboard/.env.local`.

- [ ] **Step 1: Corrigir `dashboard/src/lib/api.ts` linha 1**

Localizar:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
```

Substituir por:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
```

- [ ] **Step 2: Corrigir `dashboard/src/lib/socket.ts` linha 6**

Localizar:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
```

Substituir por:
```ts
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");
```

- [ ] **Step 3: Criar `dashboard/.env.local` para desenvolvimento**

```bash
cat > dashboard/.env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:3000
EOF
```

Verificar que `.gitignore` do dashboard ignora `.env.local`:
```bash
cat dashboard/.gitignore 2>/dev/null | grep env || echo "adicionar manualmente"
```

Se não existir `.gitignore` no dashboard, criar:
```bash
echo ".env.local" >> dashboard/.gitignore
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/socket.ts
git add dashboard/.gitignore 2>/dev/null || true
git commit -m "fix: use relative URLs for same-origin API and Socket.IO in production"
```

---

## Task 6: Corrigir scripts do `package.json` raiz

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Atualizar os 3 scripts no `package.json`**

Localizar no `package.json`:
```json
"dev:web": "npm --prefix web run dev",
"build:web": "npm --prefix web run build",
"setup": "npm install && npm --prefix web install",
```

Substituir por:
```json
"dev:web": "npm --prefix dashboard run dev",
"build:web": "npm --prefix dashboard run build",
"setup": "npm install && npm --prefix dashboard install",
```

- [ ] **Step 2: Verificar que o build:web funciona**

```bash
npm run build:web
```

Esperado: Next.js build sem erros, `dashboard/out/` gerado.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "fix: update build scripts to use dashboard/ instead of web/"
```

---

## Task 7: Reescrever o `Dockerfile` para build do dashboard

**Files:**
- Modify: `Dockerfile`

**Estratégia:** A stage de build compila o Next.js e gera `dashboard/out/`. A stage de runtime copia esse output para `web/dist/`, que o `server.ts` já serve com `@fastify/static` — nenhuma mudança no backend necessária.

- [ ] **Step 1: Substituir o `Dockerfile` completo**

```dockerfile
# Maturador WhatsApp — container único (API Fastify + dashboard Next.js estático).
# Build multi-stage: compila backend (tsc) e dashboard (next export), roda enxuto.
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

# Só o necessário para rodar.
COPY package*.json ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static export do Next.js vai para web/dist — Fastify já serve daqui.
COPY --from=build /app/dashboard/out ./web/dist

# Diretórios de estado montados como volumes em produção (persistência).
# sessions/ = credenciais dos chips; media/ = mídias enviadas pelo painel.
RUN mkdir -p sessions media/images media/audio media/stickers media/video media/uploads
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# Aplica o schema no banco (prisma db push) e sobe o servidor.
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 2: Verificar build local do Docker (opcional mas recomendado)**

```bash
docker build -t maturador-test .
```

Esperado: build sem erros nas 2 stages. Pode levar 3-5 minutos na primeira vez.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "fix: Dockerfile now builds dashboard/ (Next.js) instead of web/ (Vite)"
```

---

## Task 8: Criar `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

**Detalhes:** `env_file: .env` carrega as variáveis do `.env` local. As variáveis de `environment:` sobrescrevem, garantindo que `NODE_ENV`, `PORT` e `HOST` sejam sempre corretos em produção. O `depends_on` com `condition: service_healthy` garante que o Postgres esteja pronto antes do app tentar conectar (o entrypoint roda `prisma db push`).

- [ ] **Step 1: Criar `docker-compose.yml`**

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

- [ ] **Step 2: Validar sintaxe do compose**

```bash
docker compose config
```

Esperado: YAML expandido sem erros.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for VPS deployment (app + postgres)"
```

---

## Task 9: Criar `.env.example` completo para VPS

**Files:**
- Create: `.env.example` (substitui o `env.example` antigo que não tinha JWT_SECRET nem ADMIN_*)

**Contexto:** O `env.example` atual está incompleto — falta `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (necessários para o seed do usuário admin) e `POSTGRES_PASSWORD` (necessário para o docker-compose). O arquivo `env` (dev local) tem essas lacunas também.

- [ ] **Step 1: Criar `.env.example`**

```env
# ── Banco de dados ──────────────────────────────────────────────────────────
# Com docker-compose: host = "postgres" (nome do serviço). Troque SENHA_AQUI.
DATABASE_URL="postgresql://maturador:SENHA_AQUI@postgres:5432/maturador"
POSTGRES_PASSWORD=SENHA_AQUI

# ── Autenticação ─────────────────────────────────────────────────────────────
# Gere com: openssl rand -base64 32
JWT_SECRET=gere-com-openssl-rand-base64-32

# ── Usuário admin inicial (criado no primeiro boot) ──────────────────────────
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=troca-isso-imediatamente

# ── Servidor ─────────────────────────────────────────────────────────────────
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# ── CORS / WebSocket ──────────────────────────────────────────────────────────
# Deixar vazio em produção: dashboard é servido pela mesma origem (same-origin).
# Em dev: http://localhost:3001
CORS_ORIGIN=

# ── Aquecimento (padrões razoáveis, ajuste se necessário) ────────────────────
WARMUP_DAY1_LIMIT=15
WARMUP_TOTAL_DAYS=15
WARMUP_MAX_DAILY=400
WARMUP_INACTIVITY_RESET_HOURS=72

# ── Safe Zone Thresholds ──────────────────────────────────────────────────────
SAFE_MSGS_PER_HOUR=30
SAFE_REPLY_RATE_MIN=0.30
SAFE_BLOCK_RATE_MAX=0.02
SAFE_NEW_CONTACTS_PER_DAY=20
SAFE_IDENTICAL_MSGS_PER_HOUR=5

# ── Conexões ──────────────────────────────────────────────────────────────────
MAX_CONCURRENT_CONNECTIONS=10
RECONNECT_BATCH_SIZE=10
RECONNECT_BATCH_DELAY_MS=5000

# ── Proxies ───────────────────────────────────────────────────────────────────
PROXY_AUTO_ASSIGN=false

# ── Alertas (opcional) ────────────────────────────────────────────────────────
ALERT_WEBHOOK_URL=

# ── Discovery (opcional, Google CSE) ─────────────────────────────────────────
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_CX=
```

- [ ] **Step 2: Remover o `env.example` antigo (sem ponto)**

```bash
rm env.example
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "fix: replace env.example with complete .env.example (JWT_SECRET, ADMIN_*, POSTGRES_PASSWORD)"
```

---

## Task 10: Adicionar `dashboard/` ao git e fazer commit geral

**Files:**
- Track: `dashboard/` (todos os arquivos)

- [ ] **Step 1: Verificar que dashboard não está mais sendo ignorado**

```bash
git status dashboard/
```

Esperado: ver arquivos listados como `Untracked files` (não "nothing to commit" nem "ignored").

- [ ] **Step 2: Adicionar o dashboard ao git**

```bash
git add dashboard/
```

- [ ] **Step 3: Verificar o que será commitado**

```bash
git status
```

Esperado: `dashboard/` aparecer em "Changes to be committed".

- [ ] **Step 4: Commit do dashboard**

```bash
git commit -m "feat: add Next.js 14 dashboard (migração completa de web/ para dashboard/)"
```

---

## Task 11: Teste de build end-to-end (local)

**Files:** nenhum arquivo modificado — só validação.

- [ ] **Step 1: Build da imagem Docker completa**

```bash
docker build -t maturador:latest .
```

Esperado: duas stages completam sem erros. Verificar as linhas:
```
=> [build 6/7] RUN npm --prefix dashboard install ...
=> [build 7/7] RUN npm --prefix dashboard run build
=> [runtime 5/7] COPY --from=build /app/dashboard/out ./web/dist
```

- [ ] **Step 2: Subir com docker-compose localmente (precisa de `.env`)**

Copiar o `.env.example` para `.env` e preencher os valores mínimos:
```bash
cp .env.example .env
```

Editar `.env` e setar pelo menos:
- `DATABASE_URL` com host `postgres` (para docker-compose)
- `POSTGRES_PASSWORD` com qualquer senha
- `JWT_SECRET` com qualquer string de 32+ chars
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`

```bash
docker compose up -d --build
```

- [ ] **Step 3: Verificar que os containers subiram**

```bash
docker compose ps
```

Esperado:
```
NAME              STATUS
maturador-app-1       Up
maturador-postgres-1  Up (healthy)
```

- [ ] **Step 4: Ver logs do app**

```bash
docker compose logs -f app
```

Esperado: ver `[entrypoint] prisma db push...` → `[entrypoint] starting Maturador...` → `API server started`

- [ ] **Step 5: Testar o dashboard no browser**

Abrir `http://localhost:3000` — deve carregar a landing page do dashboard.

Abrir `http://localhost:3000/login` — deve carregar o formulário de login.

Fazer login com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidos no `.env`.

Esperado: redirecionar para `/overview` com dados reais.

- [ ] **Step 6: Testar Socket.IO**

Na página `/overview`, verificar o indicador no sidebar (canto inferior esquerdo).

Esperado: ponto verde "sistema online".

- [ ] **Step 7: Parar os containers locais**

```bash
docker compose down
```

---

## Task 12: Deploy na VPS Hostinger

**Files:** nenhum arquivo no repo — só comandos na VPS.

- [ ] **Step 1: Conectar na VPS via SSH**

```bash
ssh root@IP_DA_VPS
```

- [ ] **Step 2: Instalar Docker e docker-compose (se não tiver)**

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

- [ ] **Step 3: Clonar o repositório**

```bash
git clone <URL_DO_REPO> maturador
cd maturador
```

- [ ] **Step 4: Criar `.env` na VPS**

```bash
cp .env.example .env
nano .env
```

Preencher obrigatoriamente:
- `POSTGRES_PASSWORD` — senha forte (ex: `openssl rand -base64 24`)
- `DATABASE_URL` — trocar `SENHA_AQUI` pela mesma senha acima
- `JWT_SECRET` — gerar com `openssl rand -base64 32`
- `ADMIN_EMAIL` — email do administrador
- `ADMIN_PASSWORD` — senha do admin

- [ ] **Step 5: Build e subir**

```bash
docker compose up -d --build
```

Aguardar 3-5 minutos (primeiro build baixa dependências).

- [ ] **Step 6: Verificar saúde**

```bash
docker compose ps
docker compose logs app | tail -20
```

Esperado: `API server started` nos logs.

- [ ] **Step 7: Acessar o dashboard**

Abrir no browser: `http://IP_DA_VPS:3000`

Fazer login com o email/senha definidos no `.env`.

- [ ] **Step 8: (Opcional) Liberar porta no firewall**

```bash
ufw allow 3000/tcp
```

---

## Critérios de Sucesso

- [ ] `docker compose build` completa sem erros localmente
- [ ] `http://localhost:3000` carrega o dashboard
- [ ] Login funciona e redireciona para `/overview`
- [ ] Indicador Socket.IO fica verde no sidebar
- [ ] Páginas Overview, Accounts, Warmup, Metrics, Proxies, Logs carregam
- [ ] Deploy na VPS: `http://IP:3000` acessível após `docker compose up -d --build`
