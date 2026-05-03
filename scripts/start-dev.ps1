# LocalTv — arranque de desarrollo con detección automática de puertos.
# Si los default (8000 backend, 5173 frontend) están ocupados, busca el siguiente libre.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Get-FreePort {
    param([int]$Start, [int]$End)
    for ($p = $Start; $p -le $End; $p++) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
            $listener.Start()
            return $p
        } catch {
            continue
        } finally {
            if ($listener) { $listener.Stop() }
        }
    }
    throw "No hay puerto libre en $Start-$End"
}

$backendPort  = Get-FreePort -Start 8000 -End 8050
$frontendPort = Get-FreePort -Start 5173 -End 5200

Write-Host ""
Write-Host "==> Backend:  http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "==> Frontend: http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host ""

$venvPy = Join-Path $Root "backend\venv\Scripts\python.exe"

# Inyectar el puerto del backend en el frontend vía VITE_API_URL
$env:VITE_API_URL = "http://localhost:$backendPort"

# Backend en ventana propia
$beCmd = "Set-Location '$Root\backend'; & '$venvPy' -m uvicorn main:app --reload --host 0.0.0.0 --port $backendPort"
$beProc = Start-Process powershell -ArgumentList "-NoExit", "-Command", $beCmd -PassThru -WindowStyle Normal

Start-Sleep -Seconds 3

# Frontend en ventana propia (con VITE_API_URL inyectado)
$feCmd = "Set-Location '$Root\frontend'; `$env:VITE_API_URL = 'http://localhost:$backendPort'; npm run dev -- --host --port $frontendPort"
$feProc = Start-Process powershell -ArgumentList "-NoExit", "-Command", $feCmd -PassThru -WindowStyle Normal

# Esperar a que el frontend responda y abrir el navegador
Start-Sleep -Seconds 4
Start-Process "http://localhost:$frontendPort"

Write-Host ""
Write-Host "LocalTv corriendo. Cierra las dos ventanas para detener." -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend:    http://localhost:$frontendPort"
Write-Host "  Backend API: http://localhost:$backendPort"
Write-Host "  Swagger:     http://localhost:$backendPort/docs"
Write-Host "  Admin:       http://localhost:$frontendPort/admin  (key: localtv-fofostudio-key)"
Write-Host ""
