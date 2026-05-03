"""
Scraper de canales de tvtvhd.com en Python puro.
Reemplaza los scripts Node/Playwright originales: usa httpx para descargar el
HTML y regex para extraer los parámetros `stream=` (no requiere JS — los enlaces
están renderizados en el HTML inicial del sitio).

Devuelve una lista de dicts: {name, slug, stream_param, stream_url}.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.models.channel import Channel
from app.models.category import Category


SOURCE_URL = "https://tvtvhd.com/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}


@dataclass
class ScrapedChannel:
    name: str
    slug: str
    stream_param: str
    stream_url: str


def _slugify(text: str) -> str:
    """Convierte un nombre a slug ASCII seguro."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "canal"


def _extract_channels(html: str) -> list[ScrapedChannel]:
    """Extrae canales del HTML buscando enlaces con `stream=` y su nombre asociado."""
    # Patrones flexibles: links <a href="...stream=XXX..."> y onclick handlers
    # capturamos también el contexto previo (~200 chars) para sacar el nombre.
    pattern = re.compile(
        r'(?:<a[^>]+href|onclick)\s*=\s*["\'][^"\']*?stream=([^"\'&)]+)[^"\']*?["\']'
        r'[^>]*>(?P<inner>[\s\S]{0,200}?)</a>',
        re.IGNORECASE,
    )

    seen: dict[str, ScrapedChannel] = {}
    for match in pattern.finditer(html):
        stream_param = match.group(1).strip()
        inner = match.group("inner")
        # Limpiar etiquetas HTML del nombre
        name = re.sub(r"<[^>]+>", " ", inner)
        name = re.sub(r"\s+", " ", name).strip()
        # Filtrar nombres-basura
        if not name or len(name) < 2 or len(name) > 80:
            continue
        if re.match(r"^(Activo|Inactivo|Link|Ver)\b", name, re.IGNORECASE):
            continue

        slug = _slugify(name)
        # Usar slug como clave de deduplicación (priorizar la primera ocurrencia)
        if slug in seen:
            continue
        seen[slug] = ScrapedChannel(
            name=name,
            slug=slug,
            stream_param=stream_param,
            stream_url=f"https://tvtvhd.com/vivo/canales.php?stream={stream_param}",
        )

    return list(seen.values())


async def fetch_channels() -> list[ScrapedChannel]:
    """Descarga la home de tvtvhd.com y devuelve los canales encontrados."""
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=30.0, follow_redirects=True
    ) as client:
        response = await client.get(SOURCE_URL)
        response.raise_for_status()
        return _extract_channels(response.text)


def upsert_channels(
    db: Session,
    scraped: list[ScrapedChannel],
    default_category_slug: str = "deportes",
) -> dict:
    """
    Inserta canales nuevos y actualiza la stream_url de los existentes.
    No borra canales que ya estén en la BD pero no aparezcan en el scrape
    (por si el sitio devuelve subset distinto).

    Devuelve: {created, updated, total_scraped}.
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
