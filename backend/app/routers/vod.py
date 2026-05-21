"""
Router VOD — descubrimiento de películas/series vía TMDB.

Incluye SOLO la capa legítima: metadata (TMDB) y un endpoint /resolve que es un
punto de extensión enchufable. NO se incluyen scrapers de sitios de embed:
conectá ahí únicamente fuentes que tengas autorización de usar.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import tmdb

router = APIRouter(prefix="/api/vod", tags=["vod"])


class TokenPayload(BaseModel):
    token: str


class ResolvePayload(BaseModel):
    media_type: str
    tmdb_id: int
    season: int | None = None
    episode: int | None = None


@router.get("/config")
def get_config():
    return {"has_token": tmdb.has_token()}


@router.post("/config")
def set_config(payload: TokenPayload):
    tmdb.set_token(payload.token)
    return {"has_token": tmdb.has_token()}


def _need_token():
    if not tmdb.has_token():
        raise HTTPException(status_code=412, detail="Configurá tu token de TMDB en Ajustes")


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
def resolve(_: ResolvePayload):
    """
    Punto de extensión: debe devolver fuentes reproducibles para el ítem dado,
    p.ej. {"sources": [{"url": "...", "kind": "hls|mp4", "quality": "1080p",
    "headers": {...}}]}.

    Por defecto no hay ninguna fuente conectada. Conectá aquí únicamente
    proveedores que estés autorizado a usar (tu propio contenido, dominio
    público, APIs con licencia, etc.).
    """
    return {
        "sources": [],
        "detail": "No hay ningún resolver de fuentes configurado.",
    }
