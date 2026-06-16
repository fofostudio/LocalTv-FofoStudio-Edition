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
from app.config import settings

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

# El panel Magma/TVClub exige este User-Agent o devuelve 404. El navegador no
# puede setearlo → el proxy del backend lo pone al bajar el m3u8 de Magma.
_MAGMA_UA = "Magma Player/10"


def _is_magma_url(url: str | None) -> bool:
    if not url:
        return False
    low = url.lower()
    return "/stream/secure/" in low or "tvcluboficial.com" in low or "m3uts" in low


def _hdr(url: str | None, extra: dict | None = None) -> dict:
    """Headers correctos según el upstream (Magma vs tvtvhd).

    Para Magma replicamos los headers de firma de la app oficial (X-App/X-Version/
    X-Hash/X-Did) — sin ellos el panel puede servir un stream placeholder de
    "actualización" en vez del canal real.
    """
    if _is_magma_url(url):
        h = {"User-Agent": _MAGMA_UA, "Accept": "*/*", "Accept-Encoding": "gzip"}
        if settings.XTREAM_XHASH:
            h["X-App"] = "di"
            h["X-Version"] = settings.XTREAM_XVERSION or "10/1.0.9"
            h["X-Hash"] = settings.XTREAM_XHASH
            if settings.XTREAM_XDID:
                h["X-Did"] = settings.XTREAM_XDID
    else:
        h = dict(UPSTREAM_HEADERS)
    if extra:
        h.update(extra)
    return h

# Cliente HTTP compartido con keep-alive/pooling. Crear uno por request (como
# antes) abría una conexión TLS nueva cada vez — carísimo en vivo, donde el
# player pide un segmento cada pocos segundos + refresca el playlist. Reutilizar
# conexiones baja latencia y CPU notablemente.
def _new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=8.0),
        headers=UPSTREAM_HEADERS,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=30),
    )


# Se crea eager (en import, single-thread) para evitar la race de dos coroutines
# creando el cliente a la vez y filtrando uno. httpx liga el pool al event loop
# en el primer request, no en la construcción, así que crearlo acá es seguro.
_shared_client: httpx.AsyncClient = _new_client()


def _client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client.is_closed:
        _shared_client = _new_client()
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
# tvtvhd dejó de embeber el m3u8 directo: el <iframe> de /vivo/ apunta a
# /tv/canales.php (player Clappr) donde el playbackURL trae el m3u8 real desde
# un CDN externo (Flussonic; hoy familia fubo18.com, antes la18hd.com — el
# host rota, por eso seguimos el iframe genéricamente en vez de hardcodearlo).
_IFRAME_RE = re.compile(r'<iframe[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)


def _find_m3u8(html: str) -> str | None:
    for pat in _PATTERNS:
        m = pat.search(html)
        if m:
            url = m.group(1).strip()
            if url.startswith("http"):
                return url
    return None


async def get_stream_url(channel_slug: str, db_stream_url: str | None = None) -> str:
    """Resuelve el slug → URL real del manifest .m3u8.

    Si el canal tiene un stream_url directo (.m3u8) en la BD, se usa tal cual.
    En caso contrario (tvtvhd), se scrapea siguiendo la cadena de iframes:
    `…/vivo/canales.php?stream=X` → `<iframe>` → `…/tv/canales.php?stream=X`
    (player Clappr) donde vive el `playbackURL` con el .m3u8 real (CDN externo,
    p.ej. fubo18). Seguimos hasta 3 niveles de iframe buscando el m3u8 en cada
    uno. Reintenta ante fallos transitorios del upstream.

    IMPORTANTE: el parámetro `?stream=` de tvtvhd NO siempre coincide con el
    slug de la BD (el slug se deriva del nombre: "Liga1 MAX" → `liga1-max`,
    pero el stream real es `liga1max`). Por eso, si la BD trae el stream_url de
    tvtvhd, lo usamos tal cual (ya lleva el param correcto) en vez de
    reconstruirlo desde el slug — reconstruirlo rompía todos los canales
    multi-palabra (DSports+, Fox Deportes, DAZN Eleven, Sky Bundesliga, …).
    """
    if db_stream_url and db_stream_url.lower().endswith(".m3u8"):
        return db_stream_url

    if db_stream_url and "canales.php" in db_stream_url.lower():
        url = db_stream_url
    else:
        url = f"https://tvtvhd.com/vivo/canales.php?stream={channel_slug}"
    referer = "https://tvtvhd.com/"
    last_err: Exception | None = None
    for _level in range(3):
        html: str | None = None
        for attempt in range(3):
            try:
                r = await _client().get(url, headers={"Referer": referer})
                html = r.text
                break
            except httpx.HTTPError as e:
                last_err = HTTPException(status_code=502, detail=f"Upstream error: {e}")
                await asyncio.sleep(0.4 * (attempt + 1))
        if not html:
            break
        found = _find_m3u8(html)
        if found:
            return found
        # No hay m3u8 en este nivel → seguir el iframe (la18hd u otro)
        im = _IFRAME_RE.search(html)
        if not im:
            break
        referer = url
        url = urljoin(url, im.group(1).strip())
    raise last_err or HTTPException(status_code=404, detail="Manifest .m3u8 no encontrado (¿iframe?)")


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
# tvtvhd en cada refresh del playlist en vivo (en cada ~6s) pero igual mantenerlo
# fresco. La variante (media playlist) sí se re-baja siempre para traer
# segmentos nuevos.
_RESOLVE_TTL = 45.0
_resolve_cache: dict[str, dict] = {}

# Caché de canales no disponibles (404 del CDN) para no re-scrapear
# innecesariamente — el upstream tarda en volver, no tiene sentido insistir.
_FAIL_TTL = 60.0
_fail_cache: dict[str, float] = {}


async def _resolve_media_playlist(slug: str, force: bool = False, db_stream_url: str | None = None) -> tuple[str, str]:
    """
    Devuelve (texto_media_playlist, base_url). Si el upstream entrega un master
    playlist, baja la variante de mayor calidad y devuelve ESA (aplanado), así
    el player refresca /playlist.m3u8 (que re-resuelve) en vez de una URL de
    variante con token que se vuelve inválida → se cortaba la transmisión.
    """
    now = time.time()

    # Si el canal está en fail cache, lo reportamos directamente sin scrapear
    fail_ts = _fail_cache.get(slug)
    if not force and fail_ts and now - fail_ts < _FAIL_TTL:
        raise HTTPException(status_code=503, detail="Canal no disponible (sin señal)")

    cached = _resolve_cache.get(slug)
    if not force and cached and now - cached["ts"] < _RESOLVE_TTL:
        master = cached["master"]
    else:
        try:
            master = await get_stream_url(slug, db_stream_url=db_stream_url)
        except HTTPException:
            # Falló la resolución (scraper), cacheamos como no disponible
            _fail_cache[slug] = now
            raise

    # No usar _get_retry: queremos manejar 404 como "sin señal" (503),
    # no como "upstream error" (502). _get_retry convierte 4xx en 502.
    try:
        r = await _client().get(master, headers=_hdr(master))
        if r.status_code not in (200, 206) and r.status_code != 404:
            # 5xx/timeout → reintentar una vez
            if r.status_code >= 500 or r.status_code == 429:
                for _ in range(2):
                    await asyncio.sleep(0.5)
                    r = await _client().get(master, headers=_hdr(master))
                    if r.status_code in (200, 206):
                        break
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}")
    text = r.text or ""
    ct = (r.headers.get("content-type") or "").lower()
    is_404 = r.status_code == 404
    is_html = "html" in ct
    is_bad_manifest = not text.lstrip().startswith("#EXTM3U")

    if is_404 or is_html or is_bad_manifest:
        # Re-intento: el token de la18hd pudo expirar → re-scrapeamos
        if not force:
            _resolve_cache.pop(slug, None)
            try:
                master = await get_stream_url(slug, db_stream_url=db_stream_url)
                r = await _client().get(master, headers=_hdr(master))
                text = r.text or ""
                ct = (r.headers.get("content-type") or "").lower()
                if r.status_code not in (200, 206) or "html" in ct or not text.lstrip().startswith("#EXTM3U"):
                    raise ValueError("still failing")
            except HTTPException:
                raise
            except Exception:
                _fail_cache[slug] = now
                raise HTTPException(status_code=503, detail="Canal no disponible (sin señal)")
        else:
            _fail_cache[slug] = now
            raise HTTPException(status_code=503, detail="Canal no disponible (sin señal)")

    base = master
    if _is_master_playlist(text):
        variant = _select_variant(text, master)
        if variant:
            try:
                rv = await _client().get(variant, headers=_hdr(variant))
                if rv.status_code not in (200, 206):
                    for _ in range(2):
                        await asyncio.sleep(0.5)
                        rv = await _client().get(variant, headers=_hdr(variant))
                        if rv.status_code in (200, 206):
                            break
                vt = rv.text or ""
                vct = (rv.headers.get("content-type") or "").lower()
                if "html" in vct or not vt.lstrip().startswith("#EXTM3U"):
                    raise ValueError("variant invalid")
                text, base = vt, variant
            except Exception:
                _fail_cache[slug] = now
                raise HTTPException(status_code=503, detail="Canal no disponible (variante inválida)")

    _resolve_cache[slug] = {"ts": now, "master": master}
    _fail_cache.pop(slug, None)
    return text, base


# ---------------------------------------------------------------------------
# Health: cuáles canales están realmente disponibles AHORA
# ---------------------------------------------------------------------------
_HEALTH_TTL = 60.0  # segundos — el upstream cambia disponibilidad cada minuto-ish
_health_cache: dict = {"ts": 0.0, "live": set()}
_health_lock = asyncio.Lock()  # single-flight: evita probes duplicados concurrentes


async def _probe_one(client: httpx.AsyncClient, slug: str, stream_url: str | None = None) -> tuple[str, bool]:
    """
    Probe real: intenta descargar el manifest .m3u8. No se fía del HTML
    (la18hd siempre devuelve una URL), valida contra la CDN real.
    """
    if stream_url and stream_url.lower().endswith(".m3u8"):
        try:
            r = await client.head(stream_url, timeout=8.0)
            return slug, r.status_code in (200, 206)
        except (httpx.HTTPError, asyncio.TimeoutError):
            return slug, False

    # Scrapeamos como get_stream_url para obtener la URL real del .m3u8
    try:
        master = await get_stream_url(slug, db_stream_url=stream_url)
        if not master:
            return slug, False
        r = await client.get(master, timeout=8.0)
        if r.status_code not in (200, 206):
            return slug, False
        # Validar que sea un manifest HLS de verdad, no HTML
        text = r.text or ""
        ct = (r.headers.get("content-type") or "").lower()
        if "html" in ct or not text.lstrip().startswith("#EXTM3U"):
            return slug, False
        return slug, True
    except Exception:
        return slug, False


async def _refresh_health(slugs: list[str], stream_url_map: dict[str, str] | None = None) -> set[str]:
    """Probe en paralelo con concurrency alta (deep probe ~7-10s para 100 canales)."""
    sem = asyncio.Semaphore(40)

    limits = httpx.Limits(max_connections=80, max_keepalive_connections=40)
    async with httpx.AsyncClient(
        headers=UPSTREAM_HEADERS, follow_redirects=True, limits=limits
    ) as client:
        async def task(slug: str):
            async with sem:
                su = stream_url_map.get(slug) if stream_url_map else None
                return await _probe_one(client, slug, stream_url=su)

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
    def _cached_response():
        age = time.time() - _health_cache["ts"]
        if age < _HEALTH_TTL and _health_cache["live"]:
            fail_now = time.time()
            filtered = {s for s in _health_cache["live"]
                        if s not in _fail_cache or fail_now - _fail_cache[s] >= _FAIL_TTL}
            if len(filtered) != len(_health_cache["live"]):
                _health_cache["live"] = filtered
                _health_cache["ts"] = time.time()
            return {
                "live": sorted(filtered),
                "total": len(filtered),
                "cached_age_s": round(age, 1),
                "source": _health_cache.get("source", "cache"),
            }
        return None

    cached = _cached_response()
    if cached:
        return cached

    # Single-flight: si varias requests llegan con el cache vencido, sólo una
    # hace el probe; las demás esperan el lock y reusan el resultado fresco.
    async with _health_lock:
        cached = _cached_response()
        if cached:
            return cached

        now = time.time()
        # 1. Fast path: status.json (un solo fetch)
        try:
            from app.services.scraper import fetch_status
            status_map = await fetch_status()  # {slug: is_live}
            live = {slug for slug, is_live in status_map.items() if is_live}

            # Filtrar canales que están en el fail cache (CDN devuelve 404)
            fail_now = time.time()
            live = {s for s in live if s not in _fail_cache or fail_now - _fail_cache[s] >= _FAIL_TTL}

            _health_cache["ts"] = now
            _health_cache["live"] = live
            _health_cache["source"] = "status.json"
            return {"live": sorted(live), "total": len(live), "cached_age_s": 0.0,
                    "source": "status.json"}
        except Exception as e:
            # 2. Fallback: deep probe (más lento)
            channels = crud_channels.get_channels(db, active_only=False)
            slugs = [c.slug for c in channels]
            stream_url_map = {c.slug: c.stream_url for c in channels if c.stream_url}
            live = await _refresh_health(slugs, stream_url_map=stream_url_map)
            _health_cache["ts"] = now
            _health_cache["live"] = live
            _health_cache["source"] = "deep-probe"
            return {"live": sorted(live), "total": len(live), "cached_age_s": 0.0,
                    "source": "deep-probe", "fallback_reason": str(e)}


# ---------------------------------------------------------------------------
# Endpoints HLS
# ---------------------------------------------------------------------------
@router.get("/{slug}")
async def get_stream(slug: str, db: Session = Depends(get_db)):
    """Devuelve la URL real (útil para debug). El frontend usa /playlist.m3u8."""
    ch = crud_channels.get_channel_by_slug(db, slug)
    db_url = ch.stream_url if ch else None
    url = await get_stream_url(slug, db_stream_url=db_url)
    return {"url": url, "channel": slug, "proxy_url": f"/api/streams/{slug}/playlist.m3u8"}


@router.get("/{slug}/playlist.m3u8")
async def proxy_playlist(slug: str, db: Session = Depends(get_db)):
    """Resuelve el slug, descarga el manifest, reescribe segmentos y lo devuelve.

    Validaciones para evitar el bug 'demuxer-error: could not parse' que
    aparece cuando el proxy entrega contenido que no es un m3u8 válido
    (típicamente HTML cuando el upstream se cayó):
      - Content-Type del upstream no debe ser text/html
      - El body debe empezar con #EXTM3U (signature obligatoria del HLS)
    """
    ch = crud_channels.get_channel_by_slug(db, slug)
    db_url = ch.stream_url if ch else None
    # Resolvemos con reintentos + aplanado master→variante. Si falla, forzamos
    # un re-scrape fresco de tvtvhd y reintentamos una vez más (cubre el caso de
    # token/URL vencidos durante la reproducción en vivo).
    try:
        text, base = await _resolve_media_playlist(slug, db_stream_url=db_url)
    except HTTPException as e:
        if e.status_code == 503:
            raise  # canal sin señal — no reintentar
        _resolve_cache.pop(slug, None)
        try:
            text, base = await _resolve_media_playlist(slug, force=True, db_stream_url=db_url)
        except HTTPException as e2:
            if e2.status_code == 503:
                raise
            # Si el reintento forzado da 502 igual, cacheamos como offline
            _fail_cache[slug] = time.time()
            raise HTTPException(status_code=503, detail="Canal no disponible (sin señal)")

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

    # GET (cliente compartido, keep-alive) con reintentos: un blip transitorio
    # del upstream (5xx/timeout) no debe cortar la reproducción. Buffereamos el
    # segmento (uno a la vez en RAM, intrascendente en desktop) — más simple y
    # robusto que streamear, y consistente con el proxy nativo de Android.
    head = None
    last_status = None
    for attempt in range(3):
        try:
            head = await _client().get(u, headers=_hdr(u, forward_headers))
            last_status = head.status_code
            if head.status_code in (200, 206):
                break
            if head.status_code < 500 and head.status_code != 429:
                break  # 4xx definitivo, no reintentar
        except httpx.HTTPError:
            head = None
        await asyncio.sleep(0.3 * (attempt + 1))

    if head is None or head.status_code not in (200, 206):
        raise HTTPException(status_code=502, detail=f"Upstream HTTP {last_status} para segmento")
    ct = head.headers.get("content-type", "")

    # Sub-manifest .m3u8 → reescribir como el playlist principal.
    if _is_manifest(ct, u):
        text = head.text
        if "html" in ct.lower() or not text.lstrip().startswith("#EXTM3U"):
            raise HTTPException(status_code=502, detail="Sub-manifest inválido: el upstream no devolvió HLS")
        rewritten = _rewrite_manifest(text, base=u, slug=slug)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
        )

    # Binario (segmento .ts/mp4/aac/m4s/CMAF/cifrado/...). Solo descartamos lo
    # OBVIAMENTE roto: Content-Type=html o un "not found" chiquito disfrazado.
    if "html" in ct.lower():
        raise HTTPException(status_code=502, detail="Segmento inválido: el upstream devolvió HTML")
    body = head.content
    if len(body) < 32:
        preview = body.decode("ascii", errors="ignore").strip().lower()
        if preview in ("not found", "404", "404 not found", "forbidden", "unauthorized"):
            raise HTTPException(status_code=502, detail=f"Segmento inválido: upstream respondió '{preview}'")

    resp_headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=10",
    }
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
