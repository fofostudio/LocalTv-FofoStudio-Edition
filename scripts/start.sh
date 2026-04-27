#!/bin/bash

# bustaTv Startup Script
# Inicia backend y frontend simultáneamente

set -e

echo "🚀 Iniciando bustaTv..."
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Error: Este script debe ejecutarse desde la raíz del proyecto bustaTv"
    exit 1
fi

# Función para manejar CTRL+C
cleanup() {
    echo ""
    echo "⏹️  Deteniendo servicios..."
    kill %1 2>/dev/null || true
    kill %2 2>/dev/null || true
    wait
    echo "✅ bustaTv detenido"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar Backend
echo "📡 Backend: Iniciando en http://localhost:8000"
(cd backend && source venv/bin/activate && uvicorn main:app --reload) &
BACKEND_PID=$!

# Dar tiempo al backend para iniciar
sleep 3

# Iniciar Frontend
echo "🎨 Frontend: Iniciando en http://localhost:5173"
(cd frontend && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "✅ bustaTv está corriendo!"
echo ""
echo "📍 URLs:"
echo "   Frontend:    http://localhost:5173"
echo "   Backend API: http://localhost:8000"
echo "   Swagger UI:  http://localhost:8000/docs"
echo "   Admin Panel: http://localhost:5173/admin"
echo ""
echo "🔑 API Key (para Admin): bustatv-dev-secret-key-changeme"
echo ""
echo "Presiona CTRL+C para detener los servicios"
echo ""

# Esperar a que ambos procesos terminen
wait
