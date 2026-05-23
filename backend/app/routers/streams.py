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

# Cliente HTTP compartido con keep-alive/pooling. Crear uno por request (como
# antes) abría una conexión TLS nueva cada vez — carísimo en vivo, donde el
# player pide un segmento cada pocos segundos + refresca el playlist. Reutilizar
# conexiones baja latencia y CPU notablemente.
_shared_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=8.0),
            headers=UPSTREAM_HEADERS,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=30),
        )
    return _shared_client


async def close_shared_client() -> None:
    global _shared_client
    if _shared_client is not None and not _shared_client.is_closed:
        await _shared_client.aclose()
    _shared_client = None

# Patrones para extraer la URL real del .m3u8 desde el HTML del player
_PATTERNS = [
    re.compile(r'playbackURL\s*[=:]\s*["\']?([^"\'<>\s]+\.m3u8[^"\'<>\s]*)', re.IGNORECASE),
    re.compile(r'<source[^>]+src=["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'(https?://[^"\'<>\s]+\.m3u8[^"\'<>\s]*)', re.IGNORECASE),
]


async def get_stream_url(channel_slug: str) -> str:
    """Resuelve el slug → URL real del manifest .m3u8 (scrape de tvtvhd).

    Reintenta ante fallos transitorios del upstream (tvtvhd a veces tira 5xx
    o timeouts esporádicos que rompían la reproducción en vivo).
    """
    upstream = f"https://tvtvhd.com/vivo/canales.php?stream={channel_slug}"
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            r = await _client().get(upstream)
            html = r.text
            for pat in _PATTERNS:
                m = pat.search(html)
                if m:
                    url = m.group(1).strip()
                    if url.startswith("http"):
                        return url
            last_err = HTTPException(status_code=404, detail="Manifest .m3u8 no encontrado")
        except httpx.HTTPError as e:
            last_err = HTTPException(status_code=502, detail=f"Upstream error: {e}")
        await asyncio.sleep(0.4 * (attempt + 1))
    raise last_err or HTTPException(status_code=502, detail="No se pudo resolver el stream")


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


def _is_master_playlist(text: str) -> bool:
    return "#EXT-X-STREAM-INF" in (text or "")


def _select_variant(text: str, base: str) -> str | None:
    """De un master playlist, elige la variante de mayor BANDWIDTH (mejor calidad)."""
    lines = text.splitlines()
    best_url, best_bw = None, -1
    for i, raw in enumerate(lines):
        if raw.strip().startswith("#EXT-X-STREAM-INF"):
            m = re.search(r"BANDWIDTH=(\d+)", raw)
            bw = int(m.group(1)) if m else 0
            for j in range(i + 1, len(lines)):
                u = lines[j].strip()
                if u and not u.startswith("#"):
                    if bw > best_bw:
                        best_bw, best_url = bw, urljoin(base, u)
                    break
    return best_url


async def _get_retry(url: str, tries: int = 3):
    """GET (cliente compartido) con reintentos ante errores transitorios
    (5xx/timeout/conexión). Los 4xx no se reintentan (no van a mejorar)."""
    last: Exception | None = None
    for attempt in range(tries):
        try:
            r = await _client().get(url)
            if r.status_code in (200, 206):
                return r
            last = HTTPException(status_code=502, detail=f"Upstream HTTP {r.status_code}")
            if r.status_code < 500 and r.status_code != 429:
                break  # 4xx definitivo
        except httpx.HTTPError as e:
            last = HTTPException(status_code=502, detail=f"Upstream error: {e}")
        await asyncio.sleep(0.35 * (attempt + 1))
    raise last or HTTPException(status_code=502, detail="Upstream sin respuesta")


# Caché corta de la URL de manifest resuelta por slug, para no re-scrapear
# tvtvhd en cada refresh del playlist en vivo (cada ~6s) pero igual mantenerlo
# fresco. La variante (media playlist) sí se re-baja siempre para traer
# segmentos nuevos.
_RESOLVE_TTL = 45.0
_resolve_cache: dict[str, dict] = {}


async def _resolve_media_playlist(slug: str, force: bool = False) -> tuple[str, str]:
    """
    Devuelve (texto_media_playlist, base_url). Si el upstream entrega un master
    playlist, baja la variante de mayor calidad y devuelve ESA (aplanado), así
    el player refresca /playlist.m3u8 (que re-resuelve) en vez de una URL de
    variante con token que se vuelve inválida → se cortaba la transmisión.
    """
    now = time.time()
    cached = _resolve_cache.get(slug)
    if not force and cached and now - cached["ts"] < _RESOLVE_TTL:
        master = cached["master"]
    else:
        master = await get_stream_url(slug)

    r = await _get_retry(master)
    text = r.text
    ct = (r.headers.get("content-type") or "").lower()
    if "html" in ct or not (text or "").lstrip().startswith("#EXTM3U"):
        raise HTTPException(status_code=502, detail="Canal no disponible (manifest inválido)")

    base = master
    if _is_master_playlist(text):
        variant = _select_variant(text, master)
        if variant:
            rv = await _get_retry(variant)
            vt = rv.text
            vct = (rv.headers.get("content-type") or "").lower()
            if "html" not in vct and (vt or "").lstrip().startswith("#EXTM3U"):
                text, base = vt, variant

    _resolve_cache[slug] = {"ts": now, "master": master}
    return text, base


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
    # Resolvemos con reintentos + aplanado master→variante. Si falla, forzamos
    # un re-scrape fresco de tvtvhd y reintentamos una vez más (cubre el caso de
    # token/URL vencidos durante la reproducción en vivo).
    try:
        text, base = await _resolve_media_playlist(slug)
    except HTTPException:
        _resolve_cache.pop(slug, None)
        text, base = await _resolve_media_playlist(slug, force=True)

    rewritten = _rewrite_manifest(text, base=base, slug=slug)
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
    forward_headers = {}
    range_header = request.headers.get("range")
    if range_header:
        forward_headers["Range"] = range_header

    # Cliente compartido (keep-alive). GET con reintentos: un blip transitorio
    # del upstream (5xx/timeout) no debe cortar la reproducción.
    head = None
    last_status = None
    for attempt in range(3):
        try:
            head = await _client().get(u, headers=forward_headers)
            last_status = head.status_code
            if head.status_code in (200, 206):
                break
            if head.status_code < 500 and head.status_code != 429:
                break  # 4xx definitivo, no reintentar
        except httpx.HTTPError:
            head = None
        await asyncio.sleep(0.3 * (attempt + 1))

    if head is None or head.status_code not in (200, 206):
        raise HTTPException(
            status_code=502,
            detail=f"Upstream HTTP {last_status} para segmento",
        )
    ct = head.headers.get("content-type", "")

    if _is_manifest(ct, u):
        text = head.text
        if "html" in ct.lower() or not text.lstrip().startswith("#EXTM3U"):
            raise HTTPException(
                status_code=502,
                detail="Sub-manifest inválido: el upstream no devolvió HLS",
            )
        rewritten = _rewrite_manifest(text, base=u, slug=slug)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Binario (segmento .ts/mp4/aac/m4s/CMAF/cifrado/...). Solo
    # descartamos lo OBVIAMENTE roto: Content-Type=html.
    if "html" in ct.lower():
        raise HTTPException(
            status_code=502,
            detail="Segmento inválido: el upstream devolvió HTML",
        )
    body = head.content

    # Sanity: si el body es muy chico (<32 bytes) y NO es "not found"
    # pero tampoco bytes binarios, descartar. "not found" pasa por aquí.
    if len(body) < 32:
        try:
            preview = body.decode("ascii", errors="ignore").strip().lower()
            if preview in ("not found", "404", "404 not found", "forbidden", "unauthorized"):
                raise HTTPException(
                    status_code=502,
                    detail=f"Segmento inválido: upstream respondió '{preview}'",
                )
        except HTTPException:
            raise
        except Exception:
            pass

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
