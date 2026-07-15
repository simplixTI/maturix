# ============================================================================
#  0-make-package.ps1  —  Rode no SEU PC (não no VPS).
#  Gera "maturador-deploy.zip" na Área de Trabalho, sem node_modules/dist/
#  segredos — pronto pra copiar pro VPS via RDP e extrair em C:\maturador.
# ============================================================================
$src = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$staging = Join-Path $env:TEMP 'maturador-pkg'
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'maturador-deploy.zip'

Write-Host "Empacotando de: $src" -ForegroundColor Cyan
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }

# Copia tudo, EXCETO o que não deve ir pro servidor (será reinstalado/gerado lá).
$xd = @('node_modules','dist','.git','logs','sessions','dashboard') | ForEach-Object { Join-Path $src $_ }
$xd += (Join-Path $src 'web\node_modules')
$xd += (Join-Path $src 'web\dist')
robocopy $src $staging /E /XD $xd /XF '.env' '*.log' /NFL /NDL /NJH /NJS /NP | Out-Null

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $out -Force
Remove-Item $staging -Recurse -Force

$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "`n✅ Pacote criado: $out  ($sizeMB MB)" -ForegroundColor Green
Write-Host "Copie esse zip pro VPS (RDP) e extraia em C:\maturador" -ForegroundColor Green
