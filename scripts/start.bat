@echo off
REM localTv - Start (CMD)
REM Arranca backend y frontend asumiendo que ya estan instalados.

cd /d "%~dp0\.."

if not exist "backend\venv\Scripts\uvicorn.exe" (
    echo [X] Backend no instalado. Ejecuta primero: setup.bat
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo [X] Frontend no instalado. Ejecuta primero: setup.bat
    exit /b 1
)

echo Arrancando backend y frontend...
echo.

start "localTv Backend" cmd /k "cd /d %~dp0\..\backend && call venv\Scripts\activate.bat && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
timeout /t 3 /nobreak >nul
start "localTv Frontend" cmd /k "cd /d %~dp0\..\frontend && npm run dev -- --host"

echo.
echo localTv esta corriendo!
echo   Frontend:    http://localhost:5173
echo   Backend API: http://localhost:8000
echo   Swagger UI:  http://localhost:8000/docs
echo.
echo Cierra las ventanas para detener los servicios.
echo.
pause
