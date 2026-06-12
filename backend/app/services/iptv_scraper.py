from __future__ import annotations

import asyncio
import os
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.channel import Channel
from app.models.category import Category

IPTV_BASE = "https://iptv-org.github.io/iptv"

# Fuentes alternativas de canales hispanos
FREE_TV_SPAIN_URL = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_spain.m3u8"
TDT_CHANNELS_URL = "https://raw.githubusercontent.com/LaQuay/TDTChannels/master/TELEVISION.md"
TV_COLOMBIA_URL = "https://raw.githubusercontent.com/iemejia/streamingcolombia/master/tvcolombia-static.m3u"

# Local playlists (community-contributed)
LOCAL_PLAYLIST_DIR = str(Path(__file__).resolve().parent.parent.parent / "playlists")

# iptv-org country playlists (co = Colombia, es = España, mx = México, etc.)
IPTV_COUNTRY_URL = f"{IPTV_BASE}/countries/{{code}}.m3u"
SPANISH_COUNTRY_CODES = {
    "ar": "argentina",
    "bo": "bolivia",
    "cl": "chile",
    "co": "colombia",
    "cr": "costa-rica",
    "cu": "cuba",
    "do": "republica-dominicana",
    "ec": "ecuador",
    "sv": "el-salvador",
    "es": "espana",
    "gt": "guatemala",
    "hn": "honduras",
    "mx": "mexico",
    "ni": "nicaragua",
    "pa": "panama",
    "py": "paraguay",
    "pe": "peru",
    "pr": "puerto-rico",
    "uy": "uruguay",
    "ve": "venezuela",
}

CATEGORY_PLAYLISTS = {
    "animation": f"{IPTV_BASE}/categories/animation.m3u",
    "auto": f"{IPTV_BASE}/categories/auto.m3u",
    "business": f"{IPTV_BASE}/categories/business.m3u",
    "classic": f"{IPTV_BASE}/categories/classic.m3u",
    "comedy": f"{IPTV_BASE}/categories/comedy.m3u",
    "cooking": f"{IPTV_BASE}/categories/cooking.m3u",
    "culture": f"{IPTV_BASE}/categories/culture.m3u",
    "deportes": f"{IPTV_BASE}/categories/sports.m3u",
    "documentales": f"{IPTV_BASE}/categories/documentary.m3u",
    "educativo": f"{IPTV_BASE}/categories/education.m3u",
    "entretenimiento": f"{IPTV_BASE}/categories/entertainment.m3u",
    "family": f"{IPTV_BASE}/categories/family.m3u",
    "general": f"{IPTV_BASE}/categories/general.m3u",
    "infantil": f"{IPTV_BASE}/categories/kids.m3u",
    "interactive": f"{IPTV_BASE}/categories/interactive.m3u",
    "legislative": f"{IPTV_BASE}/categories/legislative.m3u",
    "lifestyle": f"{IPTV_BASE}/categories/lifestyle.m3u",
    "musica": f"{IPTV_BASE}/categories/music.m3u",
    "noticias": f"{IPTV_BASE}/categories/news.m3u",
    "outdoor": f"{IPTV_BASE}/categories/outdoor.m3u",
    "peliculas": f"{IPTV_BASE}/categories/movies.m3u",
    "public": f"{IPTV_BASE}/categories/public.m3u",
    "undefined": f"{IPTV_BASE}/categories/undefined.m3u",
    "relax": f"{IPTV_BASE}/categories/relax.m3u",
    "religious": f"{IPTV_BASE}/categories/religious.m3u",
    "science": f"{IPTV_BASE}/categories/science.m3u",
    "series": f"{IPTV_BASE}/categories/series.m3u",
    "shop": f"{IPTV_BASE}/categories/shop.m3u",
    "sports": f"{IPTV_BASE}/categories/sports.m3u",
    "travel": f"{IPTV_BASE}/categories/travel.m3u",
    "weather": f"{IPTV_BASE}/categories/weather.m3u",
}

IPTV_CATEGORY_LABELS = {
    "animation": "Animation",
    "auto": "Auto",
    "business": "Business",
    "classic": "Classic",
    "comedy": "Comedy",
    "cooking": "Cooking",
    "culture": "Culture",
    "deportes": "Sports",
    "documentales": "Documentary",
    "educativo": "Education",
    "entretenimiento": "Entertainment",
    "family": "Family",
    "general": "General",
    "infantil": "Kids",
    "interactive": "Interactive",
    "legislative": "Legislative",
    "lifestyle": "Lifestyle",
    "musica": "Music",
    "noticias": "News",
    "outdoor": "Outdoor",
    "peliculas": "Movies",
    "public": "Public",
    "undefined": "Undefined",
    "relax": "Relax",
    "religious": "Religious",
    "science": "Science",
    "series": "Series",
    "shop": "Shop",
    "sports": "Sports",
    "travel": "Travel",
    "weather": "Weather",
}

# Mapeo de slugs en inglés de iptv-org a slugs en español de la BD local
CATEGORY_SLUG_MAP = {
    "animation": "infantil",
    "auto": "general",
    "business": "educativo",
    "classic": "general",
    "comedy": "entretenimiento",
    "cooking": "general",
    "culture": "documentales",
    "deportes": "deportes",
    "documentary": "documentales",
    "documentales": "documentales",
    "education": "educativo",
    "educativo": "educativo",
    "entertainment": "entretenimiento",
    "entretenimiento": "entretenimiento",
    "family": "general",
    "general": "general",
    "infantil": "infantil",
    "interactive": "general",
    "kids": "infantil",
    "legislative": "noticias",
    "lifestyle": "general",
    "movies": "peliculas",
    "musica": "musica",
    "music": "musica",
    "news": "noticias",
    "noticias": "noticias",
    "outdoor": "general",
    "peliculas": "peliculas",
    "public": "general",
    "undefined": "general",
    "relax": "musica",
    "religious": "general",
    "science": "documentales",
    "series": "series",
    "shop": "general",
    "sports": "deportes",
    "travel": "documentales",
    "weather": "noticias",
}


@dataclass
class IptvChannel:
    name: str
    slug: str
    stream_url: str
    logo_url: Optional[str] = None
    tvg_id: Optional[str] = None
    group: Optional[str] = None
    language: Optional[str] = None
    iptv_category: str = "general"
    category_slug: str = "general"


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "canal"


def _is_likely_spanish(name: str, group: str | None = None) -> bool:
    """Clasifica un canal como de habla hispana usando matching exacto de palabras.
    
    NO usa substring matching (el anterior `net in slug` causaba falsos
    positivos: ej. "latvia-tv" coincidía con "atv"). Solo compara
    palabras completas separadas por guiones.
    """
    slug = _slugify(name)
    words = set(slug.split("-"))
    score = 0

    # --- NEGATIVE SIGNALS: rechazo inmediato si menciona otro idioma ---
    NON_SPANISH = frozenset({
        "english", "arabic", "russian", "french", "german",
        "portuguese", "japanese", "korean", "chinese",
        "turkish", "hindi", "italian", "polish", "dutch",
        "swedish", "norwegian", "danish", "finnish",
        "greek", "hebrew", "thai", "vietnamese",
        "quran", "islam", "islamic", "muslim",
        "makkah", "mecca", "medina", "allah",
    })
    if words & NON_SPANISH:
        return False

    # --- POSITIVE SIGNALS ---

    # 1. Explicit Spanish mention
    if words & {"espanol", "espanola", "spanish", "espanoles"}:
        score += 12

    # 2. Spanish-speaking countries / nationalities (exact word match)
    COUNTRY_WORDS = frozenset({
        "argentina", "argentino", "bolivia", "boliviano",
        "chile", "chileno", "colombia", "colombiano",
        "cuba", "cubano", "dominicana", "dominicano",
        "ecuador", "ecuatoriano", "espana",
        "guatemala", "honduras", "hondureno",
        "mexico", "mexicano", "mexicana",
        "nicaragua", "panama", "panameno",
        "paraguay", "paraguayo", "peru", "peruano",
        "uruguay", "uruguayo",
        "venezuela", "venezolano",
        "latino", "latina", "hispano", "hispana",
    })
    if words & COUNTRY_WORDS:
        score += 8
    # Multi-word countries: "puerto" + "rico"
    if "puerto" in words and "rico" in words:
        score += 8
    if "costa" in words and "rica" in words:
        score += 8
    if "republica" in words and "dominicana" in words:
        score += 8
    if "el" in words and "salvador" in words:
        score += 8

    # 3. Known Spanish TV networks (exact WORD match only!)
    NETWORK_WORDS = frozenset({
        "telemundo", "univision", "unimas", "galavision",
        "azteca", "milenio", "multimedios",
        "telefe", "eltrece", "caracol", "rcn",
        "telepacifico", "teleantioquia", "televisa",
        "mega", "chilevision",
        "panamericana", "atv", "willax", "televen",
        "venevision", "globovision", "tves", "citytv",
        "hispano", "hisports", "tyc", "goltv", "golperu",
        "tudn", "telecinco", "cuatro", "sexta", "antena",
        "tdp", "tve", "trece",
    })
    if words & NETWORK_WORDS:
        score += 10
    # Multi-word networks: check if ALL words appear
    MULTI_NETWORKS = [
        {"win", "sports"}, {"fox", "sports"}, {"tnt", "sports"},
        {"america", "tv"}, {"imagen", "tv"}, {"canal", "once"},
        {"caliente", "tv"}, {"24", "horas"}, {"tv", "publica"},
        {"tv", "peru"}, {"hispano", "tv"}, {"movistar", "deportes"},
    ]
    for mw in MULTI_NETWORKS:
        if mw.issubset(words):
            score += 10
            break

    # 4. Spanish-speaking cities / regions (exact word match)
    LOCATION_WORDS = frozenset({
        "tijuana", "juarez", "santiago", "bogota", "lima", "quito",
        "caracas", "habana", "montevideo", "asuncion",
        "buenos", "aires",
        "cordoba", "rosario", "medellin",
        "cali", "barranquilla", "cartagena",
        "guadalajara", "monterrey", "puebla", "toluca", "queretaro",
        "merida", "cancun", "acapulco", "veracruz",
        "guayaquil", "valparaiso", "concepcion",
        "canarias", "canaria", "catalunya", "cataluna",
        "andalucia", "galicia", "extremadura",
        "malaga", "murcia", "zaragoza", "bilbao",
        "granada", "alicante", "valladolid",
        "tenerife", "sevilla", "madrid",
    })
    loc = words & LOCATION_WORDS
    if loc:
        score += 6 * len(loc)

    # 5. Spanish TV keywords (exact word match)
    KEYWORD_WORDS = frozenset({
        "noticias", "deportes", "futbol",
        "musica", "novelas", "telenovelas",
        "infantil", "entretenimiento", "documentales",
    })
    kw = words & KEYWORD_WORDS
    if kw:
        score += 5 * len(kw)

    # 6. Group-title hints
    if group:
        g_slug = _slugify(group)
        g_words = set(g_slug.split("-"))
        if g_words & {"spanish", "espanol", "latino", "hispano"}:
            score += 5

    return score >= 5


def _parse_m3u(
    content: str,
    default_category: str = "general",
) -> list[IptvChannel]:
    channels = []
    lines = content.splitlines()
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("#EXTINF:"):
            comma_idx = line.rfind(",")
            if comma_idx == -1:
                i += 1
                continue
            name = line[comma_idx + 1 :].strip()

            logo_match = re.search(r'tvg-logo="([^"]*)"', line)
            logo_url = logo_match.group(1) if logo_match else None

            tvg_match = re.search(r'tvg-id="([^"]*)"', line)
            tvg_id = tvg_match.group(1) if tvg_match else None

            group_match = re.search(r'group-title="([^"]*)"', line)
            group = group_match.group(1) if group_match else None

            url = None
            j = i + 1
            while j < len(lines):
                l = lines[j].strip()
                if l and not l.startswith("#"):
                    url = l
                    break
                j += 1

            if url and name:
                clean = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
                if not clean:
                    clean = name
                local_slug = CATEGORY_SLUG_MAP.get(default_category, "general")
                channels.append(
                    IptvChannel(
                        name=clean,
                        slug=_slugify(clean),
                        stream_url=url,
                        logo_url=logo_url,
                        tvg_id=tvg_id,
                        group=group,
                        language=None,
                        iptv_category=default_category,
                        category_slug=local_slug,
                    )
                )
        i += 1

    return channels


async def fetch_category(category_slug: str) -> list[IptvChannel]:
    playlist_url = CATEGORY_PLAYLISTS.get(category_slug)
    if not playlist_url:
        return []

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/plain,*/*",
    }

    async with httpx.AsyncClient(
        headers=headers, timeout=60.0, follow_redirects=True
    ) as client:
        r = await client.get(playlist_url)
        r.raise_for_status()
        return _parse_m3u(r.text, default_category=category_slug)


async def fetch_all_categories() -> dict[str, list[IptvChannel]]:
    slugs = list(CATEGORY_PLAYLISTS.keys())
    results = await asyncio.gather(
        *(fetch_category(slug) for slug in slugs),
        return_exceptions=True,
    )
    out = {}
    for slug, result in zip(slugs, results):
        if isinstance(result, Exception):
            continue
        if result:
            out[slug] = result
    return out


async def fetch_country(country_code: str) -> list[IptvChannel]:
    url = IPTV_COUNTRY_URL.format(code=country_code)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    async with httpx.AsyncClient(headers=headers, timeout=60.0, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        return _parse_m3u(r.text, default_category="general")


async def fetch_free_tv_spain() -> list[IptvChannel]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    async with httpx.AsyncClient(headers=headers, timeout=60.0, follow_redirects=True) as client:
        r = await client.get(FREE_TV_SPAIN_URL)
        r.raise_for_status()
        return _parse_m3u(r.text, default_category="general")


async def fetch_tv_colombia() -> list[IptvChannel]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    async with httpx.AsyncClient(headers=headers, timeout=60.0, follow_redirects=True) as client:
        r = await client.get(TV_COLOMBIA_URL)
        r.raise_for_status()
        return _parse_m3u(r.text, default_category="deportes")


def fetch_community_colombia() -> list[IptvChannel]:
    """Lee el playlist local de canales colombianos aportados por la comunidad."""
    path = os.path.join(LOCAL_PLAYLIST_DIR, "colombia_community.m3u")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return _parse_m3u(f.read(), default_category="general")


async def fetch_tdt_channels() -> list[IptvChannel]:
    """Parsea el Markdown de LaQuay/TDTChannels para extraer canales españoles.
    
    El archivo contiene múltiples tablas separadas por secciones:
    - Nacionales, Informativos, Deportes, Infantiles, Autonómicas, etc.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    async with httpx.AsyncClient(headers=headers, timeout=60.0, follow_redirects=True) as client:
        r = await client.get(TDT_CHANNELS_URL)
        r.raise_for_status()
        md = r.text

    channels = []
    lines = md.splitlines()
    in_table = False
    for line in lines:
        stripped = line.strip()
        # Detect table separator row: "| - | - | ..."
        if re.match(r"^\|\s*-+\s*\|", stripped):
            in_table = True
            continue
        if not in_table:
            continue
        # Exit table on non-pipe lines or section headers
        if not stripped.startswith("|"):
            in_table = False
            continue

        cols = [c.strip() for c in stripped.split("|")]
        if len(cols) < 3:
            continue

        name = cols[1].strip()
        if not name or name == "Canal":
            continue

        m3u8_col = cols[2]
        # Skip rows without m3u8 URL (marked as "-")
        if m3u8_col.strip() in ("", "-", "-|"):
            continue
        # Extract first .m3u8 URL
        m3u8_match = re.search(r'https?://[^\s)\]]+\.m3u8', m3u8_col)
        if not m3u8_match:
            continue
        stream_url = m3u8_match.group(0)

        # Extract logo URL from 4th column (cols[4])
        logo_url = None
        if len(cols) >= 5:
            logo_col = cols[4].strip()
            logo_match = re.search(r'(https?://[^\s)\]]+(?:png|jpg|jpeg))', logo_col)
            if logo_match:
                logo_url = logo_match.group(0)

        channels.append(IptvChannel(
            name=name,
            slug=_slugify(name),
            stream_url=stream_url,
            logo_url=logo_url,
            category_slug="general",
            iptv_category="general",
            group="Spain TDTChannels",
        ))

    return channels


def list_available_categories() -> list[dict]:
    return [
        {"slug": slug, "label": label, "playlist_url": CATEGORY_PLAYLISTS[slug]}
        for slug, label in IPTV_CATEGORY_LABELS.items()
    ]


def _ensure_category(db: Session, slug: str) -> Optional[Category]:
    cat = db.query(Category).filter(Category.slug == slug).first()
    if cat:
        return cat
    label = IPTV_CATEGORY_LABELS.get(slug, slug.capitalize())
    cat = Category(name=label, slug=slug)
    db.add(cat)
    db.flush()
    return cat


def _unique_slug(db: Session, slug: str, seen: set) -> str:
    if slug not in seen:
        existing = db.query(Channel).filter(Channel.slug == slug).first()
        if not existing:
            seen.add(slug)
            return slug
    n = 1
    while True:
        candidate = f"{slug}-{n}"
        if candidate not in seen:
            existing = db.query(Channel).filter(Channel.slug == candidate).first()
            if not existing:
                seen.add(candidate)
                return candidate
        n += 1


def import_to_db(
    db: Session,
    channels: list[IptvChannel],
) -> dict:
    created = 0
    skipped = 0
    too_long = 0
    not_spanish = 0
    seen_slugs: set = set()

    for ch in channels:
        if not _is_likely_spanish(ch.name, ch.group):
            not_spanish += 1
            skipped += 1
            continue

        cat = _ensure_category(db, ch.category_slug)
        if not cat:
            skipped += 1
            continue

        url = ch.stream_url
        if len(url) > 500:
            too_long += 1
            skipped += 1
            continue

        slug = _unique_slug(db, ch.slug, seen_slugs)

        db.add(
            Channel(
                name=ch.name,
                slug=slug,
                stream_url=url,
                logo_url=ch.logo_url,
                category_id=cat.id,
                is_active=True,
            )
        )
        created += 1

    db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "too_long": too_long,
        "not_spanish": not_spanish,
        "total": len(channels),
    }


def import_all_to_db(
    db: Session,
    all_channels: dict[str, list[IptvChannel]],
) -> dict:
    total_created = 0
    total_skipped = 0
    total_too_long = 0
    total_found = 0
    by_category: dict[str, dict] = {}

    for category_slug, channels in all_channels.items():
        total_found += len(channels)
        stats = import_to_db(db, channels)
        by_category[category_slug] = stats
        total_created += stats["created"]
        total_skipped += stats["skipped"]
        total_too_long += stats["too_long"]

    return {
        "created": total_created,
        "skipped": total_skipped,
        "too_long": total_too_long,
        "total": total_found,
        "by_category": by_category,
    }


def import_spanish_to_db(
    db: Session,
    channels: list[IptvChannel],
) -> dict:
    """Importa canales desde fuentes que ya son 100 % hispanas (Free-TV, TDTChannels).
    
    Omite el filtro _is_likely_spanish y los asigna a la categoría general.
    """
    created = 0
    skipped = 0
    too_long = 0
    seen_slugs: set = set()

    for ch in channels:
        cat = _ensure_category(db, "general")
        if not cat:
            skipped += 1
            continue

        url = ch.stream_url
        if len(url) > 500:
            too_long += 1
            skipped += 1
            continue

        slug = _unique_slug(db, _slugify(ch.name), seen_slugs)

        db.add(
            Channel(
                name=ch.name,
                slug=slug,
                stream_url=url,
                logo_url=ch.logo_url,
                category_id=cat.id,
                is_active=True,
            )
        )
        created += 1

    db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "too_long": too_long,
        "total": len(channels),
    }


def delete_non_spanish_channels(db: Session) -> dict:
    """Elimina de la BD los canales que el clasificador considera no hispanos."""
    all_channels = db.query(Channel).all()
    deleted = 0
    kept = 0
    for ch in all_channels:
        if not _is_likely_spanish(ch.name, None):
            db.delete(ch)
            deleted += 1
        else:
            kept += 1
    db.commit()
    return {"deleted": deleted, "kept": kept, "total_before": deleted + kept}
