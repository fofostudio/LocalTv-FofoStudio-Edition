# Pipeline para compilar el APK localmente sin Android Studio.
# Descarga JDK 17 portable + Android cmdline-tools, acepta licencias,
# instala platforms/build-tools, builda frontend + APK debug.
#
# Idempotente. Compatible con Windows PowerShell 5.1 (no requiere pwsh 7).

[CmdletBinding()]
param([switch]$Clean)

# IMPORTANTE: PowerShell 5.1 trata stderr de procesos nativos como ErrorRecord
# y con "Stop" mata el script. Lo dejamos en "Continue" y validamos con
# $LASTEXITCODE explícito después de cada invocación nativa.
$ErrorActionPreference = "Continue"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function OK($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[X]  $m" -ForegroundColor Red; exit 1 }

function Check($what) {
    if ($LASTEXITCODE -ne 0) { Fail "$what fallo (exit $LASTEXITCODE)" }
}

$Repo   = (Resolve-Path "$PSScriptRoot\..\..").Path
$Base   = "$env:LOCALAPPDATA\LocalTvAndroid"
$JdkDir = "$Base\jdk-17"
$SdkDir = "$Base\Android\Sdk"
$CmdDir = "$SdkDir\cmdline-tools\latest"

if ($Clean) {
    Step "Clean: borrando $Base y mobile/android, mobile/public"
    Remove-Item -Recurse -Force $Base -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Repo\mobile\android" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Repo\mobile\public" -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force $Base -ErrorAction Stop | Out-Null

# ---- 1. JDK 17 -----------------------------------------------------------
if (-not (Test-Path "$JdkDir\bin\java.exe")) {
    Step "Descargando JDK 17 (Microsoft OpenJDK portable, ~180 MB)"
    $jdkZip = "$env:TEMP\msjdk17.zip"
    Invoke-WebRequest "https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip" -OutFile $jdkZip
    Step "Extrayendo JDK..."
    $tmpJdk = "$env:TEMP\msjdk17-extract"
    Remove-Item -Recurse -Force $tmpJdk -ErrorAction SilentlyContinue
    Expand-Archive $jdkZip -DestinationPath $tmpJdk
    $jdkInner = Get-ChildItem $tmpJdk -Directory | Select-Object -First 1
    Move-Item $jdkInner.FullName $JdkDir
    Remove-Item -Recurse -Force $tmpJdk -ErrorAction SilentlyContinue
    OK "JDK instalado en $JdkDir"
} else {
    OK "JDK ya instalado en $JdkDir"
}

$env:JAVA_HOME = $JdkDir
$env:PATH = "$JdkDir\bin;$env:PATH"
# Verificacion silenciosa, sin redireccionar stderr
& "$JdkDir\bin\java.exe" -version *> "$env:TEMP\java-version.txt"
Get-Content "$env:TEMP\java-version.txt" | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

# ---- 2. Android cmdline-tools -------------------------------------------
if (-not (Test-Path "$CmdDir\bin\sdkmanager.bat")) {
    Step "Descargando Android cmdline-tools (~150 MB)"
    $cmdZip = "$env:TEMP\android-cmdline-tools.zip"
    Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile $cmdZip
    Step "Extrayendo cmdline-tools..."
    $tmpCmd = "$env:TEMP\android-cmdline-tools-extract"
    Remove-Item -Recurse -Force $tmpCmd -ErrorAction SilentlyContinue
    Expand-Archive $cmdZip -DestinationPath $tmpCmd
    New-Item -ItemType Directory -Force $CmdDir | Out-Null
    Move-Item "$tmpCmd\cmdline-tools\*" $CmdDir
    Remove-Item -Recurse -Force $tmpCmd -ErrorAction SilentlyContinue
    OK "cmdline-tools en $CmdDir"
} else {
    OK "cmdline-tools ya instalado"
}

$env:ANDROID_HOME = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
$env:PATH = "$CmdDir\bin;$SdkDir\platform-tools;$env:PATH"

# ---- 3. Aceptar licencias -----------------------------------------------
Step "Aceptando licencias del SDK"
$yesFile = "$env:TEMP\sdk-yes.txt"
("y`r`n" * 50) | Out-File -Encoding ascii $yesFile
& cmd /c "type `"$yesFile`" | `"$CmdDir\bin\sdkmanager.bat`" --licenses 2>&1" *> "$env:TEMP\sdk-licenses.log"
Remove-Item $yesFile -ErrorAction SilentlyContinue
OK "Licencias aceptadas (log en $env:TEMP\sdk-licenses.log)"

# ---- 4. Instalar platform + build-tools ---------------------------------
Step "Instalando platforms;android-34 + build-tools;34.0.0 + platform-tools"
& cmd /c "`"$CmdDir\bin\sdkmanager.bat`" `"platforms;android-34`" `"build-tools;34.0.0`" `"platform-tools`" 2>&1" *> "$env:TEMP\sdk-install.log"
if ($LASTEXITCODE -ne 0) {
    Get-Content "$env:TEMP\sdk-install.log" | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Fail "sdkmanager install fallo (exit $LASTEXITCODE)"
}
OK "SDK platforms y build-tools instalados"

# ---- 5. Frontend build --------------------------------------------------
Step "Frontend: npm install + vite build"
Push-Location "$Repo\frontend"
try {
    & cmd /c "npm install --no-audit --no-fund 2>&1"
    Check "npm install (frontend)"
    & cmd /c "npm run build 2>&1"
    Check "frontend build"
} finally { Pop-Location }
OK "Frontend buildeado"

# ---- 6. Mobile: deps + cap add android ----------------------------------
Step "Mobile: npm install + copy frontend + cap add android"
Push-Location "$Repo\mobile"
try {
    & cmd /c "npm install --no-audit --no-fund 2>&1"
    Check "npm install (mobile)"
    & node scripts\copy-frontend.mjs
    Check "copy-frontend"
    if (-not (Test-Path "android\app\build.gradle")) {
        & cmd /c "npx cap add android 2>&1"
        Check "cap add android"
    }
    & node scripts\install-plugin.mjs
    Check "install-plugin"
    & cmd /c "npx cap sync android 2>&1"
    Check "cap sync"
} finally { Pop-Location }
OK "Mobile preparado"

# ---- 7. APK debug --------------------------------------------------------
Step "Compilando APK debug (Gradle, primera vez tarda 3-5 min)"
Push-Location "$Repo\mobile\android"
try {
    & cmd /c ".\gradlew.bat assembleDebug --no-daemon --warning-mode=summary 2>&1"
    Check "gradlew assembleDebug"
} finally { Pop-Location }

# ---- 8. Copiar APK -------------------------------------------------------
$apkSrc = Get-ChildItem "$Repo\mobile\android\app\build\outputs\apk" -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $apkSrc) { Fail "No se encontro APK generado" }

New-Item -ItemType Directory -Force "$Repo\dist" | Out-Null
$apkDst = "$Repo\dist\LocalTv-1.0.1.apk"
Copy-Item $apkSrc.FullName $apkDst -Force

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  APK generado" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $apkDst"
$sz = [math]::Round((Get-Item $apkDst).Length / 1MB, 2)
Write-Host "  Tamano: $sz MB"
Write-Host ""
Write-Host "Instalar en el celu:"
Write-Host "  - Copia el .apk al telefono (USB / Telegram / email)"
Write-Host "  - Habilita 'Permitir apps de fuentes desconocidas' para tu navegador o explorador"
Write-Host "  - Abri el .apk y permitilo"
Write-Host ""
