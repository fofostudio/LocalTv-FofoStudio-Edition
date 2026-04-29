# localTv - Setup + Start (Windows PowerShell)
# Comando unico de instalacion. Detecta dependencias, instala lo que falte,
# crea archivos .env y arranca el backend y frontend.

$ErrorActionPreference = "Stop"

function Write-Step { param($msg) Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "[X]  $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  localTv - Setup unificado" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Asegurarse de estar en la raiz del repo
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Err "No se detectan las carpetas backend\ y frontend\. Ejecuta este script desde la raiz del proyecto."
    exit 1
}

# --- 1. Detectar Python compatible (3.11 / 3.12 / 3.13). Evitar 3.14 (pydantic-core) ---
Write-Step "Detectando Python compatible (3.11 / 3.12 / 3.13)"

$pythonExe = $null
$preferred = @("3.13", "3.12", "3.11")

foreach ($v in $preferred) {
    $found = & py -$v -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $found) {
        $pythonExe = $found.Trim()
        Write-Ok "Encontrado Python $v en $pythonExe"
        break
    }
}

if (-not $pythonExe) {
    # Fallback a "python" del PATH si esta en rango aceptado
    $sysPy = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    if ($LASTEXITCODE -eq 0 -and ($sysPy -in @("3.11", "3.12", "3.13"))) {
        $pythonExe = (& python -c "import sys; print(sys.executable)").Trim()
        Write-Ok "Usando python del PATH (version $sysPy)"
    }
}

if (-not $pythonExe) {
    Write-Err "No se encontro Python 3.11, 3.12 o 3.13."
    Write-Host ""
    Write-Host "Instala Python 3.13 desde https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "Si tienes Python 3.14, no funciona aun (pydantic-core sin wheels para 3.14)." -ForegroundColor Yellow
    exit 1
}

# --- 2. Detectar Node.js >= 18 ---
Write-Step "Detectando Node.js"

$nodeOk = $false
try {
    $nodeVer = (& node -v).TrimStart("v")
    $nodeMajor = [int]($nodeVer.Split(".")[0])
    if ($nodeMajor -ge 18) {
        Write-Ok "Node.js v$nodeVer"
        $nodeOk = $true
    } else {
        Write-Err "Node.js v$nodeVer es muy antiguo. Se requiere >= 18."
    }
} catch {
    Write-Err "Node.js no esta instalado."
}

if (-not $nodeOk) {
    Write-Host "Instala Node.js LTS desde https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# --- 3. Backend: venv + dependencias ---
Write-Step "Configurando backend"

$venvPath = Join-Path $projectRoot "backend\venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$venvUvicorn = Join-Path $venvPath "Scripts\uvicorn.exe"

# Si existe un venv pero esta roto (p.ej. creado con Python 3.14), recrearlo
if (Test-Path $venvPath) {
    $venvOk = Test-Path $venvPython
    if ($venvOk) {
        $venvVer = & $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($venvVer -notin @("3.11", "3.12", "3.13")) {
            Write-Warn "venv existente usa Python $venvVer (incompatible). Recreando..."
            Remove-Item -Recurse -Force $venvPath
            $venvOk = $false
        }
    } else {
        Write-Warn "venv existente esta corrupto. Recreando..."
        Remove-Item -Recurse -Force $venvPath
    }
}

if (-not (Test-Path $venvPath)) {
    Write-Step "Creando venv con $pythonExe"
    & $pythonExe -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { Write-Err "Fallo al crear venv"; exit 1 }
    Write-Ok "venv creado"
}

# Verificar si uvicorn ya esta instalado, si no, instalar todo
if (-not (Test-Path $venvUvicorn)) {
    Write-Step "Instalando dependencias del backend (puede tardar)"
    & $venvPython -m pip install --upgrade pip --quiet
    & $venvPython -m pip install -r "backend\requirements.txt"
    if ($LASTEXITCODE -ne 0) { Write-Err "Fallo la instalacion de dependencias del backend"; exit 1 }
    Write-Ok "Dependencias del backend instaladas"
} else {
    Write-Ok "Dependencias del backend ya instaladas"
}

# .env del backend
$backendEnv = Join-Path $projectRoot "backend\.env"
$backendEnvExample = Join-Path $projectRoot "backend\.env.example"
if (-not (Test-Path $backendEnv)) {
    if (Test-Path $backendEnvExample) {
        Copy-Item $backendEnvExample $backendEnv
        Write-Ok ".env del backend creado desde .env.example"
    } else {
        Set-Content -Path $backendEnv -Value @(
            "DATABASE_URL=sqlite:///./bustaTv.db",
            "SECRET_API_KEY=bustatv-dev-secret-key-changeme"
        )
        Write-Ok ".env del backend creado con valores por defecto"
    }
} else {
    Write-Ok ".env del backend ya existe"
}

# --- 4. Frontend: node_modules + .env ---
Write-Step "Configurando frontend"

$nodeModules = Join-Path $projectRoot "frontend\node_modules"
$frontendPkg = Join-Path $projectRoot "frontend\package.json"

# Detectar si node_modules quedo corrupto (binarios de otra plataforma, error tipico al saltar entre WSL/Windows)
$reinstallFrontend = $false
if (Test-Path $nodeModules) {
    $linuxBinding = Join-Path $nodeModules "@rolldown\binding-linux-x64-gnu"
    if (Test-Path $linuxBinding) {
        Write-Warn "node_modules tiene binarios de Linux (instalacion previa con WSL). Reinstalando..."
        Remove-Item -Recurse -Force $nodeModules -ErrorAction SilentlyContinue
        $lockFile = Join-Path $projectRoot "frontend\package-lock.json"
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
        $reinstallFrontend = $true
    }
} else {
    $reinstallFrontend = $true
}

if ($reinstallFrontend) {
    Write-Step "Instalando dependencias del frontend (puede tardar)"
    Push-Location (Join-Path $projectRoot "frontend")
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { Write-Err "Fallo npm install"; exit 1 }
    } finally {
        Pop-Location
    }
    Write-Ok "Dependencias del frontend instaladas"
} else {
    Write-Ok "Dependencias del frontend ya instaladas"
}

# .env del frontend
$frontendEnv = Join-Path $projectRoot "frontend\.env"
$frontendEnvExample = Join-Path $projectRoot "frontend\.env.example"
if (-not (Test-Path $frontendEnv)) {
    if (Test-Path $frontendEnvExample) {
        Copy-Item $frontendEnvExample $frontendEnv
        Write-Ok ".env del frontend creado desde .env.example"
    } else {
        Set-Content -Path $frontendEnv -Value "VITE_API_URL=http://localhost:8000"
        Write-Ok ".env del frontend creado con valores por defecto"
    }
} else {
    Write-Ok ".env del frontend ya existe"
}

# --- 5. Listo ---
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Instalacion completada" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Permitir saltar el arranque con --no-start
if ($args -contains "--no-start") {
    Write-Host "Para arrancar mas tarde: .\scripts\start.ps1" -ForegroundColor Yellow
    exit 0
}

Write-Step "Arrancando backend y frontend..."
& (Join-Path $projectRoot "scripts\start.ps1")