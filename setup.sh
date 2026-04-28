#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    echo -e "${BLUE}→${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# First, check and display what's already installed
echo "════════════════════════════════════════════════════════════"
echo "  bustaTv - Verificando dependencias"
echo "════════════════════════════════════════════════════════════"
echo ""

NEEDS_INSTALL=0

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    print_success "Python $PYTHON_VERSION"
else
    print_error "Python no instalado"
    NEEDS_INSTALL=1
fi

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js $NODE_VERSION"
else
    print_error "Node.js no instalado"
    NEEDS_INSTALL=1
fi

# Check Python venv
if [ -d "backend/venv" ]; then
    print_success "Entorno virtual Python creado"
else
    print_warning "Entorno virtual Python no creado"
    NEEDS_INSTALL=1
fi

# Check Node modules
if [ -d "frontend/node_modules" ]; then
    print_success "Dependencias de Node.js instaladas"
else
    print_warning "Dependencias de Node.js no instaladas"
    NEEDS_INSTALL=1
fi

# Check backend .env
if [ -f "backend/.env" ]; then
    print_success "Configuración backend (.env) existe"
else
    print_warning "Configuración backend (.env) no existe"
    NEEDS_INSTALL=1
fi

# Check frontend .env
if [ -f "frontend/.env" ]; then
    print_success "Configuración frontend (.env) existe"
else
    print_warning "Configuración frontend (.env) no existe"
    NEEDS_INSTALL=1
fi

echo ""

# If everything is installed, skip to startup
if [ $NEEDS_INSTALL -eq 0 ]; then
    echo "════════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}Todas las dependencias están instaladas${NC}"
    echo "════════════════════════════════════════════════════════════"
    echo ""
else
    echo "════════════════════════════════════════════════════════════"
    echo "  Instalando dependencias faltantes..."
    echo "════════════════════════════════════════════════════════════"
    echo ""

    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        print_status "Instalando Python..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            print_status "Instalando Homebrew (si no existe)..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" 2>/dev/null
            brew install python3 > /dev/null 2>&1
            print_success "Python instalado"
        else
            print_error "Python no está instalado. Descárgalo desde: https://www.python.org/downloads/"
            exit 1
        fi
    fi

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_status "Instalando Node.js..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            brew install node > /dev/null 2>&1
            print_success "Node.js instalado"
        else
            print_error "Node.js no está instalado. Descárgalo desde: https://nodejs.org/"
            exit 1
        fi
    fi

    echo ""
    print_status "Configurando backend..."

    # Create backend venv if it doesn't exist
    if [ ! -d "backend/venv" ]; then
        print_status "Creando entorno virtual de Python..."
        cd backend
        python3 -m venv venv > /dev/null 2>&1
        cd ..
        print_success "Entorno virtual creado"
    fi

    # Activate venv and install requirements
    print_status "Instalando dependencias de Python (esto puede tardar)..."
    source backend/venv/bin/activate
    pip install --upgrade pip > /dev/null 2>&1
    pip install -r backend/requirements.txt > /dev/null 2>&1
    print_success "Dependencias de backend instaladas"

    # Create .env file for backend if it doesn't exist
    if [ ! -f "backend/.env" ]; then
        print_status "Creando archivo .env del backend..."
        cat > backend/.env << EOF
DATABASE_URL=sqlite:///./bustaTv.db
SECRET_API_KEY=bustatv-dev-secret-key-changeme
EOF
        print_success "Archivo .env creado en backend/"
    fi

    echo ""
    print_status "Configurando frontend..."

    # Install frontend dependencies
    if [ ! -d "frontend/node_modules" ]; then
        print_status "Instalando dependencias de Node.js (esto puede tardar)..."
        cd frontend
        npm install > /dev/null 2>&1
        cd ..
        print_success "Dependencias de frontend instaladas"
    fi

    # Create .env file for frontend if it doesn't exist
    if [ ! -f "frontend/.env" ]; then
        print_status "Creando archivo .env del frontend..."
        cat > frontend/.env << EOF
VITE_API_URL=http://localhost:8000
EOF
        print_success "Archivo .env creado en frontend/"
    fi

    echo ""
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ¡Iniciando aplicación!"
echo "════════════════════════════════════════════════════════════"
echo ""

# Start backend in background
print_status "Iniciando backend (FastAPI)..."
source backend/venv/bin/activate
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000 > /tmp/bustatv_backend.log 2>&1 &
BACKEND_PID=$!
cd ..
sleep 3

# Check if backend started successfully
if kill -0 $BACKEND_PID 2>/dev/null; then
    print_success "Backend iniciado (PID: $BACKEND_PID)"
else
    print_warning "Error al iniciar backend. Verifica el log:"
    cat /tmp/bustatv_backend.log
    exit 1
fi

echo ""

# Start frontend in background
print_status "Iniciando frontend (Vite)..."
cd frontend
npm run dev > /tmp/bustatv_frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
sleep 5

# Check if frontend started successfully
if kill -0 $FRONTEND_PID 2>/dev/null; then
    print_success "Frontend iniciado (PID: $FRONTEND_PID)"
else
    print_warning "Error al iniciar frontend. Verifica el log:"
    cat /tmp/bustatv_frontend.log
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}¡bustaTv está listo!${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}Accede aquí:${NC}  http://localhost:5173"
echo ""
echo "API Backend:     http://localhost:8000"
echo "API Docs:        http://localhost:8000/docs"
echo ""
echo "Para detener la aplicación, presiona Ctrl+C"
echo ""

# Save PIDs for cleanup
echo "$BACKEND_PID" > /tmp/bustatv_pids.txt
echo "$FRONTEND_PID" >> /tmp/bustatv_pids.txt

# Wait for Ctrl+C and cleanup
trap "
echo ''
echo 'Deteniendo aplicación...'
kill $BACKEND_PID 2>/dev/null
kill $FRONTEND_PID 2>/dev/null
sleep 2
print_success 'bustaTv detenido'
exit 0
" SIGINT

# Keep script running
wait
