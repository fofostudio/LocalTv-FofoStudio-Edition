# localTv Startup Script (Windows PowerShell)
# Inicia backend y frontend simultáneamente con acceso remoto

$ErrorActionPreference = "Stop"

Write-Host "Iniciando localTv..." -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en la raiz del proyecto
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "Error: Este script debe ejecutarse desde la raiz del proyecto localTv" -ForegroundColor Red
    exit 1
}

$projectRoot = (Get-Location).Path

# Obtener IP local (primera IPv4 que no sea loopback ni APIPA)
$localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1).IPAddress
if (-not $localIp) { $localIp = "localhost" }

Write-Host "Backend:  http://localhost:8000  (remoto: http://$localIp`:8000)" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173  (remoto: http://$localIp`:5173)" -ForegroundColor Green
Write-Host ""

# Lanzar backend en una nueva ventana de PowerShell
$backendCmd = "Set-Location '$projectRoot\backend'; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload --host 0.0.0.0 --port 8000"
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -PassThru

# Dar tiempo al backend
Start-Sleep -Seconds 3

# Lanzar frontend en otra ventana
$frontendCmd = "Set-Location '$projectRoot\frontend'; npm run dev -- --host"
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -PassThru

Write-Host ""
Write-Host "localTv esta corriendo!" -ForegroundColor Green
Write-Host ""
Write-Host "URLs de Acceso Local:"
Write-Host "   Frontend:    http://localhost:5173"
Write-Host "   Backend API: http://localhost:8000"
Write-Host "   Swagger UI:  http://localhost:8000/docs"
Write-Host ""
Write-Host "URLs de Acceso Remoto (TV, otros dispositivos):"
Write-Host "   Frontend:    http://$localIp`:5173"
Write-Host "   Backend API: http://$localIp`:8000"
Write-Host ""
Write-Host "API Key (para Admin): bustatv-dev-secret-key-changeme"
Write-Host ""
Write-Host "Cierra las ventanas de backend/frontend para detener los servicios."
Write-Host "O presiona CTRL+C aqui para cerrarlas todas."
Write-Host ""

# Esperar a que el usuario presione CTRL+C, entonces matar los procesos
try {
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    Write-Host ""
    Write-Host "Deteniendo servicios..." -ForegroundColor Yellow
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
    Write-Host "localTv detenido" -ForegroundColor Green
}
