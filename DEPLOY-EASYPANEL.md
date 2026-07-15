# Deploy no EasyPanel

Container único: o backend Fastify serve a API, o socket.io **e** o frontend
`web/` (build Vite) na mesma origem. Só precisa de um serviço Postgres ao lado.

## ⚠️ Antes de começar

1. **Troque a senha root da VPS** (`passwd`) — ela foi exposta em texto.
2. **Não conecte chips nem inicie o aquecimento sem proxy residencial.** O IP da
   VPS é datacenter e o WhatsApp bane. O motor sobe *parado* por padrão; conecte
   números só depois de cadastrar proxies no painel.

---

## 1. Subir o código para o GitHub

O `.gitignore` já exclui `.env`, `sessions/` e `node_modules` — nada sensível vai
junto. Na raiz do projeto:

```bash
git init
git add .
git commit -m "chore: deploy inicial (Docker + EasyPanel)"
# crie um repositório PRIVADO no GitHub e então:
git remote add origin git@github.com:SEU_USUARIO/maturador-whatsapp.git
git branch -M main
git push -u origin main
```

> Confirme que `sessions/` e `.env` **não** aparecem em `git status` antes do commit.

---

## 2. Instalar o EasyPanel na VPS (se ainda não tiver)

Via SSH na VPS (Ubuntu/Debian):

```bash
curl -sSL https://get.easypanel.io | sh
```

Depois acesse `http://147.93.190.204:3000` (porta padrão do EasyPanel) e crie o
usuário admin. Aponte um domínio/subdomínio para o IP da VPS (registro A).

---

## 3. Criar o serviço Postgres

No EasyPanel: **+ Create Service → Postgres**.
- Nome: `postgres` (anote o nome — vira o host interno)
- Defina uma senha forte
- Crie o database `maturador`

Anote a connection string interna, algo como:
`postgresql://postgres:SENHA@<projeto>_postgres:5432/maturador`

---

## 4. Criar o App

**+ Create Service → App**.

**Source:**
- GitHub → selecione o repositório `maturador-whatsapp`, branch `main`

**Build:**
- Método: **Dockerfile** (o repo já tem um na raiz)

**Environment:** cole as variáveis do `.env.easypanel.example`, ajustando:
- `DATABASE_URL` → a string do passo 3
- `SESSION_ENCRYPTION_KEY` → gere com `openssl rand -hex 32`
- `CORS_ORIGIN` → seu domínio público (ex.: `https://maturador.seudominio.com`)

**Ports / Domains:**
- Container port: `3000`
- Adicione o domínio e ative HTTPS (Let's Encrypt no próprio EasyPanel)

**Volumes (persistência — importante!):**
| Mount path no container | Para quê |
|---|---|
| `/app/sessions` | Credenciais dos chips pareados. **Sem isso, todo redeploy re-pareia tudo.** |
| `/app/media` | Mídias enviadas pelo painel |

Crie os dois como *Volume* nomeado no EasyPanel.

---

## 5. Deploy e primeiro boot

Clique **Deploy**. Na primeira subida o `docker-entrypoint.sh` roda
`prisma db push` (cria as tabelas) e sobe o servidor. Nos logs você verá
`Maturador WhatsApp fully operational`.

**Login inicial do painel** (usuário semeado automaticamente):
- email: `admin@braske.com`
- senha: `braske2026`

**Troque essa senha imediatamente** após o primeiro login.

---

## 6. Depois de subir

1. Cadastre os **proxies residenciais** no painel (aba Proxies).
2. Só então **pareie os chips** (QR/pairing code).
3. Inicie o aquecimento pela dashboard quando estiver pronto.

## Redeploys

Cada `git push` na branch conectada → **Deploy** no EasyPanel reconstrói a imagem.
Os volumes `sessions/` e `media/` persistem, então os chips continuam pareados.
