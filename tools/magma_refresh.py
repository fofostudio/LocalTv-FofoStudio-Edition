"""Refresca el token + firma de Magma capturando el tráfico del celu por ADB.

El token (`/stream/secure/{token}/`) y el X-Hash NO se obtienen de ningún API
(los genera libmagma.so en la app). La única forma de renovarlos es capturarlos
del tráfico real. Este script automatiza la captura y actualiza backend/.env.

Requisitos: celu con MagmaPlayer + PCAPdroid instalados, conectado por ADB,
en la MISMA red Wi-Fi que esta PC.

Uso:
  python tools/magma_refresh.py 192.168.1.2     # IP LAN de esta PC

Pasos: arranca colector → arranca PCAPdroid (acepta VPN en el celu) →
reproduce un canal 15s → extrae token+hash+did → escribe backend/.env.
"""
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADB = r"C:\Users\Fofo\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PORT = 5123
CAP = ROOT / "tools" / "magma_refresh_cap.bin"


def collector(stop):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", PORT))
    s.settimeout(1.0)
    with open(CAP, "wb") as f:
        while not stop.is_set():
            try:
                f.write(s.recvfrom(65535)[0]); f.flush()
            except socket.timeout:
                pass
    s.close()


def adb(*args):
    return subprocess.run([ADB, *args], capture_output=True, text=True).stdout


def main():
    pc_ip = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.2"
    if "device" not in adb("devices"):
        print("✗ No hay dispositivo ADB conectado."); return
    if CAP.exists():
        CAP.unlink()

    stop = threading.Event()
    threading.Thread(target=collector, args=(stop,), daemon=True).start()
    print(f"• Colector UDP en {pc_ip}:{PORT}")

    adb("shell", "am", "start", "-n", "com.emanuelef.remote_capture/.activities.CaptureCtrl",
        "--es", "action", "start", "--es", "pcap_dump_mode", "udp_exporter",
        "--es", "collector_ip_address", pc_ip, "--es", "collector_port", str(PORT),
        "--es", "app_filter", "com.magmaplayer")
    print("• PCAPdroid iniciado. EN EL CELU: acepta la VPN y REPRODUCE un canal en Magma ~15s…")

    deadline = time.time() + 60
    token = xhash = xdid = None
    while time.time() < deadline:
        time.sleep(2)
        data = CAP.read_bytes() if CAP.exists() else b""
        m = re.search(rb'GET /stream/secure/([A-Za-z0-9_-]{6,16})/\d+\.m3u8 HTTP/1\.1\r\n(.*?)\r\n\r\n', data, re.S)
        if m:
            token = m.group(1).decode()
            hdrs = m.group(2).decode("latin-1", "ignore")
            xh = re.search(r'X-Hash:\s*(\S+)', hdrs)
            xd = re.search(r'X-Did:\s*(\S+)', hdrs)
            xhash = xh.group(1) if xh else None
            xdid = xd.group(1) if xd else None
            break

    stop.set()
    adb("shell", "am", "start", "-n", "com.emanuelef.remote_capture/.activities.CaptureCtrl",
        "--es", "action", "stop")

    if not token:
        print("✗ No capturé el stream. ¿Reprodujiste un canal? Reintentá."); return

    print(f"✓ token={token}  x-did={xdid}  x-hash=({len(xhash or '')} chars)")
    env = ROOT / "backend" / ".env"
    lines = env.read_text(encoding="utf-8").splitlines()
    kv = {"XTREAM_TOKEN": token, "XTREAM_XHASH": xhash or "", "XTREAM_XDID": xdid or ""}
    out, seen = [], set()
    for ln in lines:
        k = ln.split("=", 1)[0]
        if k in kv:
            out.append(f"{k}={kv[k]}"); seen.add(k)
        else:
            out.append(ln)
    for k, v in kv.items():
        if k not in seen:
            out.append(f"{k}={v}")
    env.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"✓ {env} actualizado. Reiniciá el backend para tomar los valores nuevos.")


if __name__ == "__main__":
    main()
