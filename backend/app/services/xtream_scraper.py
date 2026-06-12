"""Cliente Xtream Codes genérico (compatible con Magma Player y cualquier panel Xtream).

Protocolo Xtream estándar:
    Lista:   {host}/player_api.php?username={u}&password={p}&action=get_live_streams
    Stream:  {host}/live/{u}/{p}/{stream_id}.{ext}    (ext = ts | m3u8)

Las credenciales NO se hornean en el repo: se leen de variables de entorno
(XTREAM_HOST / XTREAM_USERNAME / XTREAM_PASSWORD). Cada quien pone las suyas,
igual que cualquier reproductor IPTV.

Además del modo "en vivo" (consulta el panel con tus credenciales), soporta un
modo "catálogo offline" que lee un dump local (backend/playlists/magma/*.json|csv)
con los nombres+IDs de canales. Si hay credenciales configuradas, el catálogo se
vuelve reproducible al construir las URLs; si no, se importa como catálogo inactivo.
"""
from __future__ import annotations

import asyncio
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.channel import Channel
from app.services.iptv_scraper import (
    _ensure_category,
    _is_likely_spanish,
    _slugify,
    _unique_slug,
)


def _dump_dir() -> Path:
    """Directorio con los dumps de catálogo Magma.

    En el .exe/.app empaquetado (PyInstaller) los datos viven bajo `_MEIPASS`
    en `playlists/magma`; en el repo, en `backend/playlists/magma`. Probamos
    ambos para que el catálogo Magma cargue en las dos modalidades.
    """
    base = getattr(sys, "_MEIPASS", None)
    if base:
        bundled = Path(base) / "playlists" / "magma"
        if bundled.exists():
            return bundled
    return Path(__file__).resolve().parent.parent.parent / "playlists" / "magma"


# Directorio donde viven los dumps de catálogo Magma (sobreviven al empaquetado .exe)
DUMP_DIR = _dump_dir()

# Marcadores de feeds claramente NO hispanos dentro de un panel hispano.
# El catálogo Magma/TVClub es un servicio LatAm, así que importamos casi todo
# y solo descartamos lo explícitamente extranjero.
_FOREIGN_MARKERS = (
    " en |", "[en]", "(en)", " english", "ingles", " uk |", " usa |", " us |",
    " brasil", "brazil", "portugu", " pt |", "[pt]", " fr |", "[fr]", " french",
    " ita ", " italia", " deutsch", " german", " arab", " turkish", " 4k uhd en",
)


# User-Agent que exige el backend Magma (reverseado del APK: hostSelectionInterceptor).
MAGMA_UA = "Magma Player/10"


@dataclass
class XtreamChannel:
    name: str
    stream_id: int
    category_id: Optional[str] = None
    logo_url: Optional[str] = None
    stream_url: Optional[str] = None  # URL directa si el panel la entrega (Magma: url/direct_source)
    category_name: Optional[str] = None  # nombre real de la categoría del panel


# --------------------------------------------------------------------------- #
# Configuración (credenciales del usuario, vía entorno)
# --------------------------------------------------------------------------- #
def _cfg() -> dict:
    host = (settings.XTREAM_HOST or "").strip().rstrip("/")
    if host and not host.startswith(("http://", "https://")):
        host = "http://" + host
    return {
        "host": host,
        "username": (settings.XTREAM_USERNAME or "").strip(),
        "password": (settings.XTREAM_PASSWORD or "").strip(),
        "output": (settings.XTREAM_OUTPUT or "ts").strip().lstrip("."),
        "token": (settings.XTREAM_TOKEN or "").strip(),
    }


def is_configured() -> bool:
    c = _cfg()
    return bool(c["host"] and c["username"] and c["password"])


def build_stream_url(stream_id: int) -> Optional[str]:
    """Construye la URL reproducible de un canal en vivo.

    Magma/TVClub: si hay token, usa el patrón real reverseado por captura ADB
    `{host}/stream/secure/{token}/{id}.m3u8` (resuelve TODO el catálogo).
    Si no, cae al patrón Xtream estándar `{host}/live/{user}/{pass}/{id}.{ext}`.
    """
    c = _cfg()
    if not c["host"]:
        return None
    if c["token"]:
        return f"{c['host']}/stream/secure/{c['token']}/{stream_id}.m3u8"
    if not (c["username"] and c["password"]):
        return None
    return f"{c['host']}/live/{c['username']}/{c['password']}/{stream_id}.{c['output']}"


# --------------------------------------------------------------------------- #
# Modo EN VIVO: consulta el panel Xtream con las credenciales del usuario
# --------------------------------------------------------------------------- #
async def fetch_live_streams() -> list[XtreamChannel]:
    """Obtiene los canales en vivo siguiendo el protocolo Magma reverseado.

    1. Intenta el endpoint propio `GET {host}/channels?username=&password=`
       (devuelve el path del stream en `license`; URL = host + path).
    2. Si no existe (404), cae al estándar `player_api.php&action=get_live_streams`,
       leyendo `url`/`direct_source` como URL HLS directa cuando viene poblada.
    """
    c = _cfg()
    if not (c["host"] and c["username"] and c["password"]):
        raise RuntimeError(
            "Faltan credenciales Xtream. Define XTREAM_HOST, XTREAM_USERNAME y "
            "XTREAM_PASSWORD en el .env del backend."
        )
    headers = {"User-Agent": MAGMA_UA}
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
        # Categorías reales del panel (id -> nombre) para clasificar bien.
        catmap: dict[str, str] = {}
        try:
            rc = await client.get(
                f"{c['host']}/player_api.php",
                params={"username": c["username"], "password": c["password"], "action": "get_live_categories"},
            )
            if rc.status_code == 200:
                for cat in rc.json():
                    cid = cat.get("category_id")
                    if cid is not None:
                        catmap[str(cid)] = (cat.get("category_name") or "").strip()
        except Exception:
            pass

        # (1) endpoint propio Magma
        try:
            r = await client.get(
                f"{c['host']}/channels",
                params={"username": c["username"], "password": c["password"]},
            )
            if r.status_code == 200 and "application/json" in r.headers.get("content-type", ""):
                data = r.json()
                items = data.get("channels") or data.get("data") or data if isinstance(data, dict) else data
                if isinstance(items, list) and items:
                    out = _parse_magma_channels(items, c["host"], catmap)
                    if out:
                        return out
        except Exception:
            pass

        # (2) fallback Xtream player_api.php
        r = await client.get(
            f"{c['host']}/player_api.php",
            params={"username": c["username"], "password": c["password"], "action": "get_live_streams"},
        )
        r.raise_for_status()
        data = r.json()
    return _parse_magma_channels(data, c["host"], catmap)


def _parse_magma_channels(data: list, host: str, catmap: Optional[dict] = None) -> list[XtreamChannel]:
    catmap = catmap or {}
    out: list[XtreamChannel] = []
    for item in data:
        sid = item.get("stream_id") if item.get("stream_id") is not None else item.get("id")
        name = (item.get("name") or "").strip()
        if sid is None or not name:
            continue
        # URL directa: Magma la pone en url/direct_source; o `license` como path relativo.
        raw = (item.get("url") or item.get("direct_source") or "").strip()
        lic = item.get("license")
        if not raw and isinstance(lic, str) and lic.strip():
            raw = lic.strip()
        stream_url = None
        if raw:
            stream_url = raw if raw.startswith("http") else f"{host}{raw if raw.startswith('/') else '/' + raw}"
        cid = item.get("category_id")
        cid = item.get("category") if cid is None else cid
        cid = str(cid) if cid is not None else None
        out.append(
            XtreamChannel(
                name=name,
                stream_id=int(sid),
                category_id=cid,
                logo_url=item.get("stream_icon") or item.get("img") or None,
                stream_url=stream_url,
                category_name=catmap.get(cid) if cid else None,
            )
        )
    return out


# --------------------------------------------------------------------------- #
# Modo CATÁLOGO OFFLINE: lee el dump local (Magma / TVClub)
# --------------------------------------------------------------------------- #
def load_catalog_dump() -> list[XtreamChannel]:
    """Lee xtream_live.json (con logos) o xtream_channels.csv como respaldo."""
    json_path = DUMP_DIR / "xtream_live.json"
    csv_path = DUMP_DIR / "xtream_channels.csv"

    if json_path.exists():
        raw = json_path.read_text(encoding="utf-8-sig", errors="replace")
        data = json.loads(raw)
        out: list[XtreamChannel] = []
        for item in data:
            sid = item.get("stream_id")
            name = (item.get("name") or "").strip()
            if sid is None or not name:
                continue
            out.append(
                XtreamChannel(
                    name=name,
                    stream_id=int(sid),
                    category_id=str(item.get("category_id")) if item.get("category_id") is not None else None,
                    logo_url=item.get("stream_icon") or None,
                )
            )
        if out:
            return out

    if csv_path.exists():
        out = []
        with csv_path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                name = (row.get("name") or "").strip()
                sid = row.get("stream_id")
                if not name or not sid:
                    continue
                out.append(
                    XtreamChannel(
                        name=name,
                        stream_id=int(sid),
                        category_id=(row.get("category_id") or "").strip() or None,
                    )
                )
        return out

    return []


# --------------------------------------------------------------------------- #
# Filtro de idioma
# --------------------------------------------------------------------------- #
def _ensure_named_category(db: Session, slug: str, display_name: str):
    """Como _ensure_category pero conserva el nombre real del panel (ej. 'Mas vistos')."""
    from app.models.category import Category
    cat = db.query(Category).filter(Category.slug == slug).first()
    if cat:
        return cat
    cat = Category(name=display_name.strip() or slug, slug=slug)
    db.add(cat)
    db.flush()
    return cat


def _is_spanish_channel(name: str, strict: bool) -> bool:
    low = f" {name.lower()} "
    if any(m in low for m in _FOREIGN_MARKERS):
        return False
    if strict:
        return _is_likely_spanish(name, None)
    # Modo laxo: el panel completo es hispano (LatAm), conservamos salvo lo extranjero.
    return True


# --------------------------------------------------------------------------- #
# Importación a la BD
# --------------------------------------------------------------------------- #
async def verify_and_prune(
    db: Session,
    provider: Optional[str] = None,
    timeout: float = 8.0,
    concurrency: int = 40,
) -> dict:
    """Prueba las URLs de los canales y deja activos solo los que reproducen.

    - `provider`: si se pasa (p.ej. "Magma"), solo verifica esa región; si no, todos.
    - Un canal se considera vivo si su URL responde 200/206 y, para .m3u8,
      el cuerpo es un manifiesto HLS real (#EXTM3U). Los placeholder `xtream://`
      o sin URL http se marcan inactivos.
    - Actualiza is_active en la BD. No borra (reversible al reimportar/reverificar).
    """
    q = db.query(Channel)
    if provider:
        q = q.filter(Channel.region == provider)
    channels = q.all()

    sem = asyncio.Semaphore(concurrency)
    headers = {"User-Agent": MAGMA_UA}

    async def _probe(client: httpx.AsyncClient, url: str) -> bool:
        if not url or not url.startswith("http"):
            return False
        try:
            async with sem:
                if url.lower().split("?")[0].endswith(".m3u8"):
                    r = await client.get(url, timeout=timeout, headers=headers)
                    if r.status_code not in (200, 206):
                        return False
                    body = (r.text or "").lstrip()
                    ct = (r.headers.get("content-type") or "").lower()
                    if "html" in ct:
                        return False
                    return body.startswith("#EXTM3U") or "mpegurl" in ct
                r = await client.head(url, timeout=timeout, headers=headers, follow_redirects=True)
                if r.status_code in (405, 501):  # HEAD no soportado → GET corto
                    r = await client.get(url, timeout=timeout, headers=headers)
                return r.status_code in (200, 206)
        except Exception:
            return False

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout, connect=6.0),
        follow_redirects=True,
        limits=httpx.Limits(max_connections=80, max_keepalive_connections=40),
        verify=False,
    ) as client:
        results = await asyncio.gather(*[_probe(client, c.stream_url) for c in channels])

    alive = 0
    dead = 0
    changed = 0
    for ch, ok in zip(channels, results):
        if ok:
            alive += 1
        else:
            dead += 1
        if ch.is_active != ok:
            ch.is_active = ok
            changed += 1
    db.commit()
    return {
        "provider": provider or "all",
        "checked": len(channels),
        "alive": alive,
        "dead": dead,
        "changed": changed,
    }


def prune_inactive(db: Session, provider: Optional[str] = None) -> dict:
    """Borra de la BD los canales inactivos (muertos). Si `provider`, solo esa región."""
    q = db.query(Channel).filter(Channel.is_active == False)  # noqa: E712
    if provider:
        q = q.filter(Channel.region == provider)
    n = q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": n, "provider": provider or "all"}


def import_xtream(
    db: Session,
    channels: list[XtreamChannel],
    provider: str = "Magma",
    category_slug: str = "general",
    strict_spanish: bool = False,
) -> dict:
    """Importa canales Xtream a la BD.

    - Filtra a solo español (laxo por defecto: el panel ya es hispano).
    - region = provider (p.ej. "Magma") para poder distinguirlos en el front.
    - is_active = True solo si pudimos construir una URL reproducible (hay credenciales).
    - Idempotente por slug: no duplica.
    """
    created = 0
    updated = 0
    skipped = 0
    not_spanish = 0
    inactive = 0
    seen_slugs: set = set()

    default_cat = _ensure_category(db, category_slug)
    if not default_cat:
        return {"error": "no_category"}
    cat_cache: dict = {}

    for ch in channels:
        if not _is_spanish_channel(ch.name, strict_spanish):
            not_spanish += 1
            skipped += 1
            continue

        # Categoría real del panel si la tenemos; si no, la default.
        cat = default_cat
        if ch.category_name:
            cslug = _slugify(ch.category_name)
            if cslug not in cat_cache:
                cat_cache[cslug] = _ensure_named_category(db, cslug, ch.category_name) or default_cat
            cat = cat_cache[cslug]

        # Con token Magma → siempre la URL segura del panel (CDN propio, estable).
        # Sin token → URL directa del campo url/direct_source, o patrón estándar.
        if _cfg().get("token"):
            url = build_stream_url(ch.stream_id)
        else:
            url = ch.stream_url or build_stream_url(ch.stream_id)
        active = bool(url)
        if not active:
            inactive += 1
            # placeholder estable; se reactiva al reimportar con credenciales/URL
            url = f"xtream://{provider.lower()}/{ch.stream_id}"

        base_slug = _slugify(f"{provider}-{ch.name}")

        existing = (
            db.query(Channel)
            .filter(Channel.region == provider, Channel.name == ch.name)
            .first()
        )
        if existing:
            existing.stream_url = url
            existing.is_active = active
            existing.category_id = cat.id
            if ch.logo_url:
                existing.logo_url = ch.logo_url
            updated += 1
            continue

        slug = _unique_slug(db, base_slug, seen_slugs)
        db.add(
            Channel(
                name=ch.name,
                slug=slug,
                stream_url=url,
                logo_url=ch.logo_url,
                category_id=cat.id,
                is_active=active,
                region=provider,
            )
        )
        created += 1

    db.commit()
    return {
        "provider": provider,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "not_spanish": not_spanish,
        "inactive": inactive,
        "configured": is_configured(),
        "total": len(channels),
    }
