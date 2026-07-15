# Maturador · Painel (Frontend)

Interface web (React + Vite + TypeScript) para o backend do Maturador WhatsApp.

## Como rodar

O backend precisa estar rodando primeiro (na raiz do projeto):

```bash
npm run dev          # backend em http://localhost:3000
```

Depois, neste diretório `web/`:

```bash
npm install          # só na primeira vez
npm run dev          # painel em http://localhost:3001
```

Abra **http://localhost:3001**.

### Login padrão

- **E-mail:** `admin@braske.com`
- **Senha:** `braske2026`

(Credenciais "seedadas" pelo backend no primeiro boot.)

## Arquitetura

- **Vite + React 18 + TypeScript** — SPA na porta `3001` (o CORS do backend já libera essa origem).
- **TanStack Query** — estado do servidor (cache, refetch, polling).
- **Socket.IO client** — eventos em tempo real: QR de conexão, status de sessão,
  código de pareamento, métricas ao vivo, alertas e logs.
- **Recharts** — gráfico de métricas na Visão geral.
- **qrcode** — renderização do QR de conexão a partir da string do Baileys.
- Design system próprio em `src/styles/` (tokens + estilos), sem framework de CSS.

```
src/
  lib/        api, socket, tipos, formatadores, hooks
  auth/       contexto de autenticação (JWT)
  components/ Layout, Modal, Toast, ConnectModal, ui, Icons
  pages/      Login, Overview, Accounts, Warmup, Send, Conversations,
              Templates, Profiles, WarmingGroups, Discovery, LiveGroups,
              Proxies, Alerts, Logs, Settings
  styles/     tokens.css, global.css
```

## Configuração

A URL da API pode ser sobrescrita via variável de ambiente do Vite:

```bash
# web/.env.local
VITE_API_BASE=http://localhost:3000
```

## Build de produção

```bash
npm run build        # type-check + bundle em dist/
npm run preview      # serve o build localmente
```
