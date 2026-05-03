"""
Endpoint público que sirve los logos de canales con caché en disco.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services import logos as logos_service

router = APIRouter(prefix="/api/logo", tags=["logos"])


@router.get("/{slug}")
async def get_logo(slug: str):
    data, ctype = await logos_service.fetch_logo(slug)
    if not data:
        raise HTTPException(status_code=404, detail="logo not found")
    return Response(
        content=data,
        media_type=ctype or "image/png",
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            "Access-Control-Allow-Origin": "*",
        },
    )
