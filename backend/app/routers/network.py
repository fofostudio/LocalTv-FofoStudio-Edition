"""
Endpoint de info de red — usado por el frontend para descubrir la IP local
del host y armar URLs accesibles desde otros dispositivos en la LAN
(Chromecast, AirPlay, celulares).

GET /api/network/info → { lan_ip, hostname, port, lan_url }
"""
from __future__ import annotations

import os
import socket

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/network", tags=["network"])


def _lan_ip() -> str:
    """
    Devuelve la IP de salida hacia internet (interface principal de la LAN).
    No requiere que haya internet — usa una conexión UDP "fake" sin tráfico
    real.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.4)
        s.connect(("8.8.8.8", 53))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


@router.get("/info")
def info(request: Request):
    port = int(os.getenv("LOCALTV_PORT", "8765"))
    ip = _lan_ip()
    return {
        "lan_ip": ip,
        "hostname": socket.gethostname(),
        "port": port,
        "lan_url": f"http://{ip}:{port}",
        # Útil para cuando el frontend está en file:// (capacitor) y necesita
        # resolver una URL absoluta
        "request_origin": str(request.base_url).rstrip("/"),
    }
