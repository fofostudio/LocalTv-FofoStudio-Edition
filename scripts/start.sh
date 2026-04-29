#!/bin/bash

# localTv Startup Script
# Inicia backend y frontend simultaneamente con acceso remoto
# Compatible con Linux, macOS y Git Bash en Windows

set -e

echo "Iniciando localTv..."
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "Error: Este script debe ejecutarse desde la raiz del proyecto localTv"
    exit 1
fi

# Detectar SO para usar la ruta correcta del venv
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) VENV_ACTIVATE="backend/venv/Scripts/activate" ;;
    *) VENV_ACTIVATE="backend/venv/bin/activate" ;;
esac

# Funcion para manejar CTRL+C
cleanup() {
    echo ""
    echo "Deteniendo servicios..."
    kill %1 2>/dev/null || true
    kill %2 2>/dev/null || true
    wait
    echo "localTv detenido"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Obtener IP local (compatible con Linux, macOS y Git Bash)
if command -v ipconfig >/dev/null 2>&1; then
    LOCAL_IP=$(ipconfig | grep -i "ipv4" | grep -v "127.0.0.1" | head -1 | awk -F: "{print \$2}" | tr -d " \r")
elif command -v ip >/dev/null 2>&1; then
    LOCAL_IP=$(ip -4 addr show | grep -oP "(?<=inet\s)\d+(\.\d+){3}" | grep -v "127.0.0.1" | head -1)
elif command -v ifconfig >/dev/null 2>&1; then
    LOCAL_IP=$(ifconfig | grep -E "inet " | grep -v "127.0.0.1" | head -1 | awk "{print \$2}")
fi
[ -z "$LOCAL_IP" ] && LOCAL_IP="localhost"

# Iniciar Backend
echo "Backend: Iniciando en http://localhost:8000 (acceso remoto: http://$LOCAL_IP:8000)"
(cd backend && source "../$VENV_ACTIVATE" 2>/dev/null || source "venv/Scripts/activate" 2>/dev/null || source "venv/bin/activate"; uvicorn main:app --reload --host 0.0.0.0 --port 8000) &

# Dar tiempo al backend para iniciar
sleep 3

# Iniciar Frontend
echo "Frontend: Iniciando en http://localhost:5173 (acceso remoto: http://$LOCAL_IP:5173)"
(cd frontend && npm run dev -- --host) &

echo ""
echo "localTv esta corriendo!"
echo ""
echo "URLs de Acceso Local:"
echo "   Frontend:    http://localhost:5173"
echo "   Backend API: http://localhost:8000"
echo "   Swagger UI:  http://localhost:8000/docs"
echo ""
echo "URLs de Acceso Remoto (TV, otros dispositivos):"
echo "   Frontend:    http://$LOCAL_IP:5173"
echo "   Backend API: http://$LOCAL_IP:8000"
echo ""
echo "API Key (para Admin): bustatv-dev-secret-key-changeme"
echo ""
echo "Presiona CTRL+C para detener los servicios"
echo ""

# Esperar a que ambos procesos terminen
wait