#!/bin/bash
# localTv - Setup + Start (Linux/macOS/Git Bash)
# Comando unico: detecta dependencias, instala lo que falte, crea .env, arranca.

set -e

# Colores
RED="\033[0;31m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; CYAN="\033[0;36m"; NC="\033[0m"

step() { echo -e "${CYAN}==> $1${NC}"; }
ok()   { echo -e "${GREEN}[OK] $1${NC}"; }
warn() { echo -e "${YELLOW}[!]  $1${NC}"; }
err()  { echo -e "${RED}[X]  $1${NC}"; }

echo ""
echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  localTv - Setup unificado${NC}"
echo -e "${CYAN}================================================================${NC}"
echo ""

# Ir a la raiz del proyecto (donde esta este script)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    err "No se detectan las carpetas backend/ y frontend/. Ejecuta desde la raiz del proyecto."
    exit 1
fi

# Detectar SO para distinguir Git Bash en Windows
IS_WINDOWS_BASH=0
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) IS_WINDOWS_BASH=1 ;;
esac

if [ $IS_WINDOWS_BASH -eq 1 ]; then
    warn "Detectado Git Bash en Windows. Recomendado usar setup.ps1 desde PowerShell."
    warn "Continuando con setup.sh, pero algunos pasos pueden ser mas lentos."
fi

# --- 1. Detectar Python compatible (3.11 / 3.12 / 3.13). Evitar 3.14 ---
step "Detectando Python compatible (3.11 / 3.12 / 3.13)"

PYTHON_BIN=""
for v in 3.13 3.12 3.11; do
    if command -v "python${v}" >/dev/null 2>&1; then
        PYTHON_BIN="python${v}"
        ok "Encontrado python${v}"
        break
    fi
done

# Fallback: python3 si esta en rango aceptado
if [ -z "$PYTHON_BIN" ] && command -v python3 >/dev/null 2>&1; then
    SYS_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
    case "$SYS_VER" in
        3.11|3.12|3.13)
            PYTHON_BIN="python3"
            ok "Usando python3 (version $SYS_VER)"
            ;;
    esac
fi

# Fallback Windows: py -3.13
if [ -z "$PYTHON_BIN" ] && [ $IS_WINDOWS_BASH -eq 1 ]; then
    for v in 3.13 3.12 3.11; do
        if py -$v -c "import sys" >/dev/null 2>&1; then
            PYTHON_BIN="py -$v"
            ok "Encontrado py -$v"
            break
        fi
    done
fi

if [ -z "$PYTHON_BIN" ]; then
    err "No se encontro Python 3.11, 3.12 o 3.13."
    echo "Instala Python 3.13 desde https://www.python.org/downloads/"
    echo "Si tienes Python 3.14, no funciona aun (pydantic-core sin wheels para 3.14)."
    exit 1
fi

# --- 2. Detectar Node.js >= 18 ---
step "Detectando Node.js"

if ! command -v node >/dev/null 2>&1; then
    err "Node.js no esta instalado."
    echo "Instala Node.js LTS desde https://nodejs.org/"
    exit 1
fi

NODE_VER=$(node -v | sed "s/^v//")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    err "Node.js v$NODE_VER es muy antiguo. Se requiere >= 18."
    exit 1
fi
ok "Node.js v$NODE_VER"

# --- 3. Backend ---
step "Configurando backend"

if [ $IS_WINDOWS_BASH -eq 1 ]; then
    VENV_PYTHON="backend/venv/Scripts/python.exe"
    VENV_UVICORN="backend/venv/Scripts/uvicorn.exe"
    VENV_ACTIVATE="backend/venv/Scripts/activate"
else
    VENV_PYTHON="backend/venv/bin/python"
    VENV_UVICORN="backend/venv/bin/uvicorn"
    VENV_ACTIVATE="backend/venv/bin/activate"
fi

# Detectar venv roto (Python incompatible)
if [ -d "backend/venv" ] && [ -f "$VENV_PYTHON" ]; then
    VENV_VER=$("$VENV_PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "")
    case "$VENV_VER" in
        3.11|3.12|3.13) ;;
        *)
            warn "venv existente usa Python $VENV_VER (incompatible). Recreando..."
            rm -rf backend/venv
            ;;
    esac
fi

if [ ! -d "backend/venv" ]; then
    step "Creando venv con $PYTHON_BIN"
    $PYTHON_BIN -m venv backend/venv
    ok "venv creado"
fi

if [ ! -f "$VENV_UVICORN" ]; then
    step "Instalando dependencias del backend (puede tardar)"
    "$VENV_PYTHON" -m pip install --upgrade pip --quiet
    "$VENV_PYTHON" -m pip install -r backend/requirements.txt
    ok "Dependencias del backend instaladas"
else
    ok "Dependencias del backend ya instaladas"
fi

# .env del backend
if [ ! -f "backend/.env" ]; then
    if [ -f "backend/.env.example" ]; then
        cp backend/.env.example backend/.env
        ok ".env del backend creado desde .env.example"
    else
        cat > backend/.env <<EOF
DATABASE_URL=sqlite:///./bustaTv.db
SECRET_API_KEY=bustatv-dev-secret-key-changeme
EOF
        ok ".env del backend creado con valores por defecto"
    fi
else
    ok ".env del backend ya existe"
fi

# --- 4. Frontend ---
step "Configurando frontend"

REINSTALL_FRONTEND=0

# Detectar binarios cruzados (Linux vs Windows) por errores tipicos al saltar de plataforma
if [ -d "frontend/node_modules" ]; then
    if [ $IS_WINDOWS_BASH -eq 1 ]; then
        if [ -d "frontend/node_modules/@rolldown/binding-linux-x64-gnu" ]; then
            warn "node_modules tiene binarios de Linux. Reinstalando..."
            rm -rf frontend/node_modules frontend/package-lock.json
            REINSTALL_FRONTEND=1
        fi
    else
        if [ -d "frontend/node_modules/@rolldown/binding-win32-x64-msvc" ]; then
            warn "node_modules tiene binarios de Windows. Reinstalando..."
            rm -rf frontend/node_modules frontend/package-lock.json
            REINSTALL_FRONTEND=1
        fi
    fi
else
    REINSTALL_FRONTEND=1
fi

if [ $REINSTALL_FRONTEND -eq 1 ]; then
    step "Instalando dependencias del frontend (puede tardar)"
    (cd frontend && npm install)
    ok "Dependencias del frontend instaladas"
else
    ok "Dependencias del frontend ya instaladas"
fi

# .env del frontend
if [ ! -f "frontend/.env" ]; then
    if [ -f "frontend/.env.example" ]; then
        cp frontend/.env.example frontend/.env
        ok ".env del frontend creado desde .env.example"
    else
        echo "VITE_API_URL=http://localhost:8000" > frontend/.env
        ok ".env del frontend creado con valores por defecto"
    fi
else
    ok ".env del frontend ya existe"
fi

# --- 5. Listo ---
echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}  Instalacion completada${NC}"
echo -e "${GREEN}================================================================${NC}"
echo ""

# Permitir saltar el arranque con --no-start
for arg in "$@"; do
    if [ "$arg" = "--no-start" ]; then
        echo "Para arrancar mas tarde: bash scripts/start.sh"
        exit 0
    fi
done

step "Arrancando backend y frontend..."
exec bash "$PROJECT_ROOT/scripts/start.sh"