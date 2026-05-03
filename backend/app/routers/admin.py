"""Endpoints administrativos. Requieren X-API-Key."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.database import get_db
from app.services import scraper

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
