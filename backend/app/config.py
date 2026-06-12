from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./FofoLocalTv.db"
    SECRET_API_KEY: str = "fofolocaltv-dev-secret-key-changeme"
    BACKEND_URL: str = "http://localhost:8000"

    # Credenciales Xtream (Magma / cualquier panel). HORNEADAS por defecto para
    # que el catálogo Magma venga activo de fábrica en las 3 apps (Win/Mac/Android),
    # igual que la firma horneada en frontend/src/services/magma.js y la semilla
    # de Android (mobile/public-seed/channels.json). Cualquiera puede sobreescribir
    # estos valores con su propio panel poniéndolos en el .env del backend.
    XTREAM_HOST: str = "http://tv.m3uts.xyz"
    XTREAM_USERNAME: str = "m"
    XTREAM_PASSWORD: str = "m"
    XTREAM_OUTPUT: str = "ts"
    # Token de sesión del panel Magma/TVClub. Si está seteado, las URLs de stream
    # se construyen como {host}/stream/secure/{token}/{stream_id}.m3u8
    # (patrón real reverseado por captura ADB). Resuelve TODO el catálogo.
    XTREAM_TOKEN: str = "vr5Tqs43"
    # Firma de dispositivo de la app Magma (capturada por ADB). Sin estos headers
    # el panel puede servir un stream placeholder de "actualización". Son del
    # dispositivo/cuenta: X-Did = android_id, X-Hash = generateHash(libmagma.so).
    # Mismos valores que MAGMA_SIG en frontend/src/services/magma.js.
    XTREAM_XHASH: str = "BDOpQCvSDlbbHGgHGESN4dpDr5eR34_5XLbL-AuuMIopHbTX1pR6OcpbgsfERm2lmbRuoGfHKmVPe0YHHCObB5tdSa2rr3spWobsEBfnTw2QDfNrJmfts8n8wvHF9z24FFgwD7KWyyO7rpxZGSwXcfG8dtgIR294XjgwjXzc30T29QwatFTRHQuucTazn97OUAKi65E2DjLF1UACDzjIOeaei9VkM_IGNiu7x-3L1GrLjbt7HrvhcXJ12BE43wPpoFEfKHfrksAkWRP-0zboNiSBuJ2RjWpKx8KOADbWOMKt8hklYSsRnIPH5gzlzq-BFVoOjpajzUOW73HqkjPEE-muJlvsg8DK4NkN8_aTfMreMYcO7keCzPjjrIEoNzRyNIx68JsKNdjHq8HGEyBhjWxCuR5uzwZJmEhMaIbnnlVO1vb_IuvaiUbJL6uyITp5Uws9IdV8bPmrtBV90DnqyOTf9GvJ9KC3cAypVjy_LTRpMgbdPYtEbo8mV13j5HoXSgWmIJQ5h7o0zYfZeNd6PQ"
    XTREAM_XDID: str = "8556eddcd454679f"
    XTREAM_XVERSION: str = "10/1.0.9"

    # Activación por defecto: SOLO el catálogo Magma viene activo. Los demás
    # orígenes (tvtvhd, iptv-org) se siembran pero quedan INACTIVOS (se muestran
    # con badge "INACTIVO" y no reproducen) hasta que se activen desde config:
    # poné ACTIVATE_NON_MAGMA=true en el .env del backend y reiniciá.
    # El flag es la fuente de verdad: en cada arranque se reconcilia la activación
    # de los canales no-Magma para que coincida con este valor.
    ACTIVATE_NON_MAGMA: bool = False

    class Config:
        env_file = ".env"

settings = Settings()
