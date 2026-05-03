"""
Seed inicial de la BD con categorías y canales únicos (sin duplicados).
Idempotente: si ya hay datos, no toca nada.

Uso:
    cd backend && python -m scripts.seed
"""

from app.database import SessionLocal, Base, engine
from app.models.category import Category
from app.models.channel import Channel


def _channels_for(category_id: int) -> list[Channel]:
    """Lista canónica de canales (sin duplicados)."""
    raw = [
        ("ESPN", "espn", "espnmx", "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png"),
        ("ESPN 2", "espn2", "espn2mx", "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png"),
        ("ESPN 3", "espn3", "espn3mx", None),
        ("ESPN 4", "espn4", "espn4mx", None),
        ("ESPN 5", "espn5", "espn5", None),
        ("ESPN 6", "espn6", "espn6", None),
        ("ESPN 7", "espn7", "espn7", None),
        ("DSports", "dsports", "dsports", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/DirectTV_Sports_logo.png/200px-DirectTV_Sports_logo.png"),
        ("DSports+", "dsports-plus", "dsportsplus", None),
        ("DSports 2", "dsports2", "dsports2", None),
        ("GOLTV", "goltv", "goltv", None),
        ("VTV Plus", "vtvplus", "vtvplus", None),
        ("ECDF LigaPro (eventos)", "ecdf-ligapro", "ecdfligapro(eventos)", None),
        ("Fox Sports", "foxsports", "foxsports", None),
        ("Fox Sports 2", "foxsports2", "foxsports2", None),
        ("Fox Sports 3", "foxsports3", "foxsports3", None),
        ("TNT Sports", "tntsports", "tntsports", None),
        ("ESPN Premium", "espn-premium", "espnpremium", None),
        ("TyC Sports", "tycsports", "tycsports", None),
        ("TyC Sports Internacional", "tycsports-internacional", "tycsportsinternacional(usa)", None),
        ("Telefe", "telefe", "telefe", None),
        ("TV Pública", "tv-publica", "tvpública", None),
        ("GOLPERU", "golperu", "golperu", None),
        ("Liga1 MAX", "liga1-max", "liga1max", None),
        ("Movistar Deportes", "movistar-deportes", "movistardeportes", None),
        ("Win Sports Plus", "winsports-plus", "winsportsplus", None),
        ("Win Sports", "winsports", "winsports", None),
        ("Fox Sports Premium", "foxsports-premium", "foxsportspremium", None),
        ("TUDN", "tudn", "tudn", None),
        ("Caliente TV", "caliente-tv", "calientetv", None),
        ("Azteca 7", "azteca7", "azteca7", None),
        ("Canal 5", "canal5", "canal5", None),
        ("TVC Deportes", "tvc-deportes", "tvcdeportes", None),
        ("Azteca Deportes", "azteca-deportes", "aztecadeportes", None),
        ("Hisports", "hisports", "hisports", None),
        ("Sky Sports LaLiga", "sky-sports-laliga", "skysportslaliga", None),
        ("Sky Sports Bundesliga", "sky-sports-bundesliga", "skysportsbundesliga", None),
        ("Fox Deportes", "fox-deportes", "foxdeportes", None),
        ("ESPN Deportes", "espn-deportes", "espndeportes", None),
        ("Univisión", "univision", "univisión", None),
        ("Fox Sports 1", "foxsports1", "foxsports1", None),
        ("Universo", "universo", "universo", None),
        ("BeIN Sports Español", "bein-sports-espanol", "beinsportsespañol", None),
        ("Unimás", "unimas", "unimás", None),
        ("BeIN Sports Xtra Español", "bein-sports-xtra-espanol", "beinsportsxtraespañol", None),
        ("ESPN U", "espnu", "espnu", None),
        ("CBS Sports Network", "cbs-sports-network", "cbssportsnetwork", None),
        ("USA Network", "usa-network", "usanetwork", None),
        ("Telemundo", "telemundo", "telemundo", None),
        ("TNT Sports Chile", "tnt-sports-chile", "tntsportschile", None),
        ("Premiere 1", "premiere1", "premiere1", None),
        ("Premiere 2", "premiere2", "premiere2", None),
        ("Premiere 3", "premiere3", "premiere3", None),
        ("Premiere 4", "premiere4", "premiere4", None),
        ("Premiere 5", "premiere5", "premiere5", None),
        ("Premiere 6", "premiere6", "premiere6", None),
        ("Premiere 7", "premiere7", "premiere7", None),
        ("Premiere 8", "premiere8", "premiere8", None),
        ("Sportv", "sportv", "sportv", None),
        ("Sportv 2", "sportv2", "sportv2", None),
        ("Sportv 3", "sportv3", "sportv3", None),
        ("Sport TV 1", "sporttv1", "sporttv1", None),
        ("Sport TV 2", "sporttv2", "sporttv2", None),
        ("Sport TV 3", "sporttv3", "sporttv3", None),
        ("Sport TV 4", "sporttv4", "sporttv4", None),
        ("Sport TV 5", "sporttv5", "sporttv5", None),
        ("Sport TV 6", "sporttv6", "sporttv6", None),
        ("Canal 11", "canal11", "canal11", None),
        ("Dazn Eleven 1", "dazn-eleven1", "dazneleven1", None),
        ("Dazn Eleven 2", "dazn-eleven2", "dazneleven2", None),
        ("Dazn Eleven 3", "dazn-eleven3", "dazneleven3", None),
        ("Dazn Eleven 4", "dazn-eleven4", "dazneleven4", None),
        ("Dazn Eleven 5", "dazn-eleven5", "dazneleven5", None),
        ("Dazn Eleven 6", "dazn-eleven6", "dazneleven6", None),
        ("DAZN 1", "dazn1", "dazn1", None),
        ("DAZN 2", "dazn2", "dazn2", None),
        ("DAZN 3 (eventos)", "dazn3-eventos", "dazn3(eventos)", None),
        ("DAZN 4 (eventos)", "dazn4-eventos", "dazn4(eventos)", None),
        ("DAZN LaLiga", "dazn-laliga", "daznlaliga", None),
        ("La 1 TVE", "la1-tve", "la1tve", None),
        ("Liga de Campeones 1", "liga-campeones1", "ligadecampeones1", None),
        ("Liga de Campeones 2", "liga-campeones2", "ligadecampeones2", None),
        ("Liga de Campeones 3", "liga-campeones3", "ligadecampeones3", None),
        ("M+ LaLiga TV", "mplus-laligatv", "mpluslaligatv", None),
        ("LaLigaTV BAR", "laligatv-bar", "laligatvbar", None),
        ("Sky Bundesliga 1", "sky-bundesliga1", "skybundesliga1", None),
        ("Sky Bundesliga 2", "sky-bundesliga2", "skybundesliga2", None),
        ("Sky Bundesliga 3", "sky-bundesliga3", "skybundesliga3", None),
        ("Sky Bundesliga 4", "sky-bundesliga4", "skybundesliga4", None),
        ("Sky Bundesliga 5", "sky-bundesliga5", "skybundesliga5", None),
        ("DAZN 1 DE", "dazn1-de", "dazn1de", None),
        ("DAZN 2 DE", "dazn2-de", "dazn2de", None),
        ("ESPN 1 NL", "espn1-nl", "espn1nl", None),
        ("ESPN 2 NL", "espn2-nl", "espn2nl", None),
        ("ESPN 3 NL", "espn3-nl", "espn3nl", None),
        ("Dazn Eleven Pro 1 BE", "dazn-eleven-pro1-be", "daznelevenpro1be", None),
    ]
    return [
        Channel(
            name=name,
            slug=slug,
            stream_url=f"https://tvtvhd.com/vivo/canales.php?stream={stream}",
            logo_url=logo,
            category_id=category_id,
            is_active=True,
        )
        for (name, slug, stream, logo) in raw
    ]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Category).count() > 0:
            return  # ya hay datos, idempotente

        deportes = Category(name="Deportes", slug="deportes", icon="fa-futbol")
        reality = Category(name="Reality", slug="reality", icon="fa-tv")
        db.add_all([deportes, reality])
        db.flush()

        db.add_all(_channels_for(deportes.id))
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
    print("[OK] Seed completado")
