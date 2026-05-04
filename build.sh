#!/usr/bin/env bash
# ============================================================================
# LocalTv · FofoStudio Edition — Build Pipeline (macOS)
#
# Orquesta el empaquetado del .app + .dmg:
#   1. Detecta Python 3.11/3.12/3.13 y Node.js LTS
#   2. Crea venv del backend + instala requirements-build.txt
#   3. Genera iconos (icon.png + icon.icns vía iconutil)
#   4. Builda el frontend (npm install + npm run build → frontend/dist)
#   5. Compila con PyInstaller → dist/LocalTv.app
#   6. Empaqueta con hdiutil → dist/LocalTv-1.0.0.dmg
#
# Uso:
#   ./build.sh                 # build completo
#   ./build.sh --skip-frontend # solo backend + dmg
#   ./build.sh --skip-dmg      # solo backend (no genera DMG)
#   ./build.sh --clean         # limpia dist/ y build/ antes
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---- args -----------------------------------------------------------------
SKIP_FRONTEND=0
SKIP_DMG=0
CLEAN=0
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-dmg)      SKIP_DMG=1 ;;
    --clean)         CLEAN=1 ;;
    --version=*)     VERSION="${arg#--version=}" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "[!] Argumento desconocido: $arg" >&2; exit 1 ;;
  esac
done

# Resolver versión: --version > $LOCALTV_VERSION > tag de git > "1.0.0"
if [[ -z "$VERSION" ]]; then
  VERSION="${LOCALTV_VERSION:-}"
fi
if [[ -z "$VERSION" ]]; then
  if tag="$(git describe --tags --abbrev=0 2>/dev/null)"; then
    VERSION="${tag#v}"
  fi
fi
VERSION="${VERSION:-1.0.0}"

# ---- helpers --------------------------------------------------------------
step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()   { printf "\033[0;32m[OK]\033[0m %s\n" "$*"; }
warn() { printf "\033[0;33m[!]\033[0m  %s\n" "$*"; }
err()  { printf "\033[0;31m[X]\033[0m  %s\n" "$*" >&2; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "build.sh está pensado para macOS. En Windows usa .\\build.ps1"
  exit 1
fi

# ---- Limpieza opcional ----------------------------------------------------
if [[ $CLEAN -eq 1 ]]; then
  step "Limpieza previa"
  rm -rf "$ROOT/dist" "$ROOT/build" "$ROOT/frontend/dist"
  ok "Eliminados dist/, build/, frontend/dist/"
fi

# ---- 1. Python 3.11 / 3.12 / 3.13 -----------------------------------------
step "Detectando Python compatible (3.11 / 3.12 / 3.13)"
PYTHON_BIN=""
# Primero buscamos los binarios versionados explícitos
for v in 3.13 3.12 3.11; do
  if command -v "python$v" >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v "python$v")"
    ok "python$v en $PYTHON_BIN"
    break
  fi
done
# Fallback: si solo hay `python3` en el PATH (caso de algunos CI), validar versión
if [[ -z "$PYTHON_BIN" ]] && command -v python3 >/dev/null 2>&1; then
  V="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  case "$V" in
    3.11|3.12|3.13)
      PYTHON_BIN="$(command -v python3)"
      ok "python3 ($V) en $PYTHON_BIN"
      ;;
  esac
fi
if [[ -z "$PYTHON_BIN" ]]; then
  err "Necesitas Python 3.11/3.12/3.13. Instala con: brew install python@3.13"
  exit 1
fi

# ---- 2. Node.js >= 18 ------------------------------------------------------
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  step "Detectando Node.js >= 18"
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js no encontrado. Instala con: brew install node"
    exit 1
  fi
  NODE_VER="$(node -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_VER%%.*}"
  if (( NODE_MAJOR < 18 )); then
    err "Node v$NODE_VER es muy antiguo. Necesitas >= 18. Actualiza con: brew upgrade node"
    exit 1
  fi
  ok "Node.js v$NODE_VER"
fi

# ---- 3. iconutil (apple, viene con Xcode CLT) -----------------------------
if ! command -v iconutil >/dev/null 2>&1; then
  warn "iconutil no encontrado (parte de Xcode CLT). Instala con: xcode-select --install"
  warn "El .icns se generará vía Pillow como fallback."
fi

# ---- 4. venv + deps de build ----------------------------------------------
step "Configurando venv del backend"
VENV="$ROOT/backend/venv"
VENV_PY="$VENV/bin/python"
VENV_PYI="$VENV/bin/pyinstaller"

if [[ ! -x "$VENV_PY" ]]; then
  "$PYTHON_BIN" -m venv "$VENV"
  ok "venv creado"
fi

# Verificar versión del venv
VENV_VER="$("$VENV_PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "$VENV_VER" in
  3.11|3.12|3.13) ;;
  *)
    warn "venv usa Python $VENV_VER (incompatible). Recreando con $PYTHON_BIN..."
    rm -rf "$VENV"
    "$PYTHON_BIN" -m venv "$VENV"
    ;;
esac

step "Instalando dependencias de build"
"$VENV_PY" -m pip install --upgrade pip --quiet
"$VENV_PY" -m pip install -r "$ROOT/backend/requirements-build.txt" --quiet
ok "Dependencias instaladas"

# ---- 5. Generar iconos -----------------------------------------------------
step "Generando iconos (.icns + .png + .ico)"
"$VENV_PY" "$ROOT/installer/make_icon.py"
if [[ ! -f "$ROOT/installer/icon.icns" ]]; then
  err "icon.icns no se generó. Asegúrate de tener Xcode CLT (xcode-select --install) o Pillow con soporte ICNS."
  exit 1
fi
ok "icon.icns OK"

# ---- 6. Build del frontend -------------------------------------------------
if [[ $SKIP_FRONTEND -eq 0 ]]; then
  step "Build del frontend (Vite, version=$VERSION)"
  pushd "$ROOT/frontend" >/dev/null
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  # Inyectar LOCALTV_VERSION para vite.config.js (UpdateGate lo usa)
  LOCALTV_VERSION="$VERSION" npm run build
  popd >/dev/null
  ok "Frontend buildeado en frontend/dist"
fi

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  err "frontend/dist/index.html no existe. Corre el build sin --skip-frontend."
  exit 1
fi

# ---- 7. PyInstaller → dist/LocalTv.app -------------------------------------
step "Compilando con PyInstaller (.app bundle, v$VERSION)"
LOCALTV_VERSION="$VERSION" "$VENV_PYI" --noconfirm --clean "$ROOT/installer/LocalTv-mac.spec"

APP_PATH="$ROOT/dist/LocalTv.app"
if [[ ! -d "$APP_PATH" ]]; then
  err "LocalTv.app no fue generado en $APP_PATH"
  exit 1
fi
ok "Generado $APP_PATH"

# ---- 8. DMG con hdiutil ----------------------------------------------------
if [[ $SKIP_DMG -eq 0 ]]; then
  step "Empaquetando DMG con hdiutil (v$VERSION)"
  DMG_PATH="$ROOT/dist/LocalTv-$VERSION.dmg"
  STAGE="$ROOT/dist/dmg-stage"

  rm -rf "$STAGE" "$DMG_PATH"
  mkdir -p "$STAGE"
  cp -R "$APP_PATH" "$STAGE/"
  # Symlink a /Applications para drag-and-drop
  ln -s /Applications "$STAGE/Applications"

  hdiutil create \
    -volname "LocalTv" \
    -srcfolder "$STAGE" \
    -ov \
    -format UDZO \
    "$DMG_PATH" >/dev/null

  rm -rf "$STAGE"
  ok "Instalador: $DMG_PATH"
fi

# ---- Listo -----------------------------------------------------------------
echo ""
echo -e "\033[1;32m================================================================\033[0m"
echo -e "\033[1;32m  Build completado\033[0m"
echo -e "\033[1;32m================================================================\033[0m"
echo ""
echo "Salidas:"
echo "  - App bundle:  dist/LocalTv.app"
if [[ $SKIP_DMG -eq 0 ]]; then
  echo "  - Instalador:  dist/LocalTv-$VERSION.dmg"
fi
echo ""
echo "Para probar el .app sin instalar:"
echo "  open dist/LocalTv.app"
echo ""
