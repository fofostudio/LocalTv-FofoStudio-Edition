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
import traceback
import webbrowser
from datetime import datetime
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

LOG_FILE = DATA_DIR / "launcher.log"


# ---------------------------------------------------------------------------
# Fix PyInstaller GUI mode (console=False): sys.stdout/stderr son None,
# y librerías como uvicorn (DefaultFormatter -> stderr.isatty()) explotan.
# Asignamos un stream válido que no rompa nada y descarta la salida.
# ---------------------------------------------------------------------------
class _NullStream:
    encoding = "utf-8"
    errors = None

    def write(self, _s: str) -> int: return 0
    def flush(self) -> None: pass
    def isatty(self) -> bool: return False
    def fileno(self) -> int: raise OSError("no fileno in null stream")
    def writable(self) -> bool: return True
    def readable(self) -> bool: return False
    def seekable(self) -> bool: return False
    def close(self) -> None: pass


if sys.stdout is None:
    sys.stdout = _NullStream()  # type: ignore[assignment]
if sys.stderr is None:
    sys.stderr = _NullStream()  # type: ignore[assignment]


def log(msg: str) -> None:
    """Append una línea con timestamp al log del usuario.

    Crítico cuando corremos como GUI (.exe sin consola): es la única vía para
    diagnosticar arranques fallidos.
    """
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}\n"
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


log("=" * 60)
log(f"Arrancando LocalTv | platform={sys.platform} | python={sys.version.split()[0]}")
log(f"DATA_DIR={DATA_DIR}")
log(f"DB_PATH={DB_PATH}")
log(f"_MEIPASS={getattr(sys, '_MEIPASS', '(n/a)')}")
log(f"sys.executable={sys.executable}")

# ---------------------------------------------------------------------------
# sys.path: en bundle, _MEIPASS contiene main.py + app/. En modo source
# (debug), backend/ es donde están main.py + app/.
# ---------------------------------------------------------------------------
if hasattr(sys, "_MEIPASS"):
    bundle = Path(sys._MEIPASS)
    if str(bundle) not in sys.path:
        sys.path.insert(0, str(bundle))
else:
    # Modo source: agregar backend/ al sys.path para encontrar main.py
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if backend_dir.exists() and str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))


# ---------------------------------------------------------------------------
# Importar app DESPUÉS de inyectar la ruta y vars de entorno.
# Si esto falla, capturamos el traceback y lo guardamos en el log para que
# el usuario pueda enviárnoslo.
# ---------------------------------------------------------------------------
try:
    import uvicorn  # noqa: E402
    from main import app  # noqa: E402
    log("import OK: uvicorn + main.app")
except Exception as e:
    log(f"FATAL al importar la app: {e!r}")
    log(traceback.format_exc())
    # Reraise para que la ventana Tk lo muestre (ver main())
    _IMPORT_ERROR: BaseException | None = e
    _IMPORT_TB: str = traceback.format_exc()
    app = None  # type: ignore[assignment]
else:
    _IMPORT_ERROR = None
    _IMPORT_TB = ""


PORT = 8765
URL = f"http://localhost:{PORT}"

# Mensaje compartido entre el thread del server y la UI Tk
_SERVER_ERROR: dict[str, str | None] = {"msg": None, "tb": None}


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
    """Arranca uvicorn y captura cualquier excepción a un log + a la UI."""
    # log_config sin DefaultFormatter de uvicorn (que rompe en console=False
    # porque hace sys.stderr.isatty()). Usamos formatters de stdlib.
    log_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
        },
        "handlers": {
            "null": {"class": "logging.NullHandler"},
        },
        "loggers": {
            "uvicorn":        {"handlers": ["null"], "level": "WARNING", "propagate": False},
            "uvicorn.error":  {"handlers": ["null"], "level": "WARNING", "propagate": False},
            "uvicorn.access": {"handlers": ["null"], "level": "WARNING", "propagate": False},
        },
    }
    # 0.0.0.0 permite que dispositivos en la misma LAN (Chromecast, otros
    # dispositivos) accedan a la app — sin esto, cast no funciona porque
    # el ChromeCast no puede llegar a 127.0.0.1 del host.
    bind_host = os.getenv("LOCALTV_BIND", "0.0.0.0")
    try:
        log(f"uvicorn.run() iniciando en {bind_host}:{PORT}...")
        uvicorn.run(
            app,
            host=bind_host,
            port=PORT,
            log_config=log_config,
            access_log=False,
        )
        log("uvicorn.run() terminó normalmente")
    except SystemExit as e:
        # uvicorn llama sys.exit en algunos errores (ej. puerto en uso). No
        # propagamos para mantener viva la ventana de control.
        msg = f"uvicorn salió con SystemExit({e.code})"
        log(msg)
        _SERVER_ERROR["msg"] = msg
        _SERVER_ERROR["tb"] = traceback.format_exc()
    except BaseException as e:
        msg = f"{type(e).__name__}: {e}"
        log(f"FATAL en run_server: {msg}")
        log(traceback.format_exc())
        _SERVER_ERROR["msg"] = msg
        _SERVER_ERROR["tb"] = traceback.format_exc()


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


def _show_error_window(title: str, summary: str, detail: str) -> None:
    """Muestra una ventana Tk con el error y un botón para abrir el log."""
    import tkinter as tk
    from tkinter import scrolledtext

    root = tk.Tk()
    root.title(f"LocalTv · {title}")
    root.geometry("680x440")
    root.configure(bg="#0b0b13")

    tk.Label(
        root, text=f"⚠ {title}",
        font=_ui_font(14, "bold"),
        fg="#ef4444", bg="#0b0b13",
    ).pack(pady=(18, 4))

    tk.Label(
        root, text=summary,
        font=_ui_font(10),
        fg="#a1a1aa", bg="#0b0b13",
        wraplength=620, justify="center",
    ).pack(pady=(0, 12))

    box = scrolledtext.ScrolledText(
        root, height=14, width=80,
        bg="#11111c", fg="#e4e4e7",
        font=("Consolas" if sys.platform.startswith("win") else "Menlo", 9),
        relief="flat", borderwidth=0,
    )
    box.pack(padx=18, pady=(0, 8), fill="both", expand=True)
    box.insert("1.0", detail)
    box.configure(state="disabled")

    bar = tk.Frame(root, bg="#0b0b13")
    bar.pack(fill="x", pady=(0, 14))

    def open_log_dir() -> None:
        try:
            if sys.platform.startswith("win"):
                os.startfile(str(DATA_DIR))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                os.system(f'open "{DATA_DIR}"')
            else:
                os.system(f'xdg-open "{DATA_DIR}"')
        except Exception:
            pass

    tk.Button(
        bar, text="Abrir carpeta del log",
        command=open_log_dir,
        bg="#1f1f2e", fg="#fff", font=_ui_font(10, "bold"),
        relief="flat", padx=14, pady=6, borderwidth=0, cursor="hand2",
    ).pack(side="left", padx=18)

    tk.Button(
        bar, text="Cerrar",
        command=lambda: (root.destroy(), os._exit(1)),
        bg="#e50914", fg="#fff", font=_ui_font(10, "bold"),
        relief="flat", padx=18, pady=6, borderwidth=0, cursor="hand2",
    ).pack(side="right", padx=18)

    root.protocol("WM_DELETE_WINDOW", lambda: (root.destroy(), os._exit(1)))
    root.mainloop()


def show_status_window() -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("LocalTv · FofoStudio Edition")
    root.geometry("440x260")
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
            png = bundle_dir / "icon.png"
            if png.exists():
                img = tk.PhotoImage(file=str(png))
                root.iconphoto(True, img)
    except Exception:
        pass

    status_label = tk.Label(
        root, text="◌ Iniciando LocalTv…",
        font=_ui_font(14, "bold"),
        fg="#a1a1aa", bg="#0b0b13",
    )
    status_label.pack(pady=(22, 4))

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

    info_label = tk.Label(
        root, text="",
        font=_ui_font(9),
        fg="#71717a", bg="#0b0b13",
    )
    info_label.pack(pady=(2, 0))

    tk.Label(
        root, text="Cierra esta ventana para detener LocalTv",
        font=_ui_font(8),
        fg="#666", bg="#0b0b13",
    ).pack(side="bottom", pady=10)

    def refresh() -> None:
        if _SERVER_ERROR["msg"]:
            # Cambia la ventana a modo error
            status_label.configure(text="⚠ LocalTv falló al arrancar", fg="#ef4444")
            info_label.configure(
                text=f"{_SERVER_ERROR['msg']}\nLog: {LOG_FILE}",
                fg="#ef4444",
            )
            btn.configure(state="disabled", bg="#3f3f46")
        elif is_port_in_use("127.0.0.1", PORT):
            status_label.configure(text="● LocalTv está corriendo", fg="#22c55e")
            info_label.configure(text=f"Log: {LOG_FILE}", fg="#52525b")
        else:
            status_label.configure(text="◌ Iniciando LocalTv…", fg="#a1a1aa")
        root.after(500, refresh)

    refresh()

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
    # Si la app no se pudo importar, mostramos directamente la pantalla de
    # error con el traceback. Sin app no hay nada que correr.
    if _IMPORT_ERROR is not None:
        _show_error_window(
            "No se pudo iniciar LocalTv",
            "El módulo principal no se pudo cargar. Esto suele ser un problema "
            "del empaquetado (un módulo faltante en el bundle).",
            f"{type(_IMPORT_ERROR).__name__}: {_IMPORT_ERROR}\n\n{_IMPORT_TB}\n\n"
            f"Log: {LOG_FILE}",
        )
        return

    # Si ya hay una instancia corriendo en el puerto, solo abrir el navegador
    # y salir — evita "Address already in use".
    if is_port_in_use("127.0.0.1", PORT):
        log("Otra instancia ya escucha en :8765 — abriendo browser y saliendo")
        webbrowser.open(URL)
        return

    threading.Thread(target=run_server, daemon=True).start()
    threading.Thread(target=open_browser_when_ready, daemon=True).start()
    show_status_window()


if __name__ == "__main__":
    main()
