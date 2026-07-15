# Start PostgreSQL and Redis services on Windows
# Run: powershell -ExecutionPolicy Bypass -File scripts\start-infra.ps1

Write-Host "Starting infrastructure services..." -ForegroundColor Cyan

# Start PostgreSQL
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
if ($pgService) {
    if ($pgService.Status -ne "Running") {
        Start-Service $pgService.Name
        Write-Host "[OK] PostgreSQL started ($($pgService.Name))" -ForegroundColor Green
    } else {
        Write-Host "[OK] PostgreSQL already running" -ForegroundColor Green
    }
} else {
    Write-Host "[WARN] PostgreSQL service not found. Start it manually." -ForegroundColor Yellow
}

# Start Redis
$redisService = Get-Service -Name "Redis" -ErrorAction SilentlyContinue
if ($redisService) {
    if ($redisService.Status -ne "Running") {
        Start-Service "Redis"
        Write-Host "[OK] Redis started" -ForegroundColor Green
    } else {
        Write-Host "[OK] Redis already running" -ForegroundColor Green
    }
} else {
    # Try starting redis-server directly
    $redisPath = Get-Command redis-server -ErrorAction SilentlyContinue
    if ($redisPath) {
        Start-Process redis-server -WindowStyle Hidden
        Write-Host "[OK] Redis started (process)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Redis not found. Start it manually." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Infrastructure ready. Run 'npm run dev' to start the application." -ForegroundColor Cyan
