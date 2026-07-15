# ============================================================================
#  2-deploy.ps1  —  Builda o app, prepara o banco e sobe como serviços 24/7.
#  Pré-requisito: rodar 1-install-tools.ps1 antes, e copiar o projeto para
#  C:\maturador (sem node_modules — o npm install é feito aqui).
#
#  Rode (Administrador, no PowerShell, dentro de C:\maturador\deploy\windows):
#     .\2-deploy.ps1 -Domain "maturador.SEUDOMINIO.com" -PgPassword "AS_MESMA_DO_PASSO_1"
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [Parameter(Mandatory = $true)][string]$PgPassword
)
$ErrorActionPreference = 'Stop'
$Root = "C:\maturador"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

if (-not (Test-Path "$Root\package.json")) {
  throw "Projeto não encontrado em $Root. Copie a pasta do projeto para C:\maturador primeiro (sem node_modules)."
}
Set-Location $Root
New-Item -ItemType Directory -Force -Path "$Root\logs" | Out-Null

# --- Localiza binários ---
$node = "C:\Program Files\nodejs\node.exe"
$npm  = "C:\Program Files\nodejs\npm.cmd"
$pgBin = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin" -ErrorAction SilentlyContinue | Select-Object -Last 1).FullName
if (-not $pgBin) { throw "PostgreSQL não encontrado. Rode 1-install-tools.ps1." }
$caddy = (Get-Command caddy -ErrorAction SilentlyContinue).Source
$nssm  = (Get-Command nssm  -ErrorAction SilentlyContinue).Source

# --- .env de produção ---
Step "Gerando .env de produção..."
$key = -join ((1..64) | ForEach-Object { '0123456789abcdef'[(Get-Random -Max 16)] })
@"
DATABASE_URL="postgresql://postgres:$PgPassword@localhost:5432/maturador"
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
SESSION_ENCRYPTION_KEY="$key"
CORS_ORIGIN="https://$Domain"
PROXY_AUTO_ASSIGN=true
WARMUP_DAY1_LIMIT=15
WARMUP_TOTAL_DAYS=15
WARMUP_MAX_DAILY=400
WARMUP_INACTIVITY_RESET_HOURS=72
LOG_LEVEL=info
"@ | Set-Content -Encoding utf8 "$Root\.env"

# --- Banco: cria o database 'maturador' (se não existir) ---
Step "Criando o banco 'maturador'..."
$env:PGPASSWORD = $PgPassword
& "$pgBin\psql.exe" -U postgres -h localhost -tc "SELECT 1 FROM pg_database WHERE datname='maturador'" | Out-String | ForEach-Object {
  if ($_ -notmatch '1') { & "$pgBin\createdb.exe" -U postgres -h localhost maturador }
}

# --- Dependências + build ---
Step "Instalando dependências (raiz + web)... pode demorar."
& $npm install --no-audit --no-fund
& $npm install --prefix web --no-audit --no-fund

Step "Prisma generate + db push..."
& $npm run db:generate
& $npm run db:push

Step "Buildando backend e painel..."
& $npm run build
& $npm run build:web

# --- Serviço do backend Node (NSSM) ---
Step "Registrando serviço do backend (MaturadorAPI)..."
& $nssm stop MaturadorAPI 2>$null; & $nssm remove MaturadorAPI confirm 2>$null
& $nssm install MaturadorAPI $node "$Root\dist\index.js"
& $nssm set MaturadorAPI AppDirectory $Root
& $nssm set MaturadorAPI AppStdout "$Root\logs\api.log"
& $nssm set MaturadorAPI AppStderr "$Root\logs\api.err.log"
& $nssm set MaturadorAPI AppRotateFiles 1
& $nssm set MaturadorAPI Start SERVICE_AUTO_START
& $nssm start MaturadorAPI

# --- Caddyfile com o domínio + serviço do Caddy (NSSM) ---
Step "Configurando Caddy (proxy reverso + HTTPS) para $Domain..."
$caddyfile = "$Root\deploy\windows\Caddyfile"
(Get-Content $caddyfile -Raw).Replace('maturador.SEUDOMINIO.com', $Domain) | Set-Content -Encoding utf8 $caddyfile
& $nssm stop MaturadorCaddy 2>$null; & $nssm remove MaturadorCaddy confirm 2>$null
& $nssm install MaturadorCaddy $caddy "run" "--config" "$caddyfile"
& $nssm set MaturadorCaddy AppDirectory $Root
& $nssm set MaturadorCaddy AppStdout "$Root\logs\caddy.log"
& $nssm set MaturadorCaddy AppStderr "$Root\logs\caddy.err.log"
& $nssm set MaturadorCaddy Start SERVICE_AUTO_START
& $nssm start MaturadorCaddy

Start-Sleep -Seconds 5
Step "Verificando..."
try { (Invoke-WebRequest "http://127.0.0.1:3000/health" -UseBasicParsing).Content } catch { Write-Host "API ainda subindo — veja logs\api.err.log" -ForegroundColor Yellow }

Write-Host "`n✅ Deploy concluído." -ForegroundColor Green
Write-Host "Painel:  https://$Domain   (aguarde ~1 min pro Caddy emitir o certificado HTTPS)" -ForegroundColor Green
Write-Host "Serviços: MaturadorAPI (backend) e MaturadorCaddy (proxy) — auto-start no boot, auto-restart em crash." -ForegroundColor Green
Write-Host "Logs: $Root\logs\" -ForegroundColor Green
