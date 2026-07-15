# ============================================================================
#  1-install-tools.ps1  —  Instala as ferramentas base no VPS Windows.
#  Rode no RDP, como Administrador, no PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\1-install-tools.ps1
#  Passe a senha do Postgres (você escolhe — anote, vai no .env):
#     .\1-install-tools.ps1 -PgPassword "UmaSenhaForte123"
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$PgPassword
)
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- Chocolatey (gerenciador de pacotes do Windows) ---
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Step "Instalando Chocolatey..."
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = 3072
  Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  $env:Path += ";$env:ProgramData\chocolatey\bin"
} else { Step "Chocolatey já instalado." }

# --- Ferramentas ---
Step "Instalando Node.js LTS, Git, NSSM e Caddy..."
choco install nodejs-lts git nssm caddy -y --no-progress

Step "Instalando PostgreSQL (isso pode demorar alguns minutos)..."
choco install postgresql16 --params "/Password:$PgPassword" -y --no-progress

# --- Firewall: liberar 80/443 para o Caddy (HTTPS) ---
Step "Liberando portas 80 e 443 no firewall..."
New-NetFirewallRule -DisplayName "HTTP-In"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "HTTPS-In" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue | Out-Null

Write-Host "`n✅ Ferramentas instaladas." -ForegroundColor Green
Write-Host "IMPORTANTE: FECHE e ABRA o PowerShell de novo (pra carregar o PATH do Node/Postgres)." -ForegroundColor Yellow
Write-Host "Depois rode:  .\2-deploy.ps1 -Domain maturador.SEUDOMINIO.com -PgPassword `"$PgPassword`"" -ForegroundColor Yellow
