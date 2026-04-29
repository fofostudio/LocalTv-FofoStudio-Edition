@echo off
REM localTv - Setup + Start (CMD)
REM Comando unico de instalacion. Para mejor experiencia usa setup.ps1 desde PowerShell.

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================================
echo   localTv - Setup unificado (CMD)
echo ================================================================
echo.

if not exist "backend" goto NOROOT
if not exist "frontend" goto NOROOT
goto ROOT_OK
:NOROOT
echo [X] No se detectan las carpetas backend\ y frontend\
echo     Ejecuta este script desde la raiz del proyecto.
exit /b 1
:ROOT_OK

REM --- 1. Detectar Python compatible (3.13 / 3.12 / 3.11) ---
echo ==^> Detectando Python compatible (3.11 / 3.12 / 3.13)

set PYTHON_CMD=
for %%V in (3.13 3.12 3.11) do (
    if not defined PYTHON_CMD (
        py -%%V -c "import sys" >nul 2>&1
        if !errorlevel! equ 0 (
            set PYTHON_CMD=py -%%V
            echo [OK] Encontrado Python %%V via py launcher
        )
    )
)

if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "tokens=2 delims= " %%a in ('python --version 2^>^&1') do set PYVER=%%a
        for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
            set PYMAJ=%%a
            set PYMIN=%%b
        )
        if "!PYMAJ!"=="3" (
            if "!PYMIN!"=="11" set PYTHON_CMD=python
            if "!PYMIN!"=="12" set PYTHON_CMD=python
            if "!PYMIN!"=="13" set PYTHON_CMD=python
        )
        if defined PYTHON_CMD echo [OK] Usando python del PATH ^(!PYVER!^)
    )
)

if not defined PYTHON_CMD (
    echo [X] No se encontro Python 3.11, 3.12 o 3.13.
    echo     Instala Python 3.13 desde https://www.python.org/downloads/
    echo     Si tienes Python 3.14, no funciona aun ^(pydantic-core sin wheels para 3.14^).
    exit /b 1
)

REM --- 2. Detectar Node.js >= 18 ---
echo ==^> Detectando Node.js
node -v >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js no esta instalado.
    echo     Instala Node.js LTS desde https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js !NODE_VER!

REM --- 3. Backend ---
echo ==^> Configurando backend

REM Verificar si venv existe y es compatible
set VENV_OK=0
if exist "backend\venv\Scripts\python.exe" (
    for /f "tokens=*" %%i in ('backend\venv\Scripts\python.exe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set VENV_VER=%%i
    if "!VENV_VER!"=="3.11" set VENV_OK=1
    if "!VENV_VER!"=="3.12" set VENV_OK=1
    if "!VENV_VER!"=="3.13" set VENV_OK=1
    if !VENV_OK! equ 0 (
        echo [!] venv existente usa Python !VENV_VER! ^(incompatible^). Recreando...
        rmdir /s /q "backend\venv"
    )
)

if not exist "backend\venv" (
    echo ==^> Creando venv con %PYTHON_CMD%
    %PYTHON_CMD% -m venv backend\venv
    if errorlevel 1 (
        echo [X] Fallo al crear venv
        exit /b 1
    )
    echo [OK] venv creado
)

if not exist "backend\venv\Scripts\uvicorn.exe" (
    echo ==^> Instalando dependencias del backend ^(puede tardar^)
    backend\venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        echo [X] Fallo la instalacion de dependencias del backend
        exit /b 1
    )
    echo [OK] Dependencias del backend instaladas
) else (
    echo [OK] Dependencias del backend ya instaladas
)

REM .env del backend
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy /Y "backend\.env.example" "backend\.env" >nul
        echo [OK] .env del backend creado desde .env.example
    ) else (
        (
            echo DATABASE_URL=sqlite:///./bustaTv.db
            echo SECRET_API_KEY=bustatv-dev-secret-key-changeme
        ) > "backend\.env"
        echo [OK] .env del backend creado con valores por defecto
    )
) else (
    echo [OK] .env del backend ya existe
)

REM --- 4. Frontend ---
echo ==^> Configurando frontend

set REINSTALL_FRONTEND=0
if exist "frontend\node_modules\@rolldown\binding-linux-x64-gnu" (
    echo [!] node_modules tiene binarios de Linux. Reinstalando...
    rmdir /s /q "frontend\node_modules"
    if exist "frontend\package-lock.json" del "frontend\package-lock.json"
    set REINSTALL_FRONTEND=1
)
if not exist "frontend\node_modules" set REINSTALL_FRONTEND=1

if !REINSTALL_FRONTEND! equ 1 (
    echo ==^> Instalando dependencias del frontend ^(puede tardar^)
    pushd frontend
    call npm install
    if errorlevel 1 (
        popd
        echo [X] Fallo npm install
        exit /b 1
    )
    popd
    echo [OK] Dependencias del frontend instaladas
) else (
    echo [OK] Dependencias del frontend ya instaladas
)

REM .env del frontend
if not exist "frontend\.env" (
    if exist "frontend\.env.example" (
        copy /Y "frontend\.env.example" "frontend\.env" >nul
        echo [OK] .env del frontend creado desde .env.example
    ) else (
        echo VITE_API_URL=http://localhost:8000 > "frontend\.env"
        echo [OK] .env del frontend creado con valores por defecto
    )
) else (
    echo [OK] .env del frontend ya existe
)

echo.
echo ================================================================
echo   Instalacion completada
echo ================================================================
echo.

REM --no-start salta el arranque
for %%a in (%*) do (
    if /I "%%a"=="--no-start" (
        echo Para arrancar mas tarde: scripts\start.bat
        exit /b 0
    )
)

echo ==^> Arrancando backend y frontend...
echo.

REM Lanzar backend en ventana propia
start "localTv Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && uvicorn main:app --reload --host 0.0.0.0 --port 8000"

REM Esperar a que el backend este listo
timeout /t 3 /nobreak >nul

REM Lanzar frontend en ventana propia
start "localTv Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host"

echo.
echo ================================================================
echo   localTv esta corriendo!
echo ================================================================
echo.
echo   Frontend:    http://localhost:5173
echo   Backend API: http://localhost:8000
echo   Swagger UI:  http://localhost:8000/docs
echo.
echo   API Key (Admin): bustatv-dev-secret-key-changeme
echo.
echo Cierra las ventanas de Backend y Frontend para detener los servicios.
echo.
pause
