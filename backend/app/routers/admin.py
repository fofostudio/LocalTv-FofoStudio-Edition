"""Endpoints administrativos. Requieren X-API-Key."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.database import get_db
from app.services import scraper, iptv_scraper, xtream_scraper

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/sync-channels", dependencies=[Depends(require_api_key)])
async def sync_channels(db: Session = Depends(get_db)):
    """
    Scrapea tvtvhd.com y hace upsert de canales:
    - inserta los nuevos
    - actualiza la stream_url de los existentes (por slug)
    - no borra los que dejaron de aparecer en el scrape
    """
    try:
        scraped = await scraper.fetch_channels()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error scrapeando fuente: {e}")

    if not scraped:
        raise HTTPException(
            status_code=502,
            detail="El scraper no devolvió canales. La fuente puede haber cambiado.",
        )

    stats = scraper.upsert_channels(db, scraped)
    return {"ok": True, **stats}


@router.get("/iptv-categories", dependencies=[Depends(require_api_key)])
def list_iptv_categories():
    """Devuelve las categorías disponibles para importar desde iptv-org."""
    return iptv_scraper.list_available_categories()


@router.post("/import-iptv", dependencies=[Depends(require_api_key)])
async def import_iptv(
    category: str = Query(..., description="Slug de categoría a importar"),
    db: Session = Depends(get_db),
):
    """
    Importa canales desde iptv-org/iptv para una categoría específica.
    Solo inserta canales nuevos (no duplica ni actualiza existentes).
    Auto-crea la categoría local si no existe.
    """
    available = {c["slug"] for c in iptv_scraper.list_available_categories()}
    if category not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Categoría no disponible. Opciones: {', '.join(sorted(available))}",
        )

    try:
        channels = await iptv_scraper.fetch_category(category)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Error al obtener playlist de iptv-org: {e}",
        )

    if not channels:
        raise HTTPException(
            status_code=502,
            detail="No se encontraron canales en la playlist.",
        )

    stats = iptv_scraper.import_to_db(db, channels)
    return {"ok": True, "category": category, **stats}


@router.post("/import-iptv-all", dependencies=[Depends(require_api_key)])
async def import_iptv_all(db: Session = Depends(get_db)):
    """
    Importa canales desde TODAS las categorías de iptv-org/iptv a la vez.
    Auto-crea las categorías locales que falten.
    """
    try:
        all_channels = await iptv_scraper.fetch_all_categories()
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Error al obtener playlists de iptv-org: {e}",
        )

    if not all_channels:
        raise HTTPException(
            status_code=502,
            detail="No se encontraron canales en ninguna playlist.",
        )

    stats = iptv_scraper.import_all_to_db(db, all_channels)
    categories_imported = list(all_channels.keys())
    return {
        "ok": True,
        "categories_imported": categories_imported,
        **stats,
    }


@router.post("/import-country", dependencies=[Depends(require_api_key)])
async def import_country(
    code: str = Query(..., description="Código ISO 3166-1 alpha-2 (ej: co, es, mx, ar)"),
    db: Session = Depends(get_db),
):
    """Importa canales desde un playlist por país de iptv-org (ej: co.m3u)."""
    code = code.lower()
    label = iptv_scraper.SPANISH_COUNTRY_CODES.get(code, code)
    try:
        channels = await iptv_scraper.fetch_country(code)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Error al obtener playlist del país {code}: {e}",
        )
    if not channels:
        raise HTTPException(status_code=502, detail="No se encontraron canales.")
    stats = iptv_scraper.import_to_db(db, channels)
    return {"ok": True, "country": code, "country_label": label, **stats}


@router.post("/import-spain-sources", dependencies=[Depends(require_api_key)])
async def import_spain_sources(db: Session = Depends(get_db)):
    """Importa canales desde Free-TV/IPTV (España) y TDTChannels."""
    results = {}
    errors = []

    try:
        ftv = await iptv_scraper.fetch_free_tv_spain()
        if ftv:
            s = iptv_scraper.import_spanish_to_db(db, ftv)
            results["free_tv_spain"] = {"channels": len(ftv), **s}
    except Exception as e:
        errors.append(f"Free-TV Spain: {e}")
        results["free_tv_spain"] = {"error": str(e)}

    try:
        tdt = await iptv_scraper.fetch_tdt_channels()
        if tdt:
            s = iptv_scraper.import_spanish_to_db(db, tdt)
            results["tdt_channels"] = {"channels": len(tdt), **s}
    except Exception as e:
        errors.append(f"TDTChannels: {e}")
        results["tdt_channels"] = {"error": str(e)}

    return {"ok": True, "results": results, "errors": errors if errors else None}


@router.post("/import-colombia-sources", dependencies=[Depends(require_api_key)])
async def import_colombia_sources(db: Session = Depends(get_db)):
    """Importa canales desde streamingcolombia (iemejia) + iptv-org Colombia."""
    results = {}
    errors = []

    try:
        co = await iptv_scraper.fetch_tv_colombia()
        if co:
            s = iptv_scraper.import_spanish_to_db(db, co)
            results["tv_colombia"] = {"channels": len(co), **s}
    except Exception as e:
        errors.append(f"TV Colombia: {e}")
        results["tv_colombia"] = {"error": str(e)}

    try:
        community = iptv_scraper.fetch_community_colombia()
        if community:
            s = iptv_scraper.import_to_db(db, community)
            results["community"] = {"channels": len(community), **s}
    except Exception as e:
        errors.append(f"Community Colombia: {e}")
        results["community"] = {"error": str(e)}

    return {"ok": True, "results": results, "errors": errors if errors else None}


@router.get("/magma-token-status", dependencies=[Depends(require_api_key)])
async def magma_token_status():
    """Prueba el token/firma Magma contra un canal: alive / expired."""
    import httpx
    from app.config import settings
    host = (settings.XTREAM_HOST or "").rstrip("/")
    tok = settings.XTREAM_TOKEN
    if not (host and tok):
        return {"configured": False, "alive": False}
    headers = {"User-Agent": "Magma Player/10"}
    if settings.XTREAM_XHASH:
        headers.update({"X-App": "di", "X-Version": settings.XTREAM_XVERSION,
                        "X-Hash": settings.XTREAM_XHASH, "X-Did": settings.XTREAM_XDID})
    url = f"{host}/stream/secure/{tok}/1041.m3u8"
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(url, headers=headers)
        body = r.text[:400]
        alive = r.status_code == 200 and "#EXTM3U" in body
        placeholder = "magma_playstore" in body or "/videos/" in body
        return {
            "configured": True,
            "alive": alive and not placeholder,
            "placeholder": placeholder,
            "status": r.status_code,
            "hint": "Token OK" if (alive and not placeholder)
            else "Token vencido o placeholder → corré: python tools/magma_refresh.py",
        }
    except Exception as e:
        return {"configured": True, "alive": False, "error": str(e)}


@router.get("/xtream-status", dependencies=[Depends(require_api_key)])
def xtream_status():
    """Estado de la integración Xtream: si hay credenciales y cuántos canales en el dump."""
    try:
        dump = xtream_scraper.load_catalog_dump()
    except Exception as e:
        dump = []
        return {
            "configured": xtream_scraper.is_configured(),
            "catalog_channels": 0,
            "error": str(e),
        }
    return {
        "configured": xtream_scraper.is_configured(),
        "catalog_channels": len(dump),
    }


@router.post("/import-xtream", dependencies=[Depends(require_api_key)])
async def import_xtream(
    provider: str = Query("Magma", description="Etiqueta del proveedor (region)"),
    live: bool = Query(
        False,
        description="True: consulta el panel con las credenciales del .env. "
        "False: usa el dump de catálogo local.",
    ),
    strict: bool = Query(
        False, description="True: aplica el filtro de español estricto."
    ),
    db: Session = Depends(get_db),
):
    """
    Importa canales Xtream (Magma u otro panel) — solo en español.

    - `live=true`  → consulta {host}/player_api.php con XTREAM_* del .env.
    - `live=false` → importa el catálogo local (backend/playlists/magma/*).

    Las URLs reproducibles se construyen si hay credenciales configuradas;
    de lo contrario los canales quedan inactivos (catálogo) hasta que se
    configuren XTREAM_HOST / XTREAM_USERNAME / XTREAM_PASSWORD.
    """
    try:
        if live:
            channels = await xtream_scraper.fetch_live_streams()
        else:
            channels = xtream_scraper.load_catalog_dump()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error obteniendo canales Xtream: {e}")

    if not channels:
        raise HTTPException(
            status_code=502,
            detail="No se encontraron canales (dump vacío o panel sin respuesta).",
        )

    stats = xtream_scraper.import_xtream(
        db, channels, provider=provider, strict_spanish=strict
    )
    if stats.get("error"):
        raise HTTPException(status_code=500, detail=stats["error"])
    return {"ok": True, "mode": "live" if live else "catalog", **stats}


@router.post("/verify-channels", dependencies=[Depends(require_api_key)])
async def verify_channels(
    provider: str = Query(
        "", description="Región/proveedor a verificar (ej: Magma). Vacío = todos."
    ),
    db: Session = Depends(get_db),
):
    """Prueba las URLs y deja activos solo los canales que reproducen."""
    stats = await xtream_scraper.verify_and_prune(db, provider=provider or None)
    return {"ok": True, **stats}


@router.post("/prune-dead", dependencies=[Depends(require_api_key)])
def prune_dead(
    provider: str = Query("", description="Región a limpiar (ej: Magma). Vacío = todos."),
    db: Session = Depends(get_db),
):
    """Borra los canales inactivos (muertos) para dejar la lista limpia."""
    stats = xtream_scraper.prune_inactive(db, provider=provider or None)
    return {"ok": True, **stats}


@router.post("/cleanup-non-spanish", dependencies=[Depends(require_api_key)])
def cleanup_non_spanish(db: Session = Depends(get_db)):
    """Elimina de la BD los canales que el clasificador considera no hispanos."""
    stats = iptv_scraper.delete_non_spanish_channels(db)
    return {"ok": True, **stats}
