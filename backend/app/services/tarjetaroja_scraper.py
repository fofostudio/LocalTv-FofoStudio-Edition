"""
Scraper de agenda deportiva y canales de tarjetarojatvhd.es.

Fuente de agenda deportiva en vivo (reemplaza a pltvhd.com, confiscado junto
con tvtvhd en julio 2026). Los canales son embeds iframe — no HLS directo.
La cadena de reproducción es:
  tarjetarojatvhd.es/embed/eventos.html?r=<base64>
    → footunder.online/tvtodo/*.php
      → footunder.online/nplayer/{prefix}/{id}
        → dog.tilinhd.lol/playstream.php?id={token}
          → Clappr + SwarmCloud P2P HLS

Los canales importados llevan prefijo ``embed:`` en su stream_url para que
el frontend los reproduzca en un iframe en vez de por proxy HLS.
"""
from __future__ import annotations

import base64
import re
import unicodedata
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy.orm import Session

from app.models.channel import Channel
from app.models.category import Category


AGENDA_URL = "https://tarjetarojatvhd.es/agendarojatx.json"
EMBED_BASE = "https://tarjetarojatvhd.es"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*;q=0.9",
    "Referer": "https://tarjetarojatvhd.es/",
}


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "canal"


async def fetch_agenda() -> dict:
    """Descarga la agenda JSON de tarjetarojatvhd.es. Devuelve ``{"data": []}`` si falla."""
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=10.0, follow_redirects=True) as client:
            r = await client.get(AGENDA_URL)
            if r.status_code != 200:
                return {"data": []}
            data = r.json()
            if not isinstance(data, dict):
                return {"data": []}
            return data
    except Exception:
        return {"data": []}


def decode_embed_url(embed_iframe: str) -> str:
    """Decodifica el parámetro ``r`` (base64) de una URL de embed."""
    try:
        parsed = urlparse(embed_iframe)
        qs = parse_qs(parsed.query)
        r_param = qs.get("r", [None])[0]
        if not r_param:
            return embed_iframe
        padded = r_param + "=" * (-len(r_param) % 4)
        return base64.b64decode(padded).decode("utf-8")
    except Exception:
        return embed_iframe


def resolve_stream_url(embed_iframe: str) -> str:
    """Convierte una ruta relativa de embed en URL absoluta."""
    if not embed_iframe:
        return ""
    if embed_iframe.startswith("http://") or embed_iframe.startswith("https://"):
        return embed_iframe
    return f"{EMBED_BASE}{embed_iframe}"


def extract_channels(agenda: dict) -> list[dict]:
    """Extrae canales únicos de la agenda. Devuelve lista de dicts con
    name, slug, embed_url, decoded_url."""
    seen: dict[str, dict] = {}
    for item in agenda.get("data", []):
        attrs = item.get("attributes") or {}
        embeds = (attrs.get("embeds") or {}).get("data") or []
        for embed in embeds:
            ea = (embed.get("attributes") or {})
            name = (ea.get("embed_name") or "").strip()
            iframe = ea.get("embed_iframe") or ""
            if not name or not iframe:
                continue
            slug = _slugify(name)
            if slug in seen:
                continue
            seen[slug] = {
                "name": name,
                "slug": slug,
                "embed_url": resolve_stream_url(iframe),
                "decoded_url": decode_embed_url(iframe),
            }
    return list(seen.values())


def import_channels(
    db: Session,
    channels: list[dict],
    provider: str = "TarjetaRoja",
) -> dict:
    """Importa canales TarjetaRoja a la BD con prefijo ``embed:`` en stream_url."""
    category = db.query(Category).filter(Category.slug == "deportes").first()
    if not category:
        category = Category(name="Deportes", slug="deportes", icon="fa-futbol")
        db.add(category)
        db.flush()

    created = 0
    updated = 0
    for ch in channels:
        stream_url = f"embed:{ch['embed_url']}"
        existing = db.query(Channel).filter(Channel.slug == ch["slug"]).first()
        if existing:
            if existing.stream_url != stream_url:
                existing.stream_url = stream_url
                existing.region = provider
                updated += 1
        else:
            db.add(Channel(
                name=ch["name"],
                slug=ch["slug"],
                stream_url=stream_url,
                category_id=category.id,
                region=provider,
                is_active=True,
            ))
            created += 1

    db.commit()
    return {"created": created, "updated": updated, "total": len(channels)}
