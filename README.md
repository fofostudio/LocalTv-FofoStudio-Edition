# LocalTv — FofoStudio Edition

Plataforma de streaming en vivo. Pensada para correr en local o en tu red, con una UI moderna estilo Netflix e instaladores nativos de un solo clic para **Windows** (`.exe`) y **macOS** (`.dmg`).

> **Repositorio:** https://github.com/FofoStudio/LocalTv-FofoStudio-Edition

## Hay dos formas de usar LocalTv

| Eres... | Usa esto | Necesitas |
|---------|----------|-----------|
| **Usuario final** (solo quieres ver TV) | El instalador `.exe` / `.dmg` ↓ | Windows 10/11 o macOS 11+ |
| **Desarrollador** (clonar, modificar, contribuir) | El flujo de desarrollo ↓ | Python 3.11–3.13, Node.js 18+ |

---

## 🚀 Para usuarios finales

### Windows — `.exe`

1. Descarga `LocalTv-Setup-1.0.0.exe` desde la sección **Releases** del repo.
2. Doble clic. Sigue el asistente (no requiere admin).
3. Aparece un acceso directo "**LocalTv**" en tu escritorio. Doble clic y listo.

App en `%LOCALAPPDATA%\Programs\LocalTv`, datos de usuario (BD SQLite, favoritos…) en `%LOCALAPPDATA%\LocalTv`. Desinstala desde **Configuración → Aplicaciones**.

### macOS — `.dmg`

1. Descarga `LocalTv-1.0.0.dmg` desde **Releases**.
2. Doble clic, arrastra **LocalTv** a la carpeta **Aplicaciones**.
3. Ábrelo desde Launchpad o Spotlight (la primera vez puede pedir confirmación de Gatekeeper porque la app no está firmada con un Developer ID — clic derecho → Abrir).

Datos de usuario en `~/Library/Application Support/LocalTv/`. Para desinstalar, mueve `LocalTv.app` a la papelera.

> **Para acceder desde la TV o el celular en la misma red:** abre LocalTv en la PC, mira la URL en la ventana de control, y úsala desde otros dispositivos cambiando `localhost` por la IP de tu PC.

---

## 🛠️ Para desarrolladores

### Stack

| Capa     | Tecnología                                                  |
|----------|-------------------------------------------------------------|
| Frontend | React 19 · Vite 8 · React Router 7 · CSS Modules            |
| Backend  | FastAPI · Uvicorn · SQLAlchemy 2 · SQLite · Pydantic 2      |
| Empaque  | PyInstaller (one-folder) · Inno Setup 6 · Pillow (icon gen) |
| Runtime  | Python **3.11 / 3.12 / 3.13** · Node.js **18+**             |

> **Python 3.14 no es compatible**: `pydantic-core` aún no publica wheels.

### Modo desarrollo (un comando)

```powershell
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
.\setup.ps1            # Windows PowerShell
```

```cmd
setup.bat              :: Windows CMD
```

```bash
chmod +x setup.sh && ./setup.sh   # Linux / macOS
```

El script detecta dependencias, crea el venv, instala todo y arranca:

- Frontend: http://localhost:5173
- Backend:  http://localhost:8000
- Swagger:  http://localhost:8000/docs

### Generar el instalador

#### Windows (`.exe` con Inno Setup)

```powershell
.\build.ps1
```

Esto:

1. Detecta Python e instala **Inno Setup** automáticamente vía `winget` si falta.
2. Crea el venv del backend con `requirements-build.txt` (incluye PyInstaller + Pillow).
3. Genera el ícono `installer/icon.ico` con Pillow.
4. Builda el frontend (`npm run build`) → `frontend/dist/`.
5. Compila el backend con PyInstaller → `dist/LocalTv/LocalTv.exe`.
6. Compila el instalador con Inno Setup → `dist/LocalTv-Setup-1.0.0.exe`.

Flags útiles:

```powershell
.\build.ps1 -Clean           # limpia dist/, build/, frontend/dist antes
.\build.ps1 -SkipFrontend    # reusa frontend/dist existente
.\build.ps1 -SkipInstaller   # solo genera la app portable, no el .exe instalable
```

#### macOS (`.app` + `.dmg` con hdiutil)

```bash
chmod +x build.sh
./build.sh
```

Esto:

1. Detecta `python3.11/3.12/3.13` y Node.js 18+ (instala con `brew` si falta).
2. Crea el venv del backend con `requirements-build.txt`.
3. Genera `installer/icon.icns` (usa `iconutil` de Xcode CLT, fallback a Pillow).
4. Builda el frontend (`npm run build`).
5. Compila con PyInstaller → `dist/LocalTv.app` (bundle nativo con Info.plist).
6. Empaqueta con `hdiutil` → `dist/LocalTv-1.0.0.dmg` (con symlink a /Applications para drag-and-drop).

Flags útiles:

```bash
./build.sh --clean           # limpia dist/, build/, frontend/dist antes
./build.sh --skip-frontend   # reusa frontend/dist existente
./build.sh --skip-dmg        # solo genera el .app, no el DMG
```

> El `.app` no está firmado con Developer ID (Apple cobra US$99/año). Los usuarios verán un aviso de Gatekeeper la primera vez — clic derecho → **Abrir** lo soluciona.

#### Build automático en GitHub Actions

`.github/workflows/build-installers.yml` builda **ambas plataformas en paralelo** en cada push a `main`, manualmente desde la pestaña **Actions**, o automáticamente al hacer push de un tag `vX.Y.Z`.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Eso dispara dos jobs (`windows-latest` + `macos-latest`), genera `.exe` y `.dmg`, y publica un GitHub Release con ambos binarios adjuntos. El workflow incluye cache de pip y npm para iterar rápido.

### Sincronizar canales desde tvtvhd.com

El backend incluye un scraper en Python (`backend/app/services/scraper.py`) que reemplaza los antiguos scripts de Node + Playwright. Para sincronizar:

1. Login en `/admin` con la API key (default: `localtv-fofostudio-key`).
2. Click en **↻ Sincronizar desde tvtvhd**.
3. El scraper descarga la home de tvtvhd.com, parsea los canales y hace upsert en la BD.

### Estructura

```
LocalTv-FofoStudio-Edition/
├── backend/                       # API FastAPI
│   ├── app/
│   │   ├── models/                # SQLAlchemy
│   │   ├── schemas/               # Pydantic
│   │   ├── routers/               # channels, categories, streams, auth, admin
│   │   ├── crud/                  # operaciones BD
│   │   └── services/scraper.py    # scraper Python (reemplaza Node/Playwright)
│   ├── scripts/seed.py            # seed inicial (idempotente)
│   ├── main.py                    # FastAPI app + StaticFiles para frontend
│   ├── requirements.txt
│   └── requirements-build.txt     # + pyinstaller, pillow
│
├── frontend/                      # React + Vite (UI Netflix-style)
│   └── src/
│       ├── components/            # ChannelCard (tile/list), VideoPlayer, ...
│       ├── pages/                 # Home, ChannelPage, Admin/*
│       ├── context/               # ChannelContext, FavoritesContext
│       └── services/api.js        # cliente HTTP (rutas relativas en .exe)
│
├── installer/
│   ├── launcher.py                # entry-point cross-platform (uvicorn + Tk window)
│   ├── LocalTv.spec               # PyInstaller spec — Windows (.exe)
│   ├── LocalTv-mac.spec           # PyInstaller spec — macOS (.app + Info.plist)
│   ├── LocalTv.iss                # Inno Setup script (Windows)
│   ├── make_icon.py               # genera icon.ico/.png/.icns con Pillow + iconutil
│   └── icon.ico / icon.icns / icon.png
│
├── build.ps1                      # pipeline de build — Windows (.exe)
├── build.sh                       # pipeline de build — macOS (.app + .dmg)
├── setup.ps1 / setup.bat          # setup desarrollo (Windows)
├── setup.sh                       # setup desarrollo (Linux/macOS)
├── scripts/start.{ps1,bat,sh}     # solo arrancar
└── docker-compose.yml
```

### Variables de entorno

**`backend/.env`** (opcional, valores por defecto razonables):

```
DATABASE_URL=sqlite:///./LocalTv.db
SECRET_API_KEY=localtv-fofostudio-key
```

En el `.exe` empaquetado, la BD vive en `%LOCALAPPDATA%\LocalTv\LocalTv.db` y se crea automáticamente.

**`frontend/.env`** — no lo necesitas. En desarrollo, Vite proxea `/api/*` a `localhost:8000`. En el `.exe`, todo se sirve desde el mismo origen.

### Solución de problemas

**`Failed to build pydantic-core` / `PyO3 maximum supported version is 3.13`**
Tienes Python 3.14. Instala 3.13 (`winget install --id Python.Python.3.13`), borra el venv y repite:

```powershell
Remove-Item -Recurse -Force backend\venv; .\setup.ps1
```

**`Cannot find native binding`** en el frontend
Tu `node_modules` se instaló en otra plataforma (típico al saltar entre WSL/Windows). El setup detecta esto; manualmente:

```powershell
Remove-Item -Recurse -Force frontend\node_modules, frontend\package-lock.json
cd frontend; npm install
```

**Inno Setup no se instala con `winget`**
Descárgalo manualmente desde https://jrsoftware.org/isinfo.php y vuelve a correr `.\build.ps1`.

**El `.exe` instalado no abre nada**
Comprueba que el puerto 8765 no esté ocupado por otra app. El launcher detecta puerto en uso y solo abre el navegador en ese caso.

---

## API REST

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/channels
# Swagger:  http://localhost:8000/docs
```

## Notas legales

Proyecto **con fines educativos**. Asegúrate de tener permisos para usar/distribuir cualquier contenido, respetar términos de servicio de plataformas externas y derechos de autor.

## Licencia

MIT — ver `LICENSE`.

## Créditos

Mantenido por [@FofoStudio](https://github.com/FofoStudio).

---

**Versión:** 2.3.0 — FofoStudio Edition · Instaladores `.exe` (Windows) + `.dmg` (macOS) + UI Netflix
