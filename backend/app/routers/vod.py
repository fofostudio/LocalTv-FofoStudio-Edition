"""
Router VOD — descubrimiento de películas/series + resolución de fuentes.

Capas:
- TMDB para metadata (descubrimiento)
- vod_scraper (Provider/Extractor tipo Streamflix) para resolución de fuentes
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import tmdb
from app.services import vod_scraper

router = APIRouter(prefix="/api/vod", tags=["vod"])


class TokenPayload(BaseModel):
    token: str


class ResolvePayload(BaseModel):
    media_type: str
    tmdb_id: int
    season: int | None = None
    episode: int | None = None
    title: str | None = None
    year: str | int | None = None
    source_url: str | None = None


@router.get("/config")
def get_config():
    return {"has_token": tmdb.has_token()}


@router.post("/config")
def set_config(payload: TokenPayload):
    tmdb.set_token(payload.token)
    return {"has_token": tmdb.has_token()}


def _need_token():
    if not tmdb.has_token():
        raise HTTPException(status_code=412, detail="Configura tu token de TMDB en Ajustes")


@router.get("/trending")
def get_trending(type: str = "movie"):
    _need_token()
    try:
        return tmdb.trending(type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB: {e}")


@router.get("/search")
def get_search(q: str):
    _need_token()
    if not q.strip():
        return {"results": []}
    try:
        return tmdb.search(q)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB: {e}")


@router.get("/cine/catalog")
async def cine_catalog(kind: str = "movie", page: int = 1):
    """Catálogo de CineCalidad (sin TMDB) — para poblar la zona de pelis."""
    items = await vod_scraper.cinecalidad_catalog(kind=kind, page=page)
    return {"results": items}


@router.get("/cine/search")
async def cine_search(q: str, page: int = 1):
    """Búsqueda en CineCalidad (sin TMDB)."""
    items = await vod_scraper.cinecalidad_search(q, page=page)
    return {"results": items}


@router.get("/cine/detail")
async def cine_detail(url: str):
    """Sinopsis + géneros + año + rating de una ficha (sin TMDB)."""
    return await vod_scraper.site_detail(url)


@router.get("/cine/estrenos")
async def cine_estrenos(kind: str = "movie", page: int = 1):
    """Estrenos / lo último (agregado de todos los sitios)."""
    items = await vod_scraper.latino_estrenos(kind=kind, page=page)
    return {"results": items}


@router.get("/cine/clasicas")
async def cine_clasicas(kind: str = "movie", page: int = 1):
    """Películas clásicas (años antiguos)."""
    items = await vod_scraper.latino_clasicas(kind=kind, page=page)
    return {"results": items}


@router.get("/cine/genres")
def cine_genres():
    """Lista de categorías/géneros disponibles."""
    return {"genres": vod_scraper.genre_list()}


@router.get("/cine/genre")
async def cine_genre(slug: str, kind: str = "movie", page: int = 1):
    """Catálogo de un género (agregado de todos los sitios)."""
    items = await vod_scraper.latino_genre(slug, kind=kind, page=page)
    return {"results": items}


@router.get("/{media_type}/{tmdb_id}")
def get_detail(media_type: str, tmdb_id: int):
    _need_token()
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type debe ser movie o tv")
    try:
        return tmdb.detail(media_type, tmdb_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB: {e}")


@router.get("/tv/{tv_id}/season/{number}")
def get_season(tv_id: int, number: int):
    _need_token()
    try:
        return tmdb.season(tv_id, number)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB: {e}")


@router.post("/resolve")
async def resolve(payload: ResolvePayload):
    """
    Resuelve un TMDB ID a fuentes reproducibles (tipo Streamflix).

    Prueba múltiples providers (vidsrc.to, 2embed, etc.) en orden de
    preferencia. Si el extractor puede extraer un .m3u8 directo lo devuelve;
    sino devuelve la URL de embed como fallback para iframe.
    """
    try:
        return await vod_scraper.resolve(
            media_type=payload.media_type,
            tmdb_id=payload.tmdb_id,
            season=payload.season,
            episode=payload.episode,
            title=payload.title,
            year=payload.year,
            source_url=payload.source_url,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
