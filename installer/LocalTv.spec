# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for LocalTv (FofoStudio Edition).

Ejecutar:
    pyinstaller --noconfirm installer/LocalTv.spec

Genera dist/LocalTv/LocalTv.exe (one-folder build) que incluye:
- el backend FastAPI compilado
- el frontend buildeado (frontend/dist) embebido como recurso
- el ícono custom
"""
import sys
from pathlib import Path

block_cipher = None

ROOT = Path(SPECPATH).parent.resolve()
LAUNCHER = str(ROOT / "installer" / "launcher.py")
ICON = str(ROOT / "installer" / "icon.ico")

DATAS = [
    # Frontend buildeado → carpeta 'frontend_dist' dentro del bundle
    (str(ROOT / "frontend" / "dist"), "frontend_dist"),
    # main.py va al root del bundle para que `from main import app` funcione
    (str(ROOT / "backend" / "main.py"), "."),
    # Toda la app
    (str(ROOT / "backend" / "app"),     "app"),
    (str(ROOT / "backend" / "scripts"), "scripts"),
    # Ícono accesible en runtime para Tk
    (ICON, "."),
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
    # módulos de la app — PyInstaller a veces no los detecta vía import dinámico
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
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
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
    upx=False,         # UPX puede romper algunas DLLs en Windows
    console=False,     # GUI app (Tk window)
    disable_windowed_traceback=False,
    icon=ICON,
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
