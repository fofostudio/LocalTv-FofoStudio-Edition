# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for LocalTv (FofoStudio Edition) — macOS.

Ejecutar:
    pyinstaller --noconfirm installer/LocalTv-mac.spec

Genera dist/LocalTv.app (bundle nativo) que incluye:
- el backend FastAPI
- el frontend buildeado (frontend/dist) embebido
- el ícono custom (.icns)
"""
import os
import sys
from pathlib import Path

block_cipher = None

ROOT = Path(SPECPATH).parent.resolve()
LAUNCHER = str(ROOT / "installer" / "launcher.py")
ICON_ICNS = str(ROOT / "installer" / "icon.icns")
ICON_PNG = str(ROOT / "installer" / "icon.png")

# Versión: env var LOCALTV_VERSION (la pasa build.sh) > "1.0.0"
APP_VERSION = os.environ.get("LOCALTV_VERSION", "1.0.0")

DATAS = [
    (str(ROOT / "frontend" / "dist"), "frontend_dist"),
    (str(ROOT / "backend" / "main.py"), "."),
    (str(ROOT / "backend" / "app"),     "app"),
    (str(ROOT / "backend" / "scripts"), "scripts"),
    # PNG para iconphoto en Tk
    (ICON_PNG, "."),
]

HIDDEN = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "sqlalchemy.dialects.sqlite",
    "anyio._backends._asyncio",
    "email_validator",
    "app",
    "app.database",
    "app.config",
    "app.auth",
    "app.models",
    "app.models.channel",
    "app.models.category",
    "app.models.user",
    "app.routers",
    "app.routers.channels",
    "app.routers.categories",
    "app.routers.streams",
    "app.routers.auth",
    "app.routers.admin",
    "app.routers.logos",
    "app.routers.updater",
    "app.routers.network",
    "app.crud",
    "app.crud.channels",
    "app.crud.categories",
    "app.crud.users",
    "app.schemas",
    "app.schemas.channel",
    "app.schemas.category",
    "app.schemas.user",
    "app.services",
    "app.services.scraper",
    "scripts",
    "scripts.seed",
]

a = Analysis(
    [LAUNCHER],
    pathex=[str(ROOT / "backend"), str(ROOT)],
    binaries=[],
    datas=DATAS,
    hiddenimports=HIDDEN,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib", "pytest", "tornado", "PySide6", "PyQt5", "PyQt6",
        "notebook", "IPython", "jupyter",
    ],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LocalTv",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon=ICON_ICNS,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="LocalTv",
)

# .app bundle nativo de macOS
app = BUNDLE(
    coll,
    name="LocalTv.app",
    icon=ICON_ICNS,
    bundle_identifier="com.fofostudio.localtv",
    info_plist={
        "CFBundleName": "LocalTv",
        "CFBundleDisplayName": "LocalTv",
        "CFBundleShortVersionString": APP_VERSION,
        "CFBundleVersion": APP_VERSION,
        "CFBundleIdentifier": "com.fofostudio.localtv",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "11.0",
        "NSHumanReadableCopyright": "© 2026 FofoStudio",
        # No Dock icon hopping innecesario; igual la app es GUI (Tk)
        "LSUIElement": False,
        # Para que requests salientes (httpx) funcionen sin warnings extras
        "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
    },
)
