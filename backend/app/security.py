"""
Utilidades de seguridad de red compartidas por los routers.

Modelo de amenaza: la app puede enlazar a 0.0.0.0 (necesario para que el
Chromecast/otros dispositivos de la LAN alcancen el proxy HLS). Eso significa
que CUALQUIER dispositivo de la red puede pegarle a los endpoints. Por eso:

  - Los endpoints peligrosos (auto-updater, administración) se restringen a
    clientes loopback (127.0.0.1 / ::1): solo se operan desde la propia máquina.
  - El proxy de segmentos (que SÍ debe ser alcanzable por el Chromecast) valida
    que la URL destino sea pública — nunca una IP privada/loopback/link-local —
    para que no se pueda usar como relay SSRF contra la red interna del usuario.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from functools import lru_cache
from urllib.parse import urlparse

from fastapi import HTTPException, Request


# ---------------------------------------------------------------------------
# Restricción loopback (updater / admin)
# ---------------------------------------------------------------------------
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _client_host(request: Request) -> str:
    return (request.client.host if request.client else "") or ""


def is_loopback_request(request: Request) -> bool:
    host = _client_host(request)
    if host in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def require_local(request: Request) -> None:
    """Dependency: aborta con 403 si la petición no viene de la propia máquina.

    Se usa en el auto-updater (descarga+ejecuta binarios) y en administración.
    Esas acciones se hacen desde el navegador local apuntando a la app; no hay
    razón legítima para invocarlas desde otro dispositivo de la red, y permitirlo
    convertiría la exposición LAN en ejecución remota de código."""
    if is_loopback_request(request):
        return
    raise HTTPException(
        status_code=403,
        detail="Esta acción solo está permitida desde el equipo que ejecuta la app.",
    )


def require_local_admin(request: Request) -> None:
    """Como require_local, pero con escape hatch para quien sí quiera administrar
    desde la LAN (raro): LOCALTV_ALLOW_LAN_ADMIN=true. El updater NUNCA se abre."""
    if os.getenv("LOCALTV_ALLOW_LAN_ADMIN", "").lower() in ("1", "true", "yes"):
        return
    require_local(request)


# ---------------------------------------------------------------------------
# Anti-SSRF para el proxy de segmentos
# ---------------------------------------------------------------------------
def _ip_is_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # no parsea → bloquear por las dudas
    # Bloquea loopback, privadas (10/8, 172.16/12, 192.168/16), link-local
    # (169.254/16 incluye el metadata 169.254.169.254 de los clouds), reservadas
    # y unspecified. Solo dejamos pasar direcciones globales enrutables.
    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


@lru_cache(maxsize=512)
def _host_is_public(host: str) -> bool:
    """Resuelve el host y exige que TODAS sus IPs sean públicas. Cacheado: el
    proxy de segmentos llama a esto muchísimo y los hosts de CDN se repiten."""
    if not host:
        return False
    # Si ya es un literal IP, validarlo directo.
    try:
        ipaddress.ip_address(host)
        return not _ip_is_blocked(host)
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    if not infos:
        return False
    return all(not _ip_is_blocked(info[4][0]) for info in infos)


def is_safe_public_url(url: str) -> bool:
    """True si `url` es http(s) y apunta a un host público (no LAN/loopback).

    Corta el uso del proxy como relay SSRF hacia la red interna del usuario
    (router 192.168.x.x, servicios en localhost, metadata 169.254.169.254, …).
    Residual conocido: DNS rebinding (resolver público y luego conectar a
    privado); aceptable para el modelo de amenaza LAN."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    return _host_is_public(parsed.hostname)
