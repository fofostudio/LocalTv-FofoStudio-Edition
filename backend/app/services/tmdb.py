"""
Cliente TMDB para el módulo VOD (descubrimiento de películas y series).

- El token (read access token v4 de TMDB) se toma de la env TMDB_READ_TOKEN o
  de un archivo de config en el data dir del usuario (seteable vía API). Nunca
  va hardcodeado en el cliente.
- Caché en memoria con TTL para respetar el rate-limit de TMDB.

TMDB es una API pública y legal de metadata. Su ToS exige atribución
("This product uses the TMDB API but is not endorsed or certified by TMDB").
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

TMDB_BASE = "https://api.themoviedb.org/3"
_CACHE_TTL = 600  # 10 min
_cache: dict[str, tuple[float, dict]] = {}


def _data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LocalTv"
    if os.name == "nt":
        base = os.getenv("LOCALAPPDATA")
        return Path(base) / "LocalTv" if base else Path.home() / "LocalTv"
    base = os.getenv("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "LocalTv"


def _config_path() -> Path:
    return _data_dir() / "vod_config.json"


def get_token() -> str | None:
    tok = os.getenv("TMDB_READ_TOKEN")
    if tok:
        return tok.strip()
    try:
        cfg = json.loads(_config_path().read_text(encoding="utf-8"))
        t = (cfg or {}).get("tmdb_token")
        return t.strip() if t else None
    except Exception:
        return None


def set_token(token: str) -> None:
    p = _config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"tmdb_token": (token or "").strip()}), encoding="utf-8")


def has_token() -> bool:
    return bool(get_token())


def _client() -> httpx.Client:
    token = get_token()
    if not token:
        raise RuntimeError("TMDB token no configurado")
    return httpx.Client(
        base_url=TMDB_BASE,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=12.0,
    )


def _get(path: str, params: dict | None = None) -> dict:
    key = f"{path}?{json.dumps(params or {}, sort_keys=True)}"
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]
    with _client() as c:
        r = c.get(path, params={"language": "es-ES", **(params or {})})
        r.raise_for_status()
        data = r.json()
    _cache[key] = (now, data)
    return data


def trending(media_type: str = "movie") -> dict:
    mt = "tv" if media_type == "tv" else "movie"
    return _get(f"/trending/{mt}/week")


def search(query: str) -> dict:
    return _get("/search/multi", {"query": query, "include_adult": "false"})


def detail(media_type: str, tmdb_id: int) -> dict:
    mt = "tv" if media_type == "tv" else "movie"
    return _get(f"/{mt}/{tmdb_id}", {"append_to_response": "credits,videos,external_ids"})


def season(tv_id: int, number: int) -> dict:
    return _get(f"/tv/{tv_id}/season/{number}")
