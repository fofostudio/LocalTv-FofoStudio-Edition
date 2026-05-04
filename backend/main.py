import os
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.database import engine, Base
from app.routers import channels, categories, streams, auth, admin, logos, updater, network
from app.models.category import Category  # noqa: F401 (registra modelo)
from app.models.channel import Channel    # noqa: F401
from app.models.user import User          # noqa: F401
from scripts.seed import seed


def _resource_dir() -> Path:
    """Carpeta base de recursos (compatible con PyInstaller --onefile)."""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return Path(base)
    return Path(__file__).resolve().parent


# --- Inicializar BD + seed ---
Base.metadata.create_all(bind=engine)
seed()


app = FastAPI(
    title="LocalTv API",
    description="API de la plataforma de streaming LocalTv (FofoStudio Edition)",
    version="1.0.0",
)

# CORS — útil para desarrollo (frontend en :5173). En producción servimos
# todo desde el mismo origen así que CORS no aplica.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers API ---
app.include_router(channels.router)
app.include_router(categories.router)
app.include_router(streams.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(logos.router)
app.include_router(updater.router)
app.include_router(network.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}


# --- Servir frontend buildeado (modo producción / .exe) ---
# El frontend buildeado vive en frontend/dist relativo a la raíz del proyecto,
# o copiado dentro del bundle de PyInstaller.
def _find_frontend_dist() -> Path | None:
    candidates = [
        _resource_dir() / "frontend_dist",                 # dentro del .exe
        Path(__file__).resolve().parent.parent / "frontend" / "dist",  # repo
    ]
    for c in candidates:
        if c.exists() and (c / "index.html").exists():
            return c
    return None


_dist = _find_frontend_dist()
if _dist:
    # Servir assets bajo /assets/* (Vite los emite ahí)
    assets_dir = _dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    def _index():
        return FileResponse(str(_dist / "index.html"))

    @app.get("/{full_path:path}")
    def _spa_fallback(full_path: str):
        # Si el path apunta a un archivo estático real (favicon, logo, etc.) lo servimos
        target = _dist / full_path
        if target.is_file():
            return FileResponse(str(target))
        # Si no, devolvemos el index para que React Router resuelva la ruta
        return FileResponse(str(_dist / "index.html"))
else:
    @app.get("/")
    def root():
        return {
            "message": "LocalTv API v1.0",
            "note": "Frontend no buildeado. Corre 'npm run build' en frontend/ o usa 'npm run dev'.",
        }
