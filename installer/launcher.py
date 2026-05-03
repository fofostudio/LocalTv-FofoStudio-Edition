"""
LocalTv launcher (cross-platform: Windows + macOS).

Arranca FastAPI en localhost:8765, espera a que esté listo, abre el navegador
y muestra una pequeña ventana de control para detener el servicio.

Datos persistentes (BD SQLite) viven en una carpeta writable por usuario:
- Windows: %LOCALAPPDATA%\\LocalTv\\
- macOS:   ~/Library/Application Support/LocalTv/
- Linux:   ~/.local/share/LocalTv/  (fallback)

Así no se pisan al actualizar la app y no requieren permisos de admin.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


# ---------------------------------------------------------------------------
# Carpeta de datos por plataforma (writable, sin admin)
# ---------------------------------------------------------------------------
def _user_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LocalTv"
    if sys.platform.startswith("win"):
        base = os.getenv("LOCALAPPDATA")
        return Path(base) / "LocalTv" if base else Path.home() / "LocalTv"
    # Linux / otros
    base = os.getenv("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "LocalTv"


DATA_DIR = _user_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = (DATA_DIR / "LocalTv.db").as_posix()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_PATH}")
os.environ.setdefault("SECRET_API_KEY", "localtv-fofostudio-key")

# ---------------------------------------------------------------------------
# Cuando corre dentro de un bundle de PyInstaller, _MEIPASS es la carpeta
# temporal donde se extraen recursos. Necesitamos que el resto de módulos
# de la app puedan ser importados desde ahí.
# ---------------------------------------------------------------------------
if hasattr(sys, "_MEIPASS"):
    bundle = Path(sys._MEIPASS)
    if str(bundle) not in sys.path:
        sys.path.insert(0, str(bundle))


# ---------------------------------------------------------------------------
# Importar app DESPUÉS de inyectar la ruta y vars de entorno
# ---------------------------------------------------------------------------
import uvicorn  # noqa: E402
from main import app  # noqa: E402


PORT = 8765
URL = f"http://localhost:{PORT}"


# ---------------------------------------------------------------------------
def wait_until_port_open(host: str, port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def open_browser_when_ready() -> None:
    if wait_until_port_open("127.0.0.1", PORT):
        webbrowser.open(URL)


def run_server() -> None:
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="warning",
        access_log=False,
    )


# ---------------------------------------------------------------------------
# Ventana de control con Tkinter (stdlib — sin deps extra)
# ---------------------------------------------------------------------------
def _ui_font(size: int, weight: str = "normal") -> tuple:
    # Segoe UI en Windows, San Francisco/sistema en macOS, sans en Linux
    if sys.platform == "darwin":
        return ("Helvetica Neue", size, weight)
    if sys.platform.startswith("win"):
        return ("Segoe UI", size, weight)
    return ("DejaVu Sans", size, weight)


def show_status_window() -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("LocalTv · FofoStudio Edition")
    root.geometry("440x220")
    root.configure(bg="#0b0b13")
    root.resizable(False, False)

    # Intentar usar el icono empaquetado. Windows -> .ico, macOS -> .icns/.png
    try:
        bundle_dir = Path(getattr(sys, "_MEIPASS", "")) if hasattr(sys, "_MEIPASS") else Path(__file__).parent
        if sys.platform.startswith("win"):
            ico = bundle_dir / "icon.ico"
            if ico.exists():
                root.iconbitmap(default=str(ico))
        else:
            # En macOS Tk no soporta .icns directamente; intentamos PNG si existe
            png = bundle_dir / "icon.png"
            if png.exists():
                img = tk.PhotoImage(file=str(png))
                root.iconphoto(True, img)
    except Exception:
        pass

    tk.Label(
        root, text="● LocalTv está corriendo",
        font=_ui_font(14, "bold"),
        fg="#22c55e", bg="#0b0b13",
    ).pack(pady=(22, 4))

    tk.Label(
        root, text="FofoStudio Edition",
        font=_ui_font(9),
        fg="#888", bg="#0b0b13",
    ).pack()

    link = tk.Label(
        root, text=URL,
        font=_ui_font(11, "underline"),
        fg="#06b6d4", bg="#0b0b13", cursor="hand2",
    )
    link.pack(pady=(10, 6))
    link.bind("<Button-1>", lambda e: webbrowser.open(URL))

    btn = tk.Button(
        root, text="Abrir en el navegador",
        command=lambda: webbrowser.open(URL),
        bg="#e50914", fg="#ffffff",
        font=_ui_font(10, "bold"),
        relief="flat", padx=18, pady=7,
        activebackground="#b00610", activeforeground="#ffffff",
        borderwidth=0, cursor="hand2",
    )
    btn.pack(pady=(8, 6))

    tk.Label(
        root, text="Cierra esta ventana para detener LocalTv",
        font=_ui_font(8),
        fg="#666", bg="#0b0b13",
    ).pack(side="bottom", pady=10)

    def on_close() -> None:
        root.destroy()
        os._exit(0)

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()


def is_port_in_use(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
def main() -> None:
    # Si ya hay una instancia corriendo en el puerto, solo abrir el navegador
    # y salir — evita "Address already in use".
    if is_port_in_use("127.0.0.1", PORT):
        webbrowser.open(URL)
        return

    threading.Thread(target=run_server, daemon=True).start()
    threading.Thread(target=open_browser_when_ready, daemon=True).start()
    show_status_window()


if __name__ == "__main__":
    main()
