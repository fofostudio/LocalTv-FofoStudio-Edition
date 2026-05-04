"""
Scraper de canales de tvtvhd.com en Python puro.

Antes (v1) parseaba el HTML de la home con regex. tvtvhd cambió: ahora la
home es una shell vacía y el contenido se inyecta vía JS desde
`https://tvtvhd.com/status.json`. Ese JSON ya contiene la lista oficial de
canales agrupados por región y el estado actual de cada uno
("Activo"/"Inactivo"). Mucho más confiable y rápido que hacer probes
paralelos a 100 streams.

Estructura de status.json:
{
  "LATINOAMERICA": [
    {"Canal": "ESPN", "Estado": "Activo",
     "Link": "https://tvtvhd.com/vivo/canales.php?stream=espn"},
    ...
  ],
  "ARGENTINA": [...],
  "MEXICO": [...],
  ...
}

Devuelve lista de ScrapedChannel: {name, slug, stream_param, stream_url,
region, is_live}.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.models.channel import Channel
from app.models.category import Category


STATUS_URL = "https://tvtvhd.com/status.json"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/javascript,*/*;q=0.9",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": "https://tvtvhd.com/",
}


@dataclass
class ScrapedChannel:
    name: str
    slug: str
    stream_param: str
    stream_url: str
    region: str
    is_live: bool


def _slugify(text: str) -> str:
    """Convierte un nombre a slug ASCII seguro."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "canal"


def _parse_link(link: str) -> str | None:
    """Extrae el ?stream=XXX de la URL del canal en tvtvhd."""
    m = re.search(r"stream=([^&\s\"']+)", link or "")
    return m.group(1).strip() if m else None


def _normalize_status(payload: dict) -> list[ScrapedChannel]:
    """De la estructura región->lista, sacamos canales únicos por slug."""
    seen: dict[str, ScrapedChannel] = {}
    for region, items in (payload or {}).items():
        if not isinstance(items, list):
            continue
        for entry in items:
            if not isinstance(entry, dict):
                continue
            name = (entry.get("Canal") or "").strip()
            estado = (entry.get("Estado") or "").strip().lower()
            link = entry.get("Link") or ""
            stream_param = _parse_link(link)
            if not name or not stream_param:
                continue
            slug = _slugify(name)
            if slug in seen:
                # Si ya está, preferimos el que esté Activo
                if estado == "activo" and not seen[slug].is_live:
                    seen[slug].is_live = True
                continue
            seen[slug] = ScrapedChannel(
                name=name,
                slug=slug,
                stream_param=stream_param,
                stream_url=f"https://tvtvhd.com/vivo/canales.php?stream={stream_param}",
                region=region,
                is_live=(estado == "activo"),
            )
    return list(seen.values())


async def fetch_channels() -> list[ScrapedChannel]:
    """Descarga status.json y devuelve los canales únicos encontrados."""
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=15.0, follow_redirects=True
    ) as client:
        r = await client.get(STATUS_URL)
        r.raise_for_status()
        return _normalize_status(r.json())


async def fetch_status() -> dict[str, bool]:
    """Devuelve {slug: is_live} para health-check rápido (un solo fetch)."""
    chans = await fetch_channels()
    return {c.slug: c.is_live for c in chans}


def upsert_channels(
    db: Session,
    scraped: list[ScrapedChannel],
    default_category_slug: str = "deportes",
) -> dict:
    """
    Inserta canales nuevos y actualiza la stream_url de los existentes.
    No borra canales que ya estén en la BD pero no aparezcan en el scrape
    (por si el sitio devuelve subset distinto).
    """
    category = db.query(Category).filter(Category.slug == default_category_slug).first()
    if not category:
        category = Category(name="Deportes", slug=default_category_slug, icon="fa-futbol")
        db.add(category)
        db.flush()

    created = 0
    updated = 0
    for ch in scraped:
        existing = db.query(Channel).filter(Channel.slug == ch.slug).first()
        if existing:
            if existing.stream_url != ch.stream_url:
                existing.stream_url = ch.stream_url
                updated += 1
        else:
            db.add(
                Channel(
                    name=ch.name,
                    slug=ch.slug,
                    stream_url=ch.stream_url,
                    category_id=category.id,
                    is_active=True,
                )
            )
            created += 1

    db.commit()
    return {"created": created, "updated": updated, "total_scraped": len(scraped)}
