"""
Streams router.

- GET /api/streams/{slug}                 → JSON con la URL real (debug)
- GET /api/streams/{slug}/playlist.m3u8   → manifest proxied con segmentos reescritos
- GET /api/streams/{slug}/segment?u=...   → proxy de bytes (.ts o sub-manifest)
- GET /api/streams/health                 → set de slugs activos en este momento (cacheado 60s)

El proxy resuelve el problema clásico de HLS embebido:
los servidores de tvtvhd validan el header Referer y rechazan al navegador
(que no puede setear ese header desde JS — es "forbidden"). El backend lo
añade y reenvía los bytes con CORS abierto.
"""
from __future__ import annotations

import asyncio
import re
import time
from urllib.parse import urljoin, urlparse, quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.crud import channels as crud_channels

router = APIRouter(prefix="/api/streams", tags=["streams"])

UPSTREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://tvtvhd.com/",
    "Origin":  "https://tvtvhd.com",
    "Accept":  "*/*",
}

# Patrones para extraer la URL real del .m3u8 desde el HTML del player
_PATTERNS = [
    re.compile(r'playbackURL\s*[=:]\s*["\']?([^"\'<>\s]+\.m3u8[^"\'<>\s]*)', re.IGNORECASE),
    re.compile(r'<source[^>]+src=["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'(https?://[^"\'<>\s]+\.m3u8[^"\'<>\s]*)', re.IGNORECASE),
]


async def get_stream_url(channel_slug: str) -> str:
    """Resuelve el slug → URL real del manifest .m3u8 (scrape de tvtvhd)."""
    upstream = f"https://tvtvhd.com/vivo/canales.php?stream={channel_slug}"
    try:
        async with httpx.AsyncClient(
            timeout=10, headers=UPSTREAM_HEADERS, follow_redirects=True
        ) as client:
            r = await client.get(upstream)
            html = r.text
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}")

    for pat in _PATTERNS:
        m = pat.search(html)
        if m:
            url = m.group(1).strip()
            if url.startswith("http"):
                return url
    raise HTTPException(status_code=404, detail="Manifest .m3u8 no encontrado en upstream")


# ---------------------------------------------------------------------------
# Helpers para reescribir manifests
# ---------------------------------------------------------------------------
def _rewrite_uri_attr(line: str, base: str, slug: str) -> str:
    """Reescribe URIs en directivas como #EXT-X-KEY:URI=...  o #EXT-X-MAP:URI=..."""
    def repl(match: re.Match) -> str:
        original = match.group(1)
        absolute = urljoin(base, original)
        return f'URI="/api/streams/{slug}/segment?u={quote(absolute, safe="")}"'
    return re.sub(r'URI="([^"]+)"', repl, line)


def _rewrite_manifest(text: str, base: str, slug: str) -> str:
    """
    Reescribe un manifest .m3u8 para que TODAS las URLs (segmentos, sub-playlists,
    keys de cifrado, mapas init) pasen por nuestro endpoint /segment?u=<url>.
    """
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            out.append(line)
            continue
        if line.startswith("#"):
            if "URI=" in line:
                line = _rewrite_uri_attr(line, base, slug)
            out.append(line)
            continue
        # Línea de URL (puede ser segmento o sub-playlist)
        absolute = urljoin(base, line)
        out.append(f"/api/streams/{slug}/segment?u={quote(absolute, safe='')}")
    return "\n".join(out) + "\n"


def _is_manifest(content_type: str | None, url: str) -> bool:
    if url.lower().split("?")[0].endswith(".m3u8"):
        return True
    if content_type and ("mpegurl" in content_type.lower()):
        return True
    return False


# ---------------------------------------------------------------------------
# Health: cuáles canales están realmente disponibles AHORA
# ---------------------------------------------------------------------------
_HEALTH_TTL = 60.0  # segundos — el upstream cambia disponibilidad cada minuto-ish
_health_cache: dict = {"ts": 0.0, "live": set()}


async def _probe_one(client: httpx.AsyncClient, slug: str) -> tuple[str, bool]:
    """
    Probe ligero, optimizado para mostrar la mayor cantidad de canales
    realmente disponibles sin matar la lista por ratelimits o timeouts:

    Pide el HTML del player. Si responde 200 y contiene una URL .m3u8
    embedida → live. Si no → offline.

    NO confiamos sólo en status.json (lo del v1.0.14 daba falsos
    positivos), pero tampoco hacemos un segundo GET al m3u8 (era
    demasiado estricto en v1.0.15). Las validaciones de bytes en
    /segment ya filtran los streams realmente rotos en runtime.
    """
    upstream = f"https://tvtvhd.com/vivo/canales.php?stream={slug}"
    try:
        r = await client.get(upstream, timeout=8.0)
        if r.status_code != 200:
            return slug, False
        html = r.text or ""
        # Si el HTML del player tiene una URL m3u8 embedida, el slug
        # está vivo en tvtvhd. La calidad real del stream se valida en
        # los endpoints /playlist.m3u8 y /segment.
        for pat in _PATTERNS:
            m = pat.search(html)
            if m and m.group(1).strip().startswith("http"):
                return slug, True
        return slug, False
    except (httpx.HTTPError, asyncio.TimeoutError):
        return slug, False


async def _refresh_health(slugs: list[str]) -> set[str]:
    """Probe en paralelo con concurrency alta (deep probe ~7-10s para 100 canales)."""
    sem = asyncio.Semaphore(40)

    limits = httpx.Limits(max_connections=80, max_keepalive_connections=40)
    async with httpx.AsyncClient(
        headers=UPSTREAM_HEADERS, follow_redirects=True, limits=limits
    ) as client:
        async def task(slug: str):
            async with sem:
                return await _probe_one(client, slug)

        results = await asyncio.gather(*(task(s) for s in slugs))
    return {slug for slug, ok in results if ok}


@router.get("/health")
async def health(db: Session = Depends(get_db)):
    """
    Devuelve {live: [slugs activos]} usando tvtvhd status.json como
    fuente oficial. Es lo que el sitio web usa internamente para
    saber qué canales están al aire.

    Trade-off conocido:
    - Pro: rápido (1 fetch ~300ms), refleja la lista oficial,
      maximiza la cantidad de canales live (~50/98).
    - Con: hay lag de 1-2 minutos entre que un canal cae y status.json
      lo marca Inactivo. Para ese caso las defensas del player
      (validación Content-Type=html en /segment + recovery agresivo
      de hls.js + panel "Stream corrupto") absorben el bache.

    Si status.json falla (DNS/timeout) usamos el deep probe paralelo
    como fallback.
    """
    now = time.time()
    age = now - _health_cache["ts"]
    if age < _HEALTH_TTL and _health_cache["live"]:
        return {
            "live": sorted(_health_cache["live"]),
            "total": len(_health_cache["live"]),
            "cached_age_s": round(age, 1),
            "source": _health_cache.get("source", "cache"),
        }

    # 1. Fast path: status.json (un solo fetch)
    try:
        from app.services.scraper import fetch_status
        status_map = await fetch_status()  # {slug: is_live}
        live = {slug for slug, is_live in status_map.items() if is_live}
        _health_cache["ts"] = now
        _health_cache["live"] = live
        _health_cache["source"] = "status.json"
        return {"live": sorted(live), "total": len(live), "cached_age_s": 0.0,
                "source": "status.json"}
    except Exception as e:
        # 2. Fallback: deep probe (más lento)
        slugs = [c.slug for c in crud_channels.get_channels(db, active_only=False)]
        live = await _refresh_health(slugs)
        _health_cache["ts"] = now
        _health_cache["live"] = live
        _health_cache["source"] = "deep-probe"
        return {"live": sorted(live), "total": len(live), "cached_age_s": 0.0,
                "source": "deep-probe", "fallback_reason": str(e)}


# ---------------------------------------------------------------------------
# Endpoints HLS
# ---------------------------------------------------------------------------
@router.get("/{slug}")
async def get_stream(slug: str):
    """Devuelve la URL real (útil para debug). El frontend usa /playlist.m3u8."""
    url = await get_stream_url(slug)
    return {"url": url, "channel": slug, "proxy_url": f"/api/streams/{slug}/playlist.m3u8"}


@router.get("/{slug}/playlist.m3u8")
async def proxy_playlist(slug: str):
    """Resuelve el slug, descarga el manifest, reescribe segmentos y lo devuelve.

    Validaciones para evitar el bug 'demuxer-error: could not parse' que
    aparece cuando el proxy entrega contenido que no es un m3u8 válido
    (típicamente HTML cuando el upstream se cayó):
      - Content-Type del upstream no debe ser text/html
      - El body debe empezar con #EXTM3U (signature obligatoria del HLS)
    """
    real_url = await get_stream_url(slug)

    try:
        async with httpx.AsyncClient(
            timeout=15, headers=UPSTREAM_HEADERS, follow_redirects=True
        ) as client:
            r = await client.get(real_url)
            r.raise_for_status()
            text = r.text
            ct = (r.headers.get("content-type") or "").lower()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo descargar el manifest: {e}")

    # Validación 1: el upstream tiró una página HTML (canal caído / paywall / error)
    if "html" in ct:
        raise HTTPException(
            status_code=502,
            detail="Canal no disponible: el upstream devolvió HTML, no un manifest HLS",
        )
    # Validación 2: el body no es un manifest HLS válido
    head = (text or "").lstrip()[:32]
    if not head.startswith("#EXTM3U"):
        raise HTTPException(
            status_code=502,
            detail="Canal no disponible: el manifest no tiene signature #EXTM3U",
        )

    rewritten = _rewrite_manifest(text, base=real_url, slug=slug)
    return Response(
        content=rewritten,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/{slug}/segment")
async def proxy_segment(slug: str, u: str, request: Request):
    """
    Proxy genérico:
    - si la URL es un sub-manifest .m3u8 → la descarga, reescribe y devuelve
    - si es un segmento .ts/.aac/etc → streamea los bytes con Range support
    """
    if not (u.startswith("http://") or u.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL inválida")

    # Reenviar Range si el cliente lo manda (importante para seek y buffering)
    forward_headers = dict(UPSTREAM_HEADERS)
    range_header = request.headers.get("range")
    if range_header:
        forward_headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=30, follow_redirects=True)
    try:
        # Probe rápido para saber si es manifest o binario
        head = await client.get(u, headers=forward_headers)
        ct = head.headers.get("content-type", "")

        if _is_manifest(ct, u):
            text = head.text
            # Validar manifest (mismo guard que en /playlist.m3u8)
            if "html" in ct.lower() or not text.lstrip().startswith("#EXTM3U"):
                await client.aclose()
                raise HTTPException(
                    status_code=502,
                    detail="Sub-manifest inválido: el upstream no devolvió HLS",
                )
            rewritten = _rewrite_manifest(text, base=u, slug=slug)
            await client.aclose()
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
                headers={
                    "Cache-Control": "no-store",
                    "Access-Control-Allow-Origin": "*",
                },
            )

        # Binario (segmento .ts/mp4/aac/m4s/CMAF/cifrado/...). Solo
        # descartamos lo OBVIAMENTE roto: Content-Type=html. La validación
        # agresiva de bytes (sync 0x47, magic ftyp, AAC ADTS, ID3) bloqueaba
        # segmentos válidos pero con formatos inesperados (CMAF, encrypted,
        # m4s) y producía demuxer-error en TODOS los canales.
        if "html" in ct.lower():
            await client.aclose()
            raise HTTPException(
                status_code=502,
                detail="Segmento inválido: el upstream devolvió HTML",
            )
        body = head.content
        await client.aclose()

        resp_headers = {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=10",
        }
        # Pasar Content-Range si vino (respuesta 206)
        if "content-range" in head.headers:
            resp_headers["Content-Range"] = head.headers["content-range"]
        if "accept-ranges" in head.headers:
            resp_headers["Accept-Ranges"] = head.headers["accept-ranges"]

        return Response(
            content=body,
            status_code=head.status_code,
            media_type=ct or "video/mp2t",
            headers=resp_headers,
        )
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Upstream segment error: {e}")
