"""
Logos de canales — proxy con caché en disco.

El navegador no puede pedir directo a Wikimedia / GitHub raw porque algunos
hosts rate-limitan o requieren User-Agent específico. El backend descarga UNA
vez con UA correcto y guarda el binario en %LOCALAPPDATA%\\LocalTv\\logo_cache\\.

Endpoint:  GET /api/logo/{slug}
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import httpx


# Map curado de slugs → URL externa del logo.
# Solo URLs CDN estables (Wikimedia + GitHub raw via jsdelivr o cdn.brandfetch.io).
LOGO_URLS: dict[str, str] = {
    # ESPN family
    "espn":           "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn2":          "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/ESPN2_logo.svg/200px-ESPN2_logo.svg.png",
    "espn3":          "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn4":          "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn5":          "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn6":          "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn7":          "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn-premium":   "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn-deportes":  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/ESPN_Deportes_logo.svg/200px-ESPN_Deportes_logo.svg.png",
    "espnu":          "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/ESPNU_logo.svg/200px-ESPNU_logo.svg.png",
    "espn1-nl":       "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "espn2-nl":       "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/ESPN2_logo.svg/200px-ESPN2_logo.svg.png",
    "espn3-nl":       "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",

    # DSports
    "dsports":        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/DirecTV_Sports_2017.svg/200px-DirecTV_Sports_2017.svg.png",
    "dsports-plus":   "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/DirecTV_Sports_2017.svg/200px-DirecTV_Sports_2017.svg.png",
    "dsports2":       "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/DirecTV_Sports_2017.svg/200px-DirecTV_Sports_2017.svg.png",

    # Fox Sports
    "foxsports":         "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Fox_Sports_logo.svg/200px-Fox_Sports_logo.svg.png",
    "foxsports1":        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/2015_Fox_Sports_1_logo.svg/200px-2015_Fox_Sports_1_logo.svg.png",
    "foxsports2":        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Fox_Sports_logo.svg/200px-Fox_Sports_logo.svg.png",
    "foxsports3":        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Fox_Sports_logo.svg/200px-Fox_Sports_logo.svg.png",
    "foxsports-premium": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Fox_Sports_logo.svg/200px-Fox_Sports_logo.svg.png",
    "fox-deportes":      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Fox_Deportes_logo_2018.png/200px-Fox_Deportes_logo_2018.png",

    # TNT Sports
    "tntsports":        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/TNT_Sports_logo_2025.svg/200px-TNT_Sports_logo_2025.svg.png",
    "tnt-sports-chile": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/TNT_Sports_logo_2025.svg/200px-TNT_Sports_logo_2025.svg.png",

    # Win Sports
    "winsports":      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Win_Sports_logo.svg/200px-Win_Sports_logo.svg.png",
    "winsports-plus": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Win_Sports_logo.svg/200px-Win_Sports_logo.svg.png",

    # TyC
    "tycsports":               "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/TyC_Sports.svg/200px-TyC_Sports.svg.png",
    "tycsports-internacional": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/TyC_Sports.svg/200px-TyC_Sports.svg.png",

    # TUDN / Univisión / Telemundo / Universo / Unimás / USA
    "tudn":         "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/TUDN_logo_2019.svg/200px-TUDN_logo_2019.svg.png",
    "univision":    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Univision_2019.svg/200px-Univision_2019.svg.png",
    "telemundo":    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Logotipo_de_Telemundo.svg/200px-Logotipo_de_Telemundo.svg.png",
    "universo":     "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/NBC_Universo_logo_2017.svg/200px-NBC_Universo_logo_2017.svg.png",
    "unimas":       "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Logo_UniM%C3%A1s_2019.svg/200px-Logo_UniM%C3%A1s_2019.svg.png",
    "usa-network":  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/USA_Network_logo_%282016%29.svg/200px-USA_Network_logo_%282016%29.svg.png",

    # Latam abierta
    "telefe":           "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Logo_Telefe.png/200px-Logo_Telefe.png",
    "tv-publica":       "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Logo_TV_P%C3%BAblica.svg/200px-Logo_TV_P%C3%BAblica.svg.png",
    "azteca7":          "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/AZTECA7_2019.svg/200px-AZTECA7_2019.svg.png",
    "azteca-deportes":  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Azteca_Deportes_logo.png/200px-Azteca_Deportes_logo.png",
    "canal5":           "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Canal_5_Mexico_2014.svg/200px-Canal_5_Mexico_2014.svg.png",
    "canal11":          "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Canal_Once_M%C3%A9xico_logo_2019.svg/200px-Canal_Once_M%C3%A9xico_logo_2019.svg.png",
    "caliente-tv":      "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Caliente_TV_logo.png/200px-Caliente_TV_logo.png",
    "tvc-deportes":     "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/TVC_Deportes_logo.png/200px-TVC_Deportes_logo.png",

    # Perú
    "golperu":           "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Logo_de_Gol_Per%C3%BA.png/200px-Logo_de_Gol_Per%C3%BA.png",
    "movistar-deportes": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Movistar_Deportes_logo_Per%C3%BA.png/200px-Movistar_Deportes_logo_Per%C3%BA.png",

    # GOLTV
    "goltv":           "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/GOLTV_logo.svg/200px-GOLTV_logo.svg.png",

    # Sky / beIN / CBS
    "sky-sports-laliga":     "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-sports-bundesliga": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-bundesliga1":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-bundesliga2":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-bundesliga3":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-bundesliga4":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "sky-bundesliga5":       "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sky_Sports_-_Logo_2020.svg/200px-Sky_Sports_-_Logo_2020.svg.png",
    "cbs-sports-network":    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/CBS_Sports_Network_logo_2016.svg/200px-CBS_Sports_Network_logo_2016.svg.png",
    "bein-sports-espanol":      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Logo_beIN_SPORTS.png/200px-Logo_beIN_SPORTS.png",
    "bein-sports-xtra-espanol": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Logo_beIN_SPORTS.png/200px-Logo_beIN_SPORTS.png",

    # DAZN
    "dazn1":               "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/DAZN_1_logo.svg/200px-DAZN_1_logo.svg.png",
    "dazn2":               "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/DAZN_2_logo.svg/200px-DAZN_2_logo.svg.png",
    "dazn3-eventos":       "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn4-eventos":       "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-laliga":         "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn1-de":            "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/DAZN_1_logo.svg/200px-DAZN_1_logo.svg.png",
    "dazn2-de":            "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/DAZN_2_logo.svg/200px-DAZN_2_logo.svg.png",
    "dazn-eleven1":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven2":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven3":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven4":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven5":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven6":        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",
    "dazn-eleven-pro1-be": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/DAZN_logo_%282024%29.svg/200px-DAZN_logo_%282024%29.svg.png",

    # Premiere / Sportv (Brasil)
    "premiere1": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere2": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere3": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere4": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere5": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere6": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere7": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "premiere8": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logo_Premiere_2017.png/200px-Logo_Premiere_2017.png",
    "sportv":    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/SporTV_logo_2018.svg/200px-SporTV_logo_2018.svg.png",
    "sportv2":   "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/SporTV_logo_2018.svg/200px-SporTV_logo_2018.svg.png",
    "sportv3":   "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/SporTV_logo_2018.svg/200px-SporTV_logo_2018.svg.png",

    # Sport TV (Portugal)
    "sporttv1": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",
    "sporttv2": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",
    "sporttv3": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",
    "sporttv4": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",
    "sporttv5": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",
    "sporttv6": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Sport_TV_Portugal_-_Logo.png/200px-Sport_TV_Portugal_-_Logo.png",

    # España
    "la1-tve":           "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/La1_2019.svg/200px-La1_2019.svg.png",
    "liga-campeones1":   "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/UEFA_Champions_League.svg/200px-UEFA_Champions_League.svg.png",
    "liga-campeones2":   "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/UEFA_Champions_League.svg/200px-UEFA_Champions_League.svg.png",
    "liga-campeones3":   "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/UEFA_Champions_League.svg/200px-UEFA_Champions_League.svg.png",
    "mplus-laligatv":    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Movistar_Plus%2B_logo.svg/200px-Movistar_Plus%2B_logo.svg.png",
    "laligatv-bar":      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/LaLiga_logo_2023.svg/200px-LaLiga_logo_2023.svg.png",
}


# -----------------------------------------------------------------------------
# Caché en disco
# -----------------------------------------------------------------------------
def _cache_dir() -> Path:
    base = Path(os.getenv("LOCALAPPDATA") or Path.home()) / "LocalTv" / "logo_cache"
    base.mkdir(parents=True, exist_ok=True)
    return base


# Singleflight: si ya hay una descarga en vuelo para este slug, esperar a esa.
_inflight: dict[str, asyncio.Task] = {}


async def _download(slug: str, url: str) -> bytes | None:
    # Wikipedia (y la mayoría de wikis) rechazan UA de browser falso. Su política
    # de bots requiere un UA identificable con app y contacto.
    # https://meta.wikimedia.org/wiki/User-Agent_policy
    headers = {
        "User-Agent": (
            "LocalTv/1.0 (FofoStudio Edition; "
            "https://github.com/FofoStudio/LocalTv-FofoStudio-Edition)"
        ),
        "Accept": "image/png,image/svg+xml,image/webp,image/*;q=0.9,*/*;q=0.5",
    }
    try:
        async with httpx.AsyncClient(headers=headers, timeout=10.0, follow_redirects=True) as c:
            r = await c.get(url)
            if r.status_code == 200 and r.content:
                return r.content
            return None
    except httpx.HTTPError:
        return None


async def fetch_logo(slug: str) -> tuple[bytes | None, str | None]:
    """
    Devuelve (bytes, content_type) del logo del canal, o (None, None) si no
    se pudo conseguir. Usa caché en disco — solo descarga la primera vez.
    """
    url = LOGO_URLS.get(slug)
    if not url:
        return None, None

    cache_path = _cache_dir() / f"{slug}.png"
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path.read_bytes(), "image/png"

    # Singleflight
    if slug in _inflight:
        data = await _inflight[slug]
    else:
        task = asyncio.create_task(_download(slug, url))
        _inflight[slug] = task
        try:
            data = await task
        finally:
            _inflight.pop(slug, None)

    if data:
        try:
            cache_path.write_bytes(data)
        except OSError:
            pass
        return data, "image/png"

    return None, None
