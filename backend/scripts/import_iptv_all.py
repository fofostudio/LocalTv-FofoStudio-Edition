"""
Importa TODOS los canales de iptv-org/iptv a la BD local.
Uso: python -m scripts.import_iptv_all
"""
import asyncio
from app.database import SessionLocal, Base, engine
from app.services.iptv_scraper import fetch_all_categories, import_all_to_db


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        all_channels = asyncio.run(fetch_all_categories())
        total = sum(len(v) for v in all_channels.values())
        print(f"Encontrados {total} canales en {len(all_channels)} categorias")
        for slug, chs in sorted(all_channels.items()):
            print(f"  {slug}: {len(chs)} canales")

        stats = import_all_to_db(db, all_channels)
        print(f"\nCreados: {stats['created']}")
        print(f"Omitidos: {stats['skipped']}")
        print(f"URLs largas: {stats['too_long']}")
        print(f"Total procesados: {stats['total']}")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    run()
