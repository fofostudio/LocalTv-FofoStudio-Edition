@echo off
setlocal enabledelayedexpansion

REM Colors (limited in CMD)
color 0A

echo.
echo ================================================================
echo   bustaTv - Verificando dependencias
echo ================================================================
echo.

REM Check Python
set PYTHON_OK=0
python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
    echo [OK] !PYTHON_VERSION! esta instalado
    set PYTHON_OK=1
) else (
    echo [X] Python no esta instalado
)

REM Check Node.js
set NODE_OK=0
node --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo [OK] Node.js !NODE_VERSION! esta instalado
    set NODE_OK=1
) else (
    echo [X] Node.js no esta instalado
)

REM Check Python venv
if exist "backend\venv" (
    echo [OK] Entorno virtual Python creado
    set VENV_OK=1
) else (
    echo [X] Entorno virtual Python no creado
    set VENV_OK=0
)

REM Check Node modules
if exist "frontend\node_modules" (
    echo [OK] Dependencias de Node.js instaladas
    set MODULES_OK=1
) else (
    echo [X] Dependencias de Node.js no instaladas
    set MODULES_OK=0
)

REM Check backend .env
if exist "backend\.env" (
    echo [OK] Configuracion backend (.env) existe
    set ENV_BACK_OK=1
) else (
    echo [X] Configuracion backend (.env) no existe
    set ENV_BACK_OK=0
)

REM Check frontend .env
if exist "frontend\.env" (
    echo [OK] Configuracion frontend (.env) existe
    set ENV_FRONT_OK=1
) else (
    echo [X] Configuracion frontend (.env) no existe
    set ENV_FRONT_OK=0
)

echo.

REM Check if everything is OK
if %PYTHON_OK% equ 1 if %NODE_OK% equ 1 if %VENV_OK% equ 1 if %MODULES_OK% equ 1 if %ENV_BACK_OK% equ 1 if %ENV_FRONT_OK% equ 1 (
    echo ================================================================
    echo   [OK] Todas las dependencias estan instaladas
    echo ================================================================
    echo.
    goto START_APP
)

REM Install missing dependencies
echo ================================================================
echo   Instalando dependencias faltantes...
echo ================================================================
echo.

REM Check if Python needs to be installed
if %PYTHON_OK% equ 0 (
    echo [*] Python no esta instalado
    echo     Descargalo desde: https://www.python.org/downloads/
    echo     IMPORTANTE: Marca la opcion "Add Python to PATH" durante la instalacion
    echo.
    pause
    exit /b 1
)

REM Check if Node.js needs to be installed
if %NODE_OK% equ 0 (
    echo [*] Node.js no esta instalado
    echo     Descargalo desde: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [*] Configurando backend...

REM Create venv if it doesn't exist
if not exist "backend\venv" (
    echo [*] Creando entorno virtual de Python...
    cd backend
    python -m venv venv >nul 2>&1
    cd ..
    echo [OK] Entorno virtual creado
)

REM Activate venv and install requirements
echo [*] Instalando dependencias de Python (esto puede tardar)...
call backend\venv\Scripts\activate.bat >nul 2>&1
pip install --upgrade pip >nul 2>&1
pip install -r backend\requirements.txt >nul 2>&1
echo [OK] Dependencias de backend instaladas

REM Create .env file for backend
if not exist "backend\.env" (
    echo [*] Creando archivo .env del backend...
    (
        echo DATABASE_URL=sqlite:///./bustaTv.db
        echo SECRET_API_KEY=bustatv-dev-secret-key-changeme
    ) > backend\.env
    echo [OK] Archivo .env creado en backend\
)

echo.
echo [*] Configurando frontend...

REM Install frontend dependencies
if not exist "frontend\node_modules" (
    echo [*] Instalando dependencias de Node.js (esto puede tardar)...
    cd frontend
    call npm install >nul 2>&1
    cd ..
    echo [OK] Dependencias de frontend instaladas
)

REM Create .env file for frontend
if not exist "frontend\.env" (
    echo [*] Creando archivo .env del frontend...
    (
        echo VITE_API_URL=http://localhost:8000
    ) > frontend\.env
    echo [OK] Archivo .env creado en frontend\
)

:START_APP

echo.
echo ================================================================
echo   ¡Iniciando aplicacion!
echo ================================================================
echo.

REM Start backend
echo [*] Iniciando backend (FastAPI)...
call backend\venv\Scripts\activate.bat
start "bustaTv Backend" cmd /k "cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
timeout /t 3 /nobreak

REM Start frontend
echo [*] Iniciando frontend (Vite)...
start "bustaTv Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 5 /nobreak

echo.
echo ================================================================
echo   ¡bustaTv esta listo!
echo ================================================================
echo.
echo [OK] Accede aqui:  http://localhost:5173
echo.
echo     API Backend:     http://localhost:8000
echo     API Docs:        http://localhost:8000/docs
echo.
echo Para detener la aplicacion, cierra las ventanas de comando.
echo.
pause
