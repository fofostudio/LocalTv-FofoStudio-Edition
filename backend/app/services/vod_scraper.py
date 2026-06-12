"""
VOD Scraper — sistema tipo Streamflix (Provider + Extractor) en Python puro.

Providers: toman un TMDB ID y devuelven URLs de embed/reproducción.
Extractors: toman una URL de embed y resuelven la URL real del video (.m3u8).

El sistema prueba cada provider en orden de preferencia (reliabilidad+calidad),
y si el extractor no puede extraer .m3u8, devuelve la embed URL como fallback
para que el frontend la muestre en un iframe.
"""
from __future__ import annotations

import asyncio
import base64
import codecs
import json
import re
import unicodedata
from dataclasses import dataclass, field
from html import unescape
from urllib.parse import urljoin

import httpx


# ---------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------
@dataclass
class Source:
    url: str
    kind: str          # "hls" | "mp4" | "embed"
    quality: str = ""
    label: str = ""
    provider: str = ""
    headers: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Cliente HTTP compartido
# ---------------------------------------------------------------------------
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
}

_client = httpx.AsyncClient(
    timeout=httpx.Timeout(15.0, connect=8.0),
    headers=_HEADERS,
    follow_redirects=True,
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)

_M3U8_RE = re.compile(r"https?://[^\042\047\s<>\"']+\.m3u8[^\042\047\s<>\"']*")
_IFRAME_RE = re.compile(r'<iframe[^>]+src=[\"\']([^\"\']+)[\"\']', re.IGNORECASE)
_PLAYBACK_RE = re.compile(r'playbackURL\s*[=:]\s*[\"\']?([^\"\'<>\s]+\.m3u8[^\"\'<>\s]*)', re.IGNORECASE)
_SOURCE_RE = re.compile(r'<source[^>]+src=[\"\']([^\"\']+)[\"\']', re.IGNORECASE)


_PACKED_RE = re.compile(
    r"\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'([^']*)'\.split\('\|'\)", re.S
)
_FILE_RE = re.compile(r'(?:file|source|src)\s*[:=]\s*"(https?://[^"]+?\.m3u8[^"]*)"', re.I)
_B62 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _unpack_packed(js: str) -> str | None:
    """Des-empaqueta JS ofuscado con el packer Dean Edwards (p,a,c,k,e,d)."""
    m = _PACKED_RE.search(js)
    if not m:
        return None
    try:
        payload = m.group(1).encode("latin-1", "ignore").decode("unicode_escape", "ignore")
    except Exception:
        payload = m.group(1)
    radix = int(m.group(2))
    words = m.group(4).split("|")

    def val(tok: str):
        v = 0
        for ch in tok:
            d = _B62.find(ch.lower())
            if d < 0 or d >= radix:
                return None
            v = v * radix + d
        return v

    def repl(mt):
        w = mt.group(0)
        v = val(w)
        return words[v] if (v is not None and v < len(words) and words[v]) else w

    return re.sub(r"\b[0-9a-zA-Z]+\b", repl, payload)


def _find_m3u8(html: str) -> str | None:
    for pat in (_PLAYBACK_RE, _SOURCE_RE, _M3U8_RE):
        m = pat.search(html)
        if m:
            url = m.group(1).strip()
            if url.startswith("http"):
                return url
    # JS empaquetado (filemoon / streamwish / vimeos…) → des-empaquetar y buscar file:"…m3u8"
    if "function(p,a,c,k,e" in html:
        up = _unpack_packed(html)
        if up:
            fm = _FILE_RE.search(up)
            if fm:
                return fm.group(1)
            mm = _M3U8_RE.search(up)
            if mm:
                return mm.group(0)
    return None


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
async def _try_fetch_m3u8(embed_url: str, referer: str = "") -> str | None:
    """Fetch an embed page and try to extract a direct .m3u8 URL."""
    headers = {}
    if referer:
        headers["Referer"] = referer
    try:
        r = await _client.get(embed_url, headers=headers)
        if r.status_code != 200:
            return None
        found = _find_m3u8(r.text)
        if found:
            return found
        # Follow iframe chain (1 level deep)
        im = _IFRAME_RE.search(r.text)
        if im:
            iframe_url = urljoin(embed_url, im.group(1).strip())
            r2 = await _client.get(iframe_url, headers={**headers, "Referer": embed_url})
            if r2.status_code == 200:
                found = _find_m3u8(r2.text)
                if found:
                    return found
    except Exception:
        return None
    return None


async def _provider_vidsrc(media_type: str, tmdb_id: int, **kw) -> list[Source]:
    """vidsrc.to → vsembed.ru → intenta extraer .m3u8."""
    embed = f"https://vidsrc.to/embed/{media_type}/{tmdb_id}"
    m3u8 = await _try_fetch_m3u8(embed, referer="https://vidsrc.to/")
    if m3u8:
        return [Source(url=m3u8, kind="hls", provider="vidsrc")]
    return [Source(url=embed, kind="embed", provider="vidsrc", label="VidSrc")]


async def _provider_2embed(media_type: str, tmdb_id: int, **kw) -> list[Source]:
    """2embed.cc intenta extraer .m3u8."""
    embed = f"https://www.2embed.cc/embed/{media_type}/{tmdb_id}"
    m3u8 = await _try_fetch_m3u8(embed, referer="https://www.2embed.cc/")
    if m3u8:
        return [Source(url=m3u8, kind="hls", provider="2embed")]
    return [Source(url=embed, kind="embed", provider="2embed", label="2Embed")]


async def _provider_multiembed(media_type: str, tmdb_id: int, **kw) -> list[Source]:
    """multiembed.mom direct video approach."""
    embed = f"https://multiembed.mom/direct.php?video={tmdb_id}"
    m3u8 = await _try_fetch_m3u8(embed)
    if m3u8:
        return [Source(url=m3u8, kind="hls", provider="multiembed")]
    return []


# ---------------------------------------------------------------------------
# Providers en español (portados de StreamFlix-reborn) — scraping por título
# ---------------------------------------------------------------------------
def _norm(s: str) -> str:
    """Normaliza un título para comparar: sin acentos, minúsculas, solo alfanum."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


# Embeds que NO son streams reales (trailers, redes) — se descartan.
_SKIP_EMBED = ("youtube.com", "youtu.be", "facebook.com")


def _norm_overlap(a: str, b: str) -> float:
    """Solapamiento de palabras entre dos títulos normalizados (0..1)."""
    sa, sb = set(a.split()), set(b.split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa), len(sb))


# ---------------------------------------------------------------------------
# Motor multi-sitio (sitios latino tipo dooplay/article) — catálogo + búsqueda
# + servidores. Portado/generalizado de StreamFlix-reborn.
# ---------------------------------------------------------------------------
from urllib.parse import quote  # noqa: E402

_SITES = [
    {
        "name": "cinecalidad", "base": "https://www.cinecalidad.ec",
        "movies": lambda p: f"/page/{p + 1}",          # page1 = home
        "series": lambda p: f"/ver-serie/page/{p + 1}",
        "search": lambda q, p: f"/page/{p}?s={quote(q)}",
        "server_attr": "data-option",
        "movie_kw": "/ver-pelicula", "tv_kw": "/ver-serie",
    },
    {
        "name": "flixlatam", "base": "https://flixlatam.com",
        "movies": lambda p: "/peliculas/" if p == 1 else f"/peliculas/page/{p}/",
        "series": lambda p: "/series/" if p == 1 else f"/series/page/{p}/",
        "search": lambda q, p: f"/?s={quote(q)}",
        "server_attr": "data-option",
        "movie_kw": "/pelicula", "tv_kw": "/serie",
    },
    {
        "name": "cine24h", "base": "https://cine24h.online",
        "movies": lambda p: "/peliculas/" if p == 1 else f"/peliculas/page/{p}/",
        "series": lambda p: "/series/" if p == 1 else f"/series/page/{p}/",
        "search": lambda q, p: f"/?s={quote(q)}&paged={p}",
        "server_attr": "data-src",
        "movie_kw": "/peliculas/", "tv_kw": "/series/",
    },
]

# Decoración SEO que ensucia los títulos en algunos sitios.
_TITLE_PREFIX = re.compile(r'^\s*(ver|pelicula|serie)\s+', re.IGNORECASE)
_TITLE_SUFFIX = re.compile(
    r'\s+(online|gratis|en\s+espa[nñ]ol|latino|castellano|hd|subtitulad[oa]|por\s+mega).*$',
    re.IGNORECASE,
)


def _clean_title(t: str) -> str:
    t = unescape(t or "").strip()
    t = _TITLE_PREFIX.sub("", t)
    t = _TITLE_SUFFIX.sub("", t)
    return t.strip(" -–|") or t
_SITE_BY_NAME = {s["name"]: s for s in _SITES}


def _site_for_url(url: str) -> dict | None:
    low = (url or "").lower()
    for s in _SITES:
        # match por nombre (cinecalidad/flixlatam/cine24h) → robusto a cambios de TLD
        # (p.ej. cinecalidad.ec ↔ cinecalidad.am) y por dominio base.
        if s["name"] in low or s["base"].split("//", 1)[-1] in low:
            return s
    return None


def _abs(url: str, base: str) -> str:
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base + url
    return url


def _parse_shows(html: str, site: dict, kind: str | None = None) -> list[dict]:
    """Parser genérico de fichas (article / div.card) de un sitio latino."""
    out: list[dict] = []
    blocks = re.findall(r'<article\b[^>]*>(.*?)</article>', html, re.S)
    if not blocks:
        blocks = re.findall(r'<div[^>]+class="[^"]*\bcard\b[^"]*"[^>]*>(.*?)</a>\s*</div>', html, re.S)
    for block in blocks:
        mlink = re.search(r'<a[^>]+href="([^"]+)"', block)
        if not mlink:
            continue
        url = _abs(unescape(mlink.group(1)), site["base"])
        mt = "movie" if site["movie_kw"] in url else ("tv" if site["tv_kw"] in url else None)
        if not mt or (kind and mt != kind):
            continue
        imgm = re.search(r'<img[^>]+>', block)
        imgtag = imgm.group(0) if imgm else ""
        # Prioriza data-src/data-lazy-src (lazy real) sobre src (suele ser placeholder base64).
        mp = (re.search(r'data-src="([^"]+)"', imgtag)
              or re.search(r'data-lazy-src="([^"]+)"', imgtag)
              or re.search(r'srcset="([^"\s]+)', imgtag)
              or re.search(r'src="([^"]+)"', imgtag))
        ma = re.search(r'alt="([^"]*)"', imgtag)
        title = unescape(ma.group(1)).strip() if ma and ma.group(1).strip() else ""
        if not title:
            mh = re.search(r'<(?:h2|h3)[^>]*>(.*?)</(?:h2|h3)>', block, re.S)
            title = (re.sub(r'<[^>]+>', '', mh.group(1)).strip() if mh
                     else url.rstrip("/").rsplit("/", 1)[-1].replace("-", " ").title())
        title = _clean_title(title)
        poster = _abs(unescape(mp.group(1)), site["base"]) if mp else ""
        if poster.startswith("data:"):
            poster = ""
        # Año del card: elemento year/date/fecha → si no, año suelto en una etiqueta.
        ym = (re.search(r'class="[^"]*(?:year|date|fecha)[^"]*"[^>]*>\s*((?:19|20)\d{2})', block, re.I)
              or re.search(r'>\s*((?:19|20)\d{2})\s*<', block))
        year = ym.group(1) if ym else ""
        out.append({"id": url, "cine_url": url, "title": title, "poster": poster,
                    "media_type": mt, "site": site["name"], "year": year})
    return out


def _dedup(items: list[dict]) -> list[dict]:
    """Dedup por título normalizado + tipo (la misma peli en 2 sitios = 1)."""
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for it in items:
        key = f"{it.get('media_type', '')}:{_norm(it.get('title', '')) or it['id']}"
        cur = by_key.get(key)
        if cur is None:
            by_key[key] = it
            order.append(key)
        else:
            # Conserva el que tenga más datos (poster + año).
            score = (bool(it.get("poster")), bool(it.get("year")))
            cscore = (bool(cur.get("poster")), bool(cur.get("year")))
            if score > cscore:
                by_key[key] = it
    return [by_key[k] for k in order]


async def _fetch(url: str, referer: str = "") -> str | None:
    try:
        r = await _client.get(url, headers={"Referer": referer} if referer else {})
        return r.text if r.status_code == 200 else None
    except Exception:
        return None


async def _site_catalog(site: dict, kind: str, page: int) -> list[dict]:
    path = site["series"](page) if kind == "tv" else site["movies"](page)
    html = await _fetch(site["base"] + path)
    return _parse_shows(html, site, kind=kind) if html else []


async def _site_search(site: dict, query: str, page: int) -> list[dict]:
    html = await _fetch(site["base"] + site["search"](query, page), referer=site["base"] + "/")
    return _parse_shows(html, site) if html else []


async def latino_catalog(kind: str = "movie", page: int = 1) -> list[dict]:
    """Catálogo agregado de TODOS los sitios latino (sin TMDB)."""
    page = max(1, page)
    res = await asyncio.gather(*[_site_catalog(s, kind, page) for s in _SITES],
                               return_exceptions=True)
    out: list[dict] = []
    for r in res:
        if isinstance(r, list):
            out.extend(r)
    return _dedup(out)


async def latino_search(query: str, page: int = 1) -> list[dict]:
    """Búsqueda agregada en TODOS los sitios latino."""
    page = max(1, page)
    res = await asyncio.gather(*[_site_search(s, query, page) for s in _SITES],
                               return_exceptions=True)
    out: list[dict] = []
    for r in res:
        if isinstance(r, list):
            out.extend(r)
    return _dedup(out)


# --- Extractor Voe (voe.sx y mirrors rotativos) → HLS directo ---
def _voe_decrypt(content: str) -> dict:
    s = content.strip()
    try:
        arr = json.loads(s)
        if isinstance(arr, list) and arr:
            s = arr[0]
    except Exception:
        pass
    s = codecs.encode(s, "rot_13")
    for p in ("@$", "^^", "~@", "%?", "*~", "!!", "#&"):
        s = s.replace(p, "_")
    s = s.replace("_", "")
    s = base64.b64decode(s + "=" * (-len(s) % 4)).decode("utf-8", "ignore")
    s = "".join(chr(ord(c) - 3) for c in s)
    s = s[::-1]
    s = base64.b64decode(s + "=" * (-len(s) % 4)).decode("utf-8", "ignore")
    return json.loads(s)


async def _extract_voe(embed_url: str) -> str | None:
    """voe.sx/e/ID → sigue el mirror → decodifica el script application/json → m3u8."""
    html = await _fetch(embed_url, referer="https://voe.sx/")
    if not html:
        return None
    # página "Redirecting…": seguir window.location.href al mirror.
    if "Redirecting" in html or "location.href" in html:
        m = re.search(r"location\.href\s*=\s*'([^']+)'", html)
        if m:
            html = await _fetch(m.group(1), referer="https://voe.sx/") or html
    sm = re.search(r'<script type="application/json">(.*?)</script>', html, re.S)
    if not sm:
        # algunos mirrors traen var ... = '...'
        return _find_m3u8(html)
    try:
        dec = _voe_decrypt(sm.group(1))
        return dec.get("source") or dec.get("file") or dec.get("direct_access_url")
    except Exception:
        return None


async def _site_servers(url: str, site: dict | None = None) -> list[Source]:
    """Dada la URL de una ficha, devuelve sus fuentes (embeds/HLS)."""
    site = site or _site_for_url(url)
    html = await _fetch(url, referer=(site["base"] + "/") if site else "")
    if not html:
        return []
    prov = site["name"] if site else "latino"
    # acepta data-option (dooplay) y data-src (cine24h)
    opts = re.findall(r'<li[^>]+data-option="([^"]+)"[^>]*>(.*?)</li>', html, re.S)
    opts += re.findall(r'<li[^>]+data-src="([^"]+)"[^>]*>(.*?)</li>', html, re.S)
    sources: list[Source] = []
    for raw, label in opts:
        embed = unescape(raw.strip())
        if not embed.startswith("http") or any(s in embed.lower() for s in _SKIP_EMBED):
            continue
        name = re.sub(r"<[^>]+>", "", label).strip()[:30] or prov
        # si el "embed" es una página del propio sitio, sacar el iframe interno
        if site and site["base"].split("//", 1)[-1] in embed:
            inner = await _fetch(embed, referer=site["base"] + "/")
            if inner:
                ifr = _IFRAME_RE.search(inner)
                if ifr:
                    embed = urljoin(embed, unescape(ifr.group(1)))
        # Extractor específico de Voe; el resto vía unpacker/regex genérico.
        if "voe" in embed.lower() or "voe" in name.lower():
            m3u8 = await _extract_voe(embed)
        else:
            m3u8 = await _try_fetch_m3u8(embed, referer=(site["base"] + "/") if site else "")
        if m3u8:
            sources.append(Source(url=m3u8, kind="hls", provider=prov, label=f"{name} [LAT]"))
        else:
            sources.append(Source(url=embed, kind="embed", provider=prov, label=f"{name} [LAT]"))
    return sources


# ---------------------------------------------------------------------------
# Detalle (sinopsis + géneros + año + rating) y categorías — con lxml/XPath
# ---------------------------------------------------------------------------
from lxml import html as _LH  # noqa: E402

_BAD_OVERVIEW = re.compile(r'no se encontr|sin sinopsis|disfruta del contenido', re.IGNORECASE)
_OVERVIEW_XP = [
    '//div[contains(@class,"single_left")]//td[contains(@style,"justify")]//p[not(.//span)]',
    '//div[contains(@class,"wp-content")]//p',
    '//div[contains(@class,"sbox")]//div[contains(@class,"wp-content")]//p',
    '//*[contains(@class,"Description")]',
    '//*[contains(@class,"description")]//p',
    '//*[contains(@class,"sinopsis")]',
    '//div[@itemprop="description"]',
]


def _xtext(el) -> str:
    return " ".join(el.text_content().split()) if el is not None else ""


def _jsonld(doc) -> dict:
    for s in doc.xpath('//script[@type="application/ld+json"]/text()'):
        try:
            j = json.loads(s)
            for it in (j if isinstance(j, list) else [j]):
                if isinstance(it, dict) and it.get("@type") in ("Movie", "TVSeries", "VideoObject"):
                    return it
        except Exception:
            continue
    return {}


async def site_detail(url: str) -> dict:
    """Extrae sinopsis, géneros, año y rating de la ficha (cualquier sitio latino)."""
    html = await _fetch(url)
    if not html:
        return {}
    doc = _LH.fromstring(html)
    ld = _jsonld(doc)

    # Sinopsis: cuerpo (mejor) → JSON-LD → og:description (último recurso).
    # Recorremos TODOS los nodos de cada xpath (no solo el primero) porque a veces
    # el primer <p> está vacío y la sinopsis real es el siguiente.
    overview = ""
    for xp in _OVERVIEW_XP:
        for node in doc.xpath(xp):
            t = _xtext(node)
            if t and not _BAD_OVERVIEW.search(t) and len(t) > 30:
                overview = t
                break
        if overview:
            break
    if not overview:
        overview = (ld.get("description") or "").strip()

    # Géneros del título: JSON-LD → links de género dentro del área de detalle.
    genres = []
    g = ld.get("genre")
    if isinstance(g, list):
        genres = [str(x).strip() for x in g if str(x).strip()]
    elif isinstance(g, str) and g.strip():
        genres = [g.strip()]
    if not genres:
        # Scopeado al área de detalle (no al menú de géneros del sitio).
        genre_xp = [
            '//td[contains(@style,"justify")]//a[contains(@href,"genero-de-la-pelicula")]/text()',
            '//*[contains(@class,"Description")]//a[contains(@href,"/category/")]/text()',
            '//*[contains(@class,"Genre")]//a/text()',
            '//*[contains(@class,"sgeneros")]//a/text()',
            '//span[contains(text(),"nero")]/following-sibling::*//a/text()',
        ]
        for xp in genre_xp:
            vals = [t.strip() for t in doc.xpath(xp) if t.strip()]
            if vals:
                genres = [g for g in dict.fromkeys(vals) if g.lower() != "doramas"][:5]
                break

    # Año y rating.
    year = ""
    dp = str(ld.get("datePublished") or "")
    if dp[:4].isdigit():
        year = dp[:4]
    if not year:
        date_els = doc.xpath('//*[contains(@class,"Date") or contains(@class,"year") or contains(@class,"fecha")]')
        if date_els:
            my = re.search(r'\b(19|20)\d{2}\b', _xtext(date_els[0]))
            if my:
                year = my.group(0)
    rating = ""
    rv = doc.xpath('//*[@itemprop="ratingValue"]/text()') or doc.xpath('//*[contains(@class,"Rank") or contains(@class,"rating-value")]/text()')
    if rv:
        m = re.search(r'\d+(\.\d+)?', rv[0])
        if m:
            rating = m.group(0)
    elif isinstance(ld.get("aggregateRating"), dict):
        rating = str(ld["aggregateRating"].get("ratingValue") or "")

    # Trailer (YouTube).
    trailer = ""
    yt = re.search(r'(?:youtube\.com/(?:embed/|watch\?v=)|youtu\.be/)([\w-]{11})', html)
    if yt:
        trailer = f"https://www.youtube.com/embed/{yt.group(1)}"

    # Reparto (best-effort: links de actor o tras la etiqueta Reparto/Elenco).
    cast = []
    for t in doc.xpath(
        '//span[contains(.,"Reparto") or contains(.,"Elenco")]/following-sibling::*//a/text()'
        ' | //*[contains(@class,"cast") or contains(@class,"Cast")]//a/text()'
        ' | //a[contains(@href,"/cast/") or contains(@href,"/star/") or contains(@href,"/actor")]/text()'
    ):
        t = t.strip()
        if t and t not in cast:
            cast.append(t)
        if len(cast) >= 8:
            break

    # Similares / relacionados.
    similar = []
    site = _site_for_url(url)
    if site:
        rel = doc.xpath('//*[contains(@id,"relacionados") or contains(@class,"related") '
                        'or contains(@class,"yarpp") or contains(@id,"single_relacionados")]')
        if rel:
            try:
                from lxml import etree
                rel_html = etree.tostring(rel[0], encoding="unicode")
                similar = _parse_shows(rel_html, site)[:12]
                if not similar:        # fallback: links a fichas dentro del relacionado
                    seen = set()
                    for a in rel[0].xpath('.//a[@href]'):
                        href = a.get("href") or ""
                        if site["movie_kw"] not in href and site["tv_kw"] not in href:
                            continue
                        href = _abs(href, site["base"])
                        if href in seen:
                            continue
                        seen.add(href)
                        imgs = a.xpath('.//img') or a.xpath('./following::img[1]') or a.xpath('../img')
                        poster, alt = "", ""
                        if imgs:
                            img = imgs[0]
                            poster = (img.get("data-src") or img.get("src") or img.get("data-lazy-src") or "")
                            if poster.startswith("data:"):
                                poster = img.get("data-lazy-src") or ""
                            alt = img.get("alt") or ""
                        title = _clean_title(alt or a.get("title") or a.text_content())
                        if not title:
                            continue
                        similar.append({
                            "id": href, "cine_url": href, "title": title,
                            "poster": _abs(poster, site["base"]) if poster else "",
                            "media_type": "movie" if site["movie_kw"] in href else "tv",
                            "site": site["name"], "year": "",
                        })
                        if len(similar) >= 12:
                            break
            except Exception:
                similar = []

    # Sin duplicados y sin el propio título.
    self_norm = _norm(_clean_title(
        (doc.xpath('//h1/text()') or [""])[0]
    ))
    similar = [s for s in _dedup(similar) if _norm(s.get("title", "")) != self_norm]

    # Episodios (series): cada <li> con .numerando (S1-E1) + link al episodio.
    episodes = []
    if site:
        for li in doc.xpath('//li[.//*[contains(@class,"numerando")]]'):
            num = (li.xpath('.//*[contains(@class,"numerando")]/text()') or [""])[0].strip()
            a = (li.xpath('.//*[contains(@class,"episodiotitle")]//a')
                 or li.xpath('.//a[contains(@href,"episodio") or contains(@href,"capitulo") '
                             'or contains(@href,"-1x") or contains(@href,"-2x")]'))
            if not a:
                continue
            href = a[0].get("href") or ""
            etitle = " ".join(a[0].text_content().split()).strip()
            mse = re.match(r'[sS]?(\d+)\s*[-xeE]+\s*(\d+)', num.replace("E", "-"))
            season = int(mse.group(1)) if mse else 1
            epnum = int(mse.group(2)) if mse else (len(episodes) + 1)
            episodes.append({
                "season": season, "episode": epnum,
                "label": num or f"E{epnum}",
                "title": etitle,
                "url": _abs(href, site["base"]),
            })

    return {
        "overview": overview,
        "genres": genres[:5],
        "year": year,
        "rating": rating,
        "trailer": trailer,
        "cast": cast,
        "similar": similar[:12],
        "episodes": episodes,
    }


# Categorías comunes → slug por sitio (para navegar por género).
_GENRES = [
    ("accion", "Acción"), ("aventura", "Aventura"), ("comedia", "Comedia"),
    ("drama", "Drama"), ("terror", "Terror"), ("ciencia-ficcion", "Ciencia ficción"),
    ("animacion", "Animación"), ("romance", "Romance"), ("suspenso", "Suspenso"),
    ("documental", "Documental"), ("fantasia", "Fantasía"), ("crimen", "Crimen"),
    ("familia", "Familia"), ("anime", "Anime"), ("guerra", "Bélica"),
]
_GENRE_URLS = {
    "cinecalidad": lambda slug, p: f"/genero-de-la-pelicula/{slug}/page/{p}/" if p > 1 else f"/genero-de-la-pelicula/{slug}/",
    "flixlatam": lambda slug, p: f"/genero/{slug}/page/{p}/" if p > 1 else f"/genero/{slug}/",
    "cine24h": lambda slug, p: f"/category/{slug}/page/{p}/" if p > 1 else f"/category/{slug}/",
}


def genre_list() -> list[dict]:
    return [{"slug": s, "name": n} for s, n in _GENRES]


# Clásicas = películas de años antiguos (vía /release/{año}/ donde el sitio lo soporta).
_CLASSIC_YEARS = list(range(1999, 1959, -1))   # 1999 → 1960
_CLASSIC_SITES = ("cinecalidad", "cine24h")    # exponen /release/{año}/


async def _fetch_release_year(site: dict, year: int, kind: str) -> list[dict]:
    html = await _fetch(f"{site['base']}/release/{year}/")
    if not html:
        return []
    items = _parse_shows(html, site)
    for it in items:                       # el año del card puede faltar → lo fijamos
        if not it.get("year"):
            it["year"] = str(year)
    if kind in ("movie", "tv"):
        items = [it for it in items if it.get("media_type") == kind]
    return items


async def latino_clasicas(kind: str = "movie", page: int = 1) -> list[dict]:
    """Películas clásicas (años antiguos), agregadas y ordenadas por año desc."""
    page = max(1, page)
    years = _CLASSIC_YEARS[(page - 1) * 4: page * 4]   # 4 años por página
    tasks = [
        _fetch_release_year(s, y, kind)
        for y in years for s in _SITES if s["name"] in _CLASSIC_SITES
    ]
    res = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for r in res:
        if isinstance(r, list):
            out.extend(r)
    out = _dedup(out)
    out.sort(key=lambda it: int(it["year"]) if str(it.get("year", "")).isdigit() else 0,
             reverse=True)
    return out


# Secciones de "Estrenos / lo último" por sitio (año reciente o sección dedicada).
# flixlatam no tiene sección dedicada → cae a su catálogo (ya viene newest-first).
_ESTRENOS_URLS = {
    "cinecalidad": lambda p: f"/release/2026/page/{p}/" if p > 1 else "/release/2026/",
    "cine24h": lambda p: f"/estrenos/page/{p}/" if p > 1 else "/estrenos/",
}


async def latino_estrenos(kind: str = "movie", page: int = 1) -> list[dict]:
    """Estrenos / lo último, agregado de todos los sitios."""
    page = max(1, page)

    async def one(site):
        fn = _ESTRENOS_URLS.get(site["name"])
        items = []
        if fn:
            url = fn(page)
            html = await _fetch(site["base"] + url)
            if html:
                items = _parse_shows(html, site)
                # /release/{año}/ → todos son de ese año aunque el card no lo diga.
                my = re.search(r'/release/((?:19|20)\d{2})/', url)
                if my:
                    for it in items:
                        it.setdefault("year", "")
                        if not it["year"]:
                            it["year"] = my.group(1)
        if not items:                       # fallback: catálogo (newest-first)
            items = await _site_catalog(site, kind, page)
        return items

    res = await asyncio.gather(*[one(s) for s in _SITES], return_exceptions=True)
    out = []
    for r in res:
        if isinstance(r, list):
            out.extend(r)
    if kind in ("movie", "tv"):
        out = [it for it in out if it.get("media_type") == kind]
    out = _dedup(out)
    # Orden: año desc (los sin año al final, conservando su orden newest-first).
    out.sort(key=lambda it: int(it["year"]) if str(it.get("year", "")).isdigit() else -1,
             reverse=True)
    return out


async def latino_genre(slug: str, kind: str = "movie", page: int = 1) -> list[dict]:
    """Catálogo de un género agregado de todos los sitios."""
    page = max(1, page)

    async def one(site):
        fn = _GENRE_URLS.get(site["name"])
        if not fn:
            return []
        html = await _fetch(site["base"] + fn(slug, page))
        return _parse_shows(html, site, kind=None) if html else []

    res = await asyncio.gather(*[one(s) for s in _SITES], return_exceptions=True)
    out = []
    for r in res:
        if isinstance(r, list):
            out.extend(r)
    if kind in ("movie", "tv"):
        out = [it for it in out if it.get("media_type") == kind]
    return _dedup(out)


# Compat: los endpoints viejos siguen funcionando.
cinecalidad_catalog = latino_catalog
cinecalidad_search = latino_search


async def _provider_latino(media_type: str, tmdb_id: int, **kw) -> list[Source]:
    """Busca el título en todos los sitios latino y junta sus fuentes."""
    title = (kw.get("title") or "").strip()
    if not title:
        return []
    want = _norm(title)
    res = await latino_search(title)
    cands = []
    for it in res:
        nr = _norm(it["title"])
        if not nr:
            continue
        if want in nr or nr in want or _norm_overlap(want, nr) >= 0.6:
            cands.append(it)
    srcs: list[Source] = []
    for it in cands[:4]:           # hasta 4 fichas que matchean
        srcs.extend(await _site_servers(it["id"]))
    return srcs


_PROVIDERS = [
    ("latino", _provider_latino),   # CineCalidad + FlixLatam + Cine24h
    ("vidsrc", _provider_vidsrc),
    ("2embed", _provider_2embed),
    ("multiembed", _provider_multiembed),
]


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------
async def resolve(
    media_type: str,
    tmdb_id: int,
    season: int | None = None,
    episode: int | None = None,
    title: str | None = None,
    year: str | int | None = None,
    source_url: str | None = None,
) -> dict:
    """
    Devuelve {sources: [Source, ...], detail: str}.
    Prueba providers en orden, devuelve el primero que encuentra algo.
    """
    mt = "tv" if media_type == "tv" else "movie"
    all_sources: list[Source] = []

    # Resolución directa: item del catálogo latino (ya tenemos la URL exacta).
    if source_url and _site_for_url(source_url):
        cine = await _site_servers(source_url)
        # Devolvemos directo (rápido) — con o sin fuentes. Evita caer a la
        # búsqueda multi-sitio (lenta) que abortaba el request en series.
        return {
            "sources": [
                {"url": s.url, "kind": s.kind, "quality": s.quality,
                 "label": s.label, "provider": s.provider, "headers": s.headers}
                for s in cine
            ],
            "detail": "" if cine else "No hay fuentes disponibles para este título.",
        }

    title = (title or "").strip()
    # Si el front no mandó el título, lo sacamos de TMDB (si hay token en el backend).
    if not title:
        try:
            from app.services import tmdb
            if tmdb.has_token():
                d = tmdb.detail(mt, tmdb_id)
                title = (d.get("title") or d.get("name") or "").strip()
                date = d.get("release_date") or d.get("first_air_date") or ""
                year = year or (date[:4] if date else None)
        except Exception:
            pass

    for name, provider in _PROVIDERS:
        try:
            sources = await provider(
                mt, tmdb_id, season=season, episode=episode, title=title, year=year
            )
            if sources:
                all_sources.extend(sources)
        except Exception:
            continue

    if not all_sources:
        return {"sources": [], "detail": "No hay fuentes disponibles para este título."}

    sources_dict = [
        {
            "url": s.url,
            "kind": s.kind,
            "quality": s.quality,
            "label": s.label,
            "provider": s.provider,
            "headers": s.headers,
        }
        for s in all_sources
    ]
    return {"sources": sources_dict, "detail": ""}
