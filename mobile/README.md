# LocalTv Android — Versión 100% local

App Android nativa que **no necesita PC**: lleva todo adentro (frontend, base
de datos, proxy HLS). Construida con Capacitor 6 + un plugin Kotlin propio.

## Cómo funciona

```
┌──────────────────────────────────────────────┐
│ APK LocalTv (Android)                        │
│                                              │
│  ┌─────────────────┐                         │
│  │   WebView       │   <─── HLS player      │
│  │  (React UI)     │                         │
│  │  + SQLite local │                         │
│  └────────┬────────┘                         │
│           │ HTTP                             │
│           ▼                                  │
│  ┌─────────────────┐                         │
│  │ HlsProxyServer  │                         │
│  │ Kotlin/NanoHTTPD│   ──── OkHttp con      │
│  │ 127.0.0.1:rand  │       Referer header   │
│  └─────────────────┘                         │
└────────────┬─────────────────────────────────┘
             │
             ▼ Internet (con Referer)
        tvtvhd.com
```

El bit clave: el WebView **no puede setear `Referer`** desde JS (es un
"forbidden header" del fetch spec). El plugin Kotlin sí puede, así que actúa
de proxy en `127.0.0.1:<puerto-random>` solo accesible por la propia app.

## Compilar el APK desde Windows

### Requisitos

| Tool | Versión | Cómo instalar |
|---|---|---|
| Java JDK | 17 | `winget install --id Microsoft.OpenJDK.17` |
| Android Studio | Hedgehog+ | https://developer.android.com/studio |
| Node.js | 18+ | (ya lo tienes) |

Después de instalar Android Studio, abrirlo una vez para que descargue el
SDK (acepta los licenses). Verifica que `ANDROID_HOME` apunta al SDK:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

### Pasos

```powershell
cd D:\LocalTv-FofoStudio-Edition\mobile

# 1) Instalar deps de Capacitor
npm install

# 2) Buildear el frontend y copiarlo a mobile/public/
npm run frontend:build
npm run frontend:copy

# 3) Generar el proyecto Android (la primera vez, una vez)
npx cap add android

# 4) Copiar el plugin Kotlin al proyecto generado
node scripts/install-plugin.mjs

# 5) Sync y abrir Android Studio
npx cap sync android
npx cap open android
```

En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
El APK queda en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Para release firmado:

```powershell
# Generar keystore (una vez)
keytool -genkey -v -keystore localtv-release.jks `
  -keyalg RSA -keysize 2048 -validity 10000 -alias localtv

# Build release
cd mobile/android
./gradlew assembleRelease
```

### Verificar en un dispositivo

Conecta el celu por USB con depuración habilitada y:

```powershell
npx cap run android
```

O instala el APK manualmente: `adb install app-debug.apk`.

## Estructura

```
mobile/
├── package.json              # deps Capacitor + scripts
├── capacitor.config.ts       # appId, webDir, allowMixedContent...
├── public/                   # copiado de frontend/dist (gitignored)
├── public-seed/
│   └── channels.json         # 96 canales (seed inicial)
├── scripts/
│   ├── copy-frontend.mjs     # frontend/dist -> public/
│   └── install-plugin.mjs    # copia android-plugin/ -> android/app/...
├── android-plugin/           # plugin Kotlin (fuente)
│   ├── HlsProxyPlugin.kt     # @CapacitorPlugin que expone start()/stop()
│   └── HlsProxyServer.kt     # NanoHTTPD que hace el proxy
└── android/                  # generado por `cap add android` (gitignored)
```

## Diferencias vs la versión desktop

| Concepto | Desktop (.exe / .dmg) | Móvil (APK) |
|---|---|---|
| Backend | FastAPI + uvicorn | NanoHTTPD en Kotlin (solo HLS proxy) |
| Base de datos | SQLite via SQLAlchemy | SQLite via `@capacitor-community/sqlite` |
| Lista de canales | Seed Python en startup | `public-seed/channels.json` cargado al primer arranque |
| Sincronizar canales | `POST /api/admin/sync-channels` | Scrape JS con `CapacitorHttp` |
| Health check | `GET /api/streams/health` | Probes paralelos JS con `CapacitorHttp` |
| Reproductor | Clappr + hls.js (browser) | Clappr + hls.js (WebView) o ExoPlayer en futuro |

## Limitaciones / TODO

- [x] Plugin Kotlin proxy HLS con Referer
- [x] Capacitor config + scaffolding
- [ ] `install-plugin.mjs` — copia android-plugin/*.kt al proyecto generado y
      registra el plugin en MainActivity
- [ ] Reescribir `services/api.js` con rama `isCapacitor()` que use
      `@capacitor-community/sqlite`
- [ ] Reescribir scraper de tvtvhd en JS (lee HTML con CapacitorHttp y
      regex equivalente al de `backend/app/services/scraper.py`)
- [ ] Cargar `public-seed/channels.json` al primer arranque
- [ ] CI: job en GitHub Actions con `runs-on: ubuntu-latest` + Android SDK
      action que produce APK debug y lo adjunta al Release
- [ ] Considerar ExoPlayer nativo en lugar de hls.js para mejor calidad de
      reproducción en celulares de gama baja

## Licencia

MIT (mismo que el proyecto).
