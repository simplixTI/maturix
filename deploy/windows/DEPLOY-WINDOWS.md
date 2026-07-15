# Deploy no VPS Windows (via RDP) — Maturador WhatsApp

Guia para rodar o sistema 24/7 num VPS Windows, acessível por um subdomínio com
HTTPS. Você executa pelo **RDP** (Área de Trabalho Remota); eu te acompanho.

Arquitetura final:
```
VPS Windows (maturador.SEUDOMINIO.com)
├── PostgreSQL            (serviço, auto-start)
├── MaturadorAPI          (node dist/index.js, via NSSM — auto-start + auto-restart)
├── web/dist              (painel estático)
└── MaturadorCaddy        (Caddy: proxy reverso + HTTPS automático, via NSSM)
```

---

## 0. Antes de começar

- **DNS:** crie um registro **A** `maturador.SEUDOMINIO.com` → **191.96.79.142** (IP do VPS).
  (O Caddy só emite o certificado HTTPS depois que o DNS estiver propagado.)
- **🔐 Troque a senha** de Administrador do VPS — a que você mandou no chat está exposta.

---

## 1. Transferir o projeto para o VPS

No **seu PC** (não no VPS), gere um pacote limpo (sem `node_modules`):

```powershell
# Rode na pasta do projeto, no seu PC:
powershell -ExecutionPolicy Bypass -File .\deploy\windows\0-make-package.ps1
# → cria  maturador-deploy.zip  na sua Área de Trabalho
```

Copie o `maturador-deploy.zip` para o VPS via RDP:
1. Abra o RDP (`mstsc`). Antes de conectar: **Mostrar Opções → Recursos Locais →
   Mais → Unidades** → marque seu disco. Conecte.
2. Dentro do VPS, o seu disco aparece em "Este Computador". Copie o zip.
3. Extraia para **`C:\maturador`** (o caminho exato importa). Deve ficar
   `C:\maturador\package.json`.

---

## 2. Instalar as ferramentas (no VPS)

Abra o **PowerShell como Administrador** e rode (escolha uma senha forte pro
Postgres — **anote**, vai ser usada no passo 3):

```powershell
cd C:\maturador\deploy\windows
powershell -ExecutionPolicy Bypass -File .\1-install-tools.ps1 -PgPassword "SuaSenhaPostgresForte"
```

Isso instala Chocolatey, Node.js, Git, PostgreSQL, NSSM e Caddy, e libera as
portas 80/443. **Feche e reabra o PowerShell** ao terminar (pra carregar o PATH).

---

## 3. Deploy (build + banco + serviços)

No PowerShell **Administrador** reaberto:

```powershell
cd C:\maturador\deploy\windows
powershell -ExecutionPolicy Bypass -File .\2-deploy.ps1 -Domain "maturador.SEUDOMINIO.com" -PgPassword "SuaSenhaPostgresForte"
```

O script: gera o `.env`, cria o banco, instala dependências, builda backend +
painel, sobe os serviços **MaturadorAPI** e **MaturadorCaddy** (auto-start no boot,
auto-restart em crash) e valida.

Em ~1 min (após o Caddy emitir o certificado), acesse:
**`https://maturador.SEUDOMINIO.com`** → faça login (admin padrão criado no boot).

---

## 4. Parear os números

No painel → **Contas → Conectar conta** → escaneie o QR.
- O pareamento é **direto** (QR confiável).
- Ao conectar, cada número **recebe um proxy SOCKS5 residencial automaticamente**
  (`PROXY_AUTO_ASSIGN=true`) — essencial no VPS, cujo IP é datacenter.
- Cadastre seus proxies decodo em **Proxies** se ainda não estiverem (formato
  SOCKS5: host `gate.decodo.com`, porta `7000`, usuário
  `user-spn3bautck-session-N-sessionduration-60-country-br`).

---

## 5. Operação / manutenção

```powershell
# Status / logs
Get-Service MaturadorAPI, MaturadorCaddy
Get-Content C:\maturador\logs\api.err.log -Tail 50

# Reiniciar / parar
nssm restart MaturadorAPI
nssm stop MaturadorAPI

# Atualizar o código: substitua os arquivos em C:\maturador e rode de novo:
cd C:\maturador\deploy\windows
.\2-deploy.ps1 -Domain "maturador.SEUDOMINIO.com" -PgPassword "SuaSenhaPostgresForte"
```

---

## Notas
- **Postgres é local no VPS** — não precisa de Supabase.
- O **lock de instância** garante que só 1 backend roda (mesmo se o serviço
  reiniciar). Nunca rode `npm run dev` junto com o serviço.
- Backup simples do banco: `pg_dump -U postgres maturador > backup.sql`.
- A pasta `sessions/` guarda o login dos números — **faça backup dela** (e do `.env`).
