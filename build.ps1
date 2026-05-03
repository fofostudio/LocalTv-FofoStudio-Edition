# ============================================================================
# LocalTv · FofoStudio Edition — Build Pipeline (Windows)
#
# Orquesta el empaquetado completo del .exe instalable:
#   1. Detecta / instala Python 3.11-3.13, Node.js LTS e Inno Setup
#   2. Crea venv del backend + instala requirements-build.txt (incluye PyInstaller)
#   3. Genera el icono (Pillow) si no existe
#   4. Builda el frontend (npm install + npm run build → frontend/dist)
#   5. Compila backend con PyInstaller → dist/LocalTv/LocalTv.exe
#   6. Compila instalador con Inno Setup → dist/LocalTv-Setup-1.0.0.exe
#
# Uso:
#   .\build.ps1                # build completo
#   .\build.ps1 -SkipFrontend  # solo backend + installer
#   .\build.ps1 -SkipInstaller # solo backend (no genera el .exe instalable)
# ============================================================================

[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [switch]$SkipInstaller,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function OK($msg)    { Write-Host "[OK] $msg"  -ForegroundColor Green }
function Warn($msg)  { Write-Host "[!]  $msg"  -ForegroundColor Yellow }
function Err($msg)   { Write-Host "[X]  $msg"  -ForegroundColor Red }

$Root = $PSScriptRoot
Set-Location $Root

if ($Clean) {
    Step "Limpieza previa"
    foreach ($d in @("dist", "build", "frontend\dist")) {
        $p = Join-Path $Root $d
        if (Test-Path $p) { Remove-Item -Recurse -Force $p; OK "Eliminado $d" }
    }
}

# ----------------------------------------------------------------------------
# 1. Python 3.11 / 3.12 / 3.13
# ----------------------------------------------------------------------------
Step "Detectando Python compatible (3.11 / 3.12 / 3.13)"
$pythonExe = $null
foreach ($v in @("3.13", "3.12", "3.11")) {
    $found = & py -$v -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $found) {
        $pythonExe = $found.Trim()
        OK "Python $v en $pythonExe"
        break
    }
}
# Fallback: si no hay py launcher pero sí `python` en el PATH (CI con setup-python)
if (-not $pythonExe) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver -in @("3.11", "3.12", "3.13")) {
            $pythonExe = $cmd.Source
            OK "Python $ver en $pythonExe"
        }
    }
}
if (-not $pythonExe) {
    Err "Necesitas Python 3.11, 3.12 o 3.13 instalado."
    Write-Host "Descarga: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# ----------------------------------------------------------------------------
# 2. Node.js >= 18 (solo si vamos a buildear frontend)
# ----------------------------------------------------------------------------
if (-not $SkipFrontend) {
    Step "Detectando Node.js >= 18"
    try {
        $nodeVer = (& node -v).TrimStart("v")
        $nodeMajor = [int]($nodeVer.Split(".")[0])
        if ($nodeMajor -lt 18) { throw "node v$nodeVer es muy antiguo" }
        OK "Node.js v$nodeVer"
    } catch {
        Err "Node.js LTS no detectado. Instala desde https://nodejs.org/"
        exit 1
    }
}

# ----------------------------------------------------------------------------
# 3. Inno Setup — instalación automática vía winget si falta
# ----------------------------------------------------------------------------
function Find-InnoSetup {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:LocalAppData}\Programs\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $cmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

if (-not $SkipInstaller) {
    Step "Detectando Inno Setup"
    $iscc = Find-InnoSetup
    if (-not $iscc) {
        Warn "Inno Setup no instalado. Instalando con winget..."
        try {
            & winget install --id JRSoftware.InnoSetup --silent --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) { throw "winget exit $LASTEXITCODE" }
        } catch {
            Err "Falló winget install JRSoftware.InnoSetup."
            Write-Host "Descarga manual: https://jrsoftware.org/isinfo.php" -ForegroundColor Yellow
            exit 1
        }
        $iscc = Find-InnoSetup
        if (-not $iscc) {
            Err "Inno Setup instalado pero no encontrado. Reinicia la terminal o pasa la ruta a ISCC.exe en PATH."
            exit 1
        }
    }
    OK "Inno Setup: $iscc"
}

# ----------------------------------------------------------------------------
# 4. venv del backend + deps de build (PyInstaller, Pillow)
# ----------------------------------------------------------------------------
Step "Configurando venv del backend"
$venvPath   = Join-Path $Root "backend\venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$venvPyi    = Join-Path $venvPath "Scripts\pyinstaller.exe"

if (-not (Test-Path $venvPython)) {
    & $pythonExe -m venv $venvPath
    OK "venv creado"
}

# Verificar versión del venv
$venvVer = & $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($venvVer -notin @("3.11", "3.12", "3.13")) {
    Warn "venv usa Python $venvVer (incompatible). Recreando con $pythonExe..."
    Remove-Item -Recurse -Force $venvPath
    & $pythonExe -m venv $venvPath
}

Step "Instalando dependencias de build"
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $Root "backend\requirements-build.txt") --quiet
if ($LASTEXITCODE -ne 0) { Err "pip install falló"; exit 1 }
OK "Dependencias instaladas"

# ----------------------------------------------------------------------------
# 5. Generar icono si no existe
# ----------------------------------------------------------------------------
$iconPath = Join-Path $Root "installer\icon.ico"
if (-not (Test-Path $iconPath)) {
    Step "Generando icon.ico con Pillow"
    & $venvPython (Join-Path $Root "installer\make_icon.py")
    if ($LASTEXITCODE -ne 0) { Err "Falló make_icon.py"; exit 1 }
}
OK "icon.ico OK"

# ----------------------------------------------------------------------------
# 6. Build del frontend (Vite)
# ----------------------------------------------------------------------------
if (-not $SkipFrontend) {
    Step "Build del frontend (Vite)"
    Push-Location (Join-Path $Root "frontend")
    try {
        if (-not (Test-Path "node_modules")) {
            & npm install
            if ($LASTEXITCODE -ne 0) { Err "npm install falló"; exit 1 }
        }
        & npm run build
        if ($LASTEXITCODE -ne 0) { Err "npm run build falló"; exit 1 }
    } finally {
        Pop-Location
    }
    OK "Frontend buildeado en frontend\dist"
}

if (-not (Test-Path (Join-Path $Root "frontend\dist\index.html"))) {
    Err "frontend\dist\index.html no existe. Corre el build sin -SkipFrontend."
    exit 1
}

# ----------------------------------------------------------------------------
# 7. PyInstaller → dist/LocalTv/LocalTv.exe
# ----------------------------------------------------------------------------
Step "Compilando backend con PyInstaller"
Push-Location $Root
try {
    & $venvPyi --noconfirm --clean (Join-Path $Root "installer\LocalTv.spec")
    if ($LASTEXITCODE -ne 0) { Err "PyInstaller falló"; exit 1 }
} finally {
    Pop-Location
}

$exePath = Join-Path $Root "dist\LocalTv\LocalTv.exe"
if (-not (Test-Path $exePath)) {
    Err "LocalTv.exe no generado en $exePath"
    exit 1
}
OK "Generado $exePath"

# ----------------------------------------------------------------------------
# 8. Inno Setup → dist/LocalTv-Setup-1.0.0.exe
# ----------------------------------------------------------------------------
if (-not $SkipInstaller) {
    Step "Compilando instalador con Inno Setup"
    & $iscc (Join-Path $Root "installer\LocalTv.iss")
    if ($LASTEXITCODE -ne 0) { Err "Inno Setup falló"; exit 1 }

    $setupPath = Get-ChildItem (Join-Path $Root "dist") -Filter "LocalTv-Setup-*.exe" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($setupPath) { OK "Instalador: $($setupPath.FullName)" }
}

# ----------------------------------------------------------------------------
# Listo
# ----------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Build completado" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Salidas:" -ForegroundColor White
Write-Host "  - App portable: dist\LocalTv\LocalTv.exe"
if (-not $SkipInstaller) {
    Write-Host "  - Instalador:   dist\LocalTv-Setup-1.0.0.exe"
}
Write-Host ""
