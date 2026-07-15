# Maturador WhatsApp - Setup Script for Windows
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

Write-Host "=== Maturador WhatsApp - Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org (v20+)" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green

# Check PostgreSQL
$pgVersion = psql --version 2>$null
if (-not $pgVersion) {
    Write-Host "[WARN] PostgreSQL CLI not found in PATH." -ForegroundColor Yellow
    Write-Host "       Install from https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "       Or use: winget install PostgreSQL.PostgreSQL" -ForegroundColor Yellow
} else {
    Write-Host "[OK] $pgVersion" -ForegroundColor Green
}

# Check Redis
$redisVersion = redis-cli --version 2>$null
if (-not $redisVersion) {
    Write-Host "[WARN] Redis not found in PATH." -ForegroundColor Yellow
    Write-Host "       Install from: https://github.com/tporadowski/redis/releases" -ForegroundColor Yellow
    Write-Host "       Or use: winget install tporadowski.Redis" -ForegroundColor Yellow
} else {
    Write-Host "[OK] $redisVersion" -ForegroundColor Green
}

Write-Host ""
Write-Host "--- Installing dependencies ---" -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "--- Generating Prisma client ---" -ForegroundColor Cyan
npx prisma generate

Write-Host ""
Write-Host "--- Creating .env from template ---" -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[OK] .env created. Edit DATABASE_URL and REDIS_URL if needed." -ForegroundColor Green
} else {
    Write-Host "[SKIP] .env already exists" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Start PostgreSQL and Redis services" -ForegroundColor Gray
Write-Host "  2. Create database:  createdb -U postgres maturador" -ForegroundColor Gray
Write-Host "  3. Run migrations:   npm run db:migrate" -ForegroundColor Gray
Write-Host "  4. Start dev server: npm run dev" -ForegroundColor Gray
Write-Host ""
