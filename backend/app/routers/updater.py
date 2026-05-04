"""
Auto-updater para Windows y macOS.

El frontend (UpdateGate) detecta una versión nueva en GitHub Releases y
llama a POST /api/update/install. Este router:

  1. Descarga el asset (.exe en Windows, .dmg en macOS) a la carpeta de
     datos del usuario.
  2. Lanza el installer en modo silencioso, desconectado del proceso padre.
  3. Programa el cierre del proceso actual de LocalTv en 1 segundo, para
     que el installer pueda escribir sobre los archivos sin conflictos.

Limitaciones honestas:
- En modo desarrollo (sin .exe ni .app empaquetados) no tiene sentido
  ejecutar el installer; el endpoint devuelve 503.
- Solo funciona si el frontend está sirviéndose desde el mismo backend
  Python (es decir, dentro del .exe o del .app). En modo browser puro
  no hay backend al cual pegarle y UpdateGate cae a window.open como
  fallback.
"""
from __future__ import annotations

import os
import platform
import stat
import subprocess
import sys
import threading
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/update", tags=["update"])


def _is_bundled() -> bool:
    """True cuando corremos dentro del .exe/.app empaquetado por PyInstaller."""
    return hasattr(sys, "_MEIPASS")


def _data_dir() -> Path:
    """Misma carpeta que usa installer/launcher.py para datos del usuario."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LocalTv"
    if sys.platform.startswith("win"):
        base = os.getenv("LOCALAPPDATA")
        return Path(base) / "LocalTv" if base else Path.home() / "LocalTv"
    base = os.getenv("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "LocalTv"


def _platform_kind() -> str:
    if sys.platform.startswith("win"):
        return "win"
    if sys.platform == "darwin":
        return "mac"
    return "linux"


# ---------------------------------------------------------------------------
# Capabilities — el frontend pregunta antes de mostrar el botón
# ---------------------------------------------------------------------------
@router.get("/capabilities")
def capabilities():
    """Le dice al frontend si la app puede auto-actualizarse en esta plataforma."""
    pk = _platform_kind()
    bundled = _is_bundled()
    return {
        "platform": pk,
        "bundled": bundled,
        "canAutoUpdate": bundled and pk in ("win", "mac"),
        "executable": sys.executable,
        "version": "1.0.0",
    }


# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
class InstallPayload(BaseModel):
    url: str
    asset_name: str | None = None


@router.post("/install")
async def install_update(payload: InstallPayload):
    if not _is_bundled():
        raise HTTPException(503, "Auto-update solo disponible en la app empaquetada (.exe / .app)")

    pk = _platform_kind()
    if pk not in ("win", "mac"):
        raise HTTPException(503, f"Plataforma {pk} no soportada para auto-update")

    if not (payload.url.startswith("http://") or payload.url.startswith("https://")):
        raise HTTPException(400, "URL inválida")

    target_dir = _data_dir() / "updates"
    target_dir.mkdir(parents=True, exist_ok=True)

    # Resolver el filename del asset
    name = payload.asset_name or payload.url.rsplit("/", 1)[-1] or "update-installer"
    target_path = target_dir / name

    # Descargar (streaming, soporta archivos grandes)
    try:
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
            async with client.stream("GET", payload.url) as resp:
                resp.raise_for_status()
                with open(target_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(64 * 1024):
                        f.write(chunk)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo descargar el instalador: {e}")

    # Lanzar el instalador desconectado
    try:
        if pk == "win":
            _launch_windows(target_path)
        else:
            _launch_macos(target_path)
    except Exception as e:
        raise HTTPException(500, f"No se pudo lanzar el instalador: {e}")

    # Programar el cierre del proceso actual para que el installer pueda
    # sobrescribir los binarios. Damos 1.5s al cliente para recibir la
    # respuesta HTTP antes del exit duro.
    def _kill():
        try:
            os._exit(0)
        except Exception:
            pass

    threading.Timer(1.5, _kill).start()

    return {
        "status": "installing",
        "platform": pk,
        "installer": str(target_path),
        "size_bytes": target_path.stat().st_size,
    }


# ---------------------------------------------------------------------------
# Windows: Inno Setup soporta /SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS
# ---------------------------------------------------------------------------
def _launch_windows(installer_path: Path) -> None:
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

    subprocess.Popen(
        [
            str(installer_path),
            "/SILENT",
            "/CLOSEAPPLICATIONS",
            "/RESTARTAPPLICATIONS",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
        ],
        creationflags=flags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )


# ---------------------------------------------------------------------------
# macOS: script bash que monta el .dmg, reemplaza /Applications/LocalTv.app
# y relanza la app. Se ejecuta detached para que sobreviva al exit del padre.
# ---------------------------------------------------------------------------
def _launch_macos(dmg_path: Path) -> None:
    script_path = _data_dir() / "updates" / "apply-update.sh"
    log_path = _data_dir() / "updates" / "update.log"

    script = f"""#!/bin/bash
# LocalTv — script de actualización (generado automáticamente)
set -u
exec >> "{log_path}" 2>&1
echo ""
echo "==== $(date) ===="

DMG="{dmg_path}"
APP_DEST="/Applications/LocalTv.app"

# Esperar a que el proceso padre cierre completamente
sleep 3

echo "Montando $DMG..."
MOUNT_OUT=$(hdiutil attach -nobrowse -noverify -noautoopen "$DMG" 2>&1)
echo "$MOUNT_OUT"
MOUNT_POINT=$(echo "$MOUNT_OUT" | grep "/Volumes/" | awk -F'\\t' '{{print $NF}}' | tail -1)
if [ -z "$MOUNT_POINT" ]; then
    echo "ERROR: no se pudo montar el DMG"
    exit 1
fi
echo "Mount point: $MOUNT_POINT"

SOURCE_APP=$(ls -d "$MOUNT_POINT"/*.app 2>/dev/null | head -1)
if [ -z "$SOURCE_APP" ]; then
    echo "ERROR: el DMG no contiene una .app"
    hdiutil detach "$MOUNT_POINT" -quiet || true
    exit 1
fi
echo "Source app: $SOURCE_APP"

echo "Reemplazando $APP_DEST..."
rm -rf "$APP_DEST"
cp -R "$SOURCE_APP" "$APP_DEST"

echo "Desmontando..."
hdiutil detach "$MOUNT_POINT" -quiet || true

# Quitar quarantine para que macOS no muestre Gatekeeper
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

echo "Lanzando nueva versión..."
open "$APP_DEST"
echo "OK"
"""
    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text(script)
    script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    subprocess.Popen(
        ["/bin/bash", str(script_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
