"""Agenda deportiva en vivo (proxy cacheado de tarjetarojatvhd.es)."""
from __future__ import annotations

import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services import tarjetaroja_scraper

router = APIRouter(prefix="/api/diary", tags=["diary"])

_cache: dict = {"data": None, "ts": 0}
_CACHE_TTL = 60


async def _get_agenda() -> dict:
    now = time.monotonic()
    if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]
    agenda = await tarjetaroja_scraper.fetch_agenda()
    _cache["data"] = agenda
    _cache["ts"] = now
    return agenda


@router.get("/events")
async def diary_events():
    """Agenda deportiva del día (tarjetarojatvhd.es), cacheada 60s."""
    agenda = await _get_agenda()
    return JSONResponse(content=agenda, headers={"Cache-Control": "public, max-age=60"})


@router.get("/channels")
async def diary_channels():
    """Canales únicos extraídos de la agenda actual."""
    agenda = await _get_agenda()
    channels = tarjetaroja_scraper.extract_channels(agenda)
    return channels
