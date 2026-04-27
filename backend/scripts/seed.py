#!/usr/bin/env python
"""
Script para poblar la base de datos con datos iniciales.
Uso: cd backend && python scripts/seed.py
"""

import sys
sys.path.insert(0, '.')

from app.database import SessionLocal, Base, engine
from app.models.category import Category
from app.models.channel import Channel

def seed():
    """Poblar BD con categorías y canales."""
    # Crear las tablas si no existen
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    # Verificar si ya existen datos
    existing_categories = db.query(Category).count()
    if existing_categories > 0:
        print("⚠️  La BD ya tiene datos. Abortando para evitar duplicados.")
        db.close()
        return

    # Crear categorías
    categories = [
        Category(name="Deportes", slug="deportes", icon="fa-futbol"),
        Category(name="Reality", slug="reality", icon="fa-tv"),
    ]
    db.add_all(categories)
    db.flush()  # Asignar IDs sin commit
    db.refresh(categories[0])
    db.refresh(categories[1])

    deportes_id = categories[0].id

    # Crear canales
    channels = [
        Channel(
            name="ESPN",
            slug="espn",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn",
            logo_url="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 2",
            slug="espn2",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn2",
            logo_url="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 3",
            slug="espn3",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn3",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 4",
            slug="espn4",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn4",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 5",
            slug="espn5",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn5",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 6",
            slug="espn6",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn6",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="ESPN 7",
            slug="espn7",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=espn7",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="DSports",
            slug="dsports",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=dsports",
            logo_url="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/DirectTV_Sports_logo.png/200px-DirectTV_Sports_logo.png",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="DSports+",
            slug="dsports-plus",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=dsportsplus",
            category_id=deportes_id,
            is_active=True,
        ),
        Channel(
            name="DSports 2",
            slug="dsports2",
            stream_url="https://tvtvhd.com/vivo/canales.php?stream=dsports2",
            category_id=deportes_id,
            is_active=True,
        ),
    ]
    db.add_all(channels)
    db.commit()

    print("✅ Seed completado!")
    print(f"   - Categorías: {len(categories)}")
    print(f"   - Canales: {len(channels)}")
    db.close()

if __name__ == "__main__":
    seed()
