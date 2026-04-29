# LocalTv — FofoStudio Edition

Plataforma web de streaming de contenido en vivo con eventos deportivos integrados, accesible desde cualquier dispositivo de tu red local.

> **Repositorio:** https://github.com/FofoStudio/LocalTv-FofoStudio-Edition

> 🟢 **¿Es tu primera vez instalando un proyecto?** Lee primero **[EMPEZAR_AQUI.md](./EMPEZAR_AQUI.md)** — guía paso a paso con enlaces de descarga.

## Características

- Lista de 100+ canales en vivo con búsqueda por nombre
- **Eventos del día** agrupados por competición (NBA, Copa Libertadores, etc.) con búsqueda por equipo/competición/stream
- **Botones de stream inteligentes** que cargan el canal local correspondiente con normalización tolerante (acentos, "HD"/"SD", espacios, mayúsculas)
- Indicador EN VIVO / Offline
- Acceso remoto desde Smart TV, tablet u otra PC en la misma red
- Panel administrativo (CRUD de canales) protegido por API key
- API REST documentada con Swagger UI

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 19 · Vite · React Router 7 · CSS Modules |
| Backend | FastAPI · Uvicorn · SQLAlchemy 2 · SQLite · Pydantic 2 |
| Runtime | Python **3.11 / 3.12 / 3.13** · Node.js **18+** |
| DevOps | Docker · Docker Compose |

> **Python 3.14 no es compatible**: `pydantic-core` aún no publica wheels para 3.14 y la build desde fuente falla.

## Inicio rápido (un solo comando)

Después de clonar el repo, ejecuta el script de tu plataforma. Detecta dependencias, las instala si faltan, copia los `.env` y arranca el servidor.

### Windows — PowerShell *(recomendado)*

```powershell
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
.\setup.ps1
```

Si la política de ejecución te bloquea:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Windows — CMD

```cmd
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
setup.bat
```

### Linux

```bash
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
chmod +x setup.sh
./setup.sh
```

### macOS

```bash
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
chmod +x setup.sh
./setup.sh
```

> **Sólo instalar (sin arrancar):** añade `--no-start` al comando (`./setup.sh --no-start`, `.\setup.ps1 --no-start`, `setup.bat --no-start`).

Cada script:

1. Detecta Python 3.11 / 3.12 / 3.13 (rechaza 3.14)
2. Detecta Node.js ≥ 18
3. Crea el venv (lo recrea si existe con una versión incompatible)
4. Instala dependencias backend y frontend
5. Detecta `node_modules` con binarios de otra plataforma (típico al alternar WSL/Windows) y reinstala
6. Copia los archivos `.env` desde `.env.example`
7. Arranca backend (`uvicorn`) y frontend (`vite --host`) en ventanas separadas

## Prerequisitos por plataforma

### Windows

```powershell
# Python 3.13 (winget viene en Windows 11)
winget install --id Python.Python.3.13

# Node.js LTS
winget install --id OpenJS.NodeJS.LTS

# Git (si no lo tienes)
winget install --id Git.Git
```

Reinicia tu PowerShell/CMD después de instalar para que el PATH se refresque.

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y python3.13 python3.13-venv python3-pip nodejs npm git
# Verifica versiones
python3.13 --version   # debe ser 3.13.x
node -v                # debe ser >= 18
```

Si tu distro no trae Node 18+, usa [NodeSource](https://github.com/nodesource/distributions):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install -y python3.13 nodejs npm git
```

### macOS

```bash
# Si no tienes Homebrew:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Dependencias
brew install python@3.13 node git
```

## Solo arrancar (ya instalado)

```powershell
# Windows PowerShell
.\scripts\start.ps1
```

```cmd
:: Windows CMD
scripts\start.bat
```

```bash
# Linux / macOS
bash scripts/start.sh
```

Salida esperada:

```
localTv esta corriendo!

URLs de Acceso Local:
   Frontend:    http://localhost:5173
   Backend API: http://localhost:8000
   Swagger UI:  http://localhost:8000/docs

URLs de Acceso Remoto (TV, otros dispositivos):
   Frontend:    http://192.168.1.29:5173
   Backend API: http://192.168.1.29:8000
```

## Instalación manual (opcional)

### Backend

**Windows (PowerShell):**
```powershell
cd backend
py -3.13 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Linux / macOS:**
```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

### Variables de entorno

```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

### Arrancar manualmente

**Terminal 1 — Backend:**

```powershell
# Windows
cd backend; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# Linux/macOS
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev -- --host
```

## Docker (alternativa)

```bash
docker compose up --build
```

Accede a http://localhost:5173

## URLs

| Servicio | Local | Remoto |
|----------|-------|--------|
| Frontend | http://localhost:5173 | http://`<TU_IP>`:5173 |
| Backend API | http://localhost:8000 | http://`<TU_IP>`:8000 |
| API Docs (Swagger) | http://localhost:8000/docs | http://`<TU_IP>`:8000/docs |

`<TU_IP>` es la IP local de tu PC; los scripts de arranque la imprimen automáticamente.

## Acceso desde Smart TV / tablet

1. Arranca con `.\scripts\start.ps1` (o equivalente). El script imprime la IP.
2. En la TV/tablet, abre el navegador y entra a `http://<IP>:5173`.
3. Asegúrate de que el dispositivo esté en la **misma red WiFi** que la PC.

Si ves "fetch failed":
- Confirma que el backend arrancó con `--host 0.0.0.0` (los scripts lo hacen).
- Asegúrate de que el firewall de Windows permita los puertos 5173 y 8000 (la primera vez aparecerá un diálogo).

## Panel administrativo

1. Ve a http://localhost:5173/admin
2. Ingresa la API Key: `bustatv-dev-secret-key-changeme`
3. Acciones: crear, editar, activar/desactivar y eliminar canales.

> En producción, **cambia `SECRET_API_KEY` en `backend/.env`** por algo aleatorio.

## Estructura del proyecto

```
LocalTv-FofoStudio-Edition/
├── backend/                    # API FastAPI + SQLite
│   ├── app/
│   │   ├── models/            # Modelos SQLAlchemy
│   │   ├── schemas/           # Schemas Pydantic
│   │   ├── routers/           # Endpoints
│   │   ├── crud/              # Operaciones de BD
│   │   └── database.py
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── components/        # SidebarWithTabs, DailyEvents, VideoPlayer, ...
│   │   ├── pages/             # Home, ChannelPage, Admin
│   │   ├── context/           # ChannelContext, FavoritesContext, UserContext
│   │   ├── services/api.js    # Cliente HTTP
│   │   ├── App.jsx            # Header "FofoStudio · LocalTv" + rutas
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
│
├── setup.ps1                  # Setup unificado (PowerShell)
├── setup.bat                  # Setup unificado (CMD)
├── setup.sh                   # Setup unificado (Linux/macOS/Git Bash)
├── scripts/
│   ├── start.ps1              # Solo arrancar (PowerShell)
│   ├── start.bat              # Solo arrancar (CMD)
│   └── start.sh               # Solo arrancar (Linux/macOS)
├── docker-compose.yml
├── .gitattributes             # Fuerza LF en .sh
├── README.md
├── QUICK_START.md
├── CLAUDE.md
└── LICENSE
```

## Solución de problemas

### "Failed to build pydantic-core" / "PyO3 maximum supported version is 3.13"

Tienes Python 3.14. Instala 3.13, borra el venv y vuelve a correr el setup:

```powershell
# Windows
winget install --id Python.Python.3.13
Remove-Item -Recurse -Force backend\venv
.\setup.ps1
```

```bash
# Linux
sudo apt install python3.13 python3.13-venv
rm -rf backend/venv
./setup.sh
```

```bash
# macOS
brew install python@3.13
rm -rf backend/venv
./setup.sh
```

### "Cannot find native binding" / `@rolldown/binding-linux-x64-gnu` o `win32-x64-msvc`

Tu `node_modules` se instaló en otra plataforma (típico al cambiar entre WSL y PowerShell). El setup detecta esto y reinstala. Si lo arrancas manualmente:

```powershell
Remove-Item -Recurse -Force frontend\node_modules
Remove-Item frontend\package-lock.json -ErrorAction SilentlyContinue
cd frontend; npm install
```

```bash
rm -rf frontend/node_modules frontend/package-lock.json
cd frontend && npm install
```

### `bash scripts/start.sh` falla en Windows con rutas tipo `/mnt/d/...`

Estás usando WSL en lugar de Git Bash o PowerShell. WSL es un Linux separado y no comparte el venv ni `node_modules` con Windows. **Usa `setup.ps1` desde PowerShell.**

### `setup.sh: line N: $'\r': command not found`

El script tiene saltos de línea CRLF de Windows. El repo tiene `.gitattributes` que fuerza LF en `.sh`, pero si lo abriste con un editor que los cambió, ejecuta:

```bash
# Linux / macOS / Git Bash
sed -i 's/\r$//' setup.sh scripts/start.sh scripts/install.sh
```

### Puerto 5173 o 8000 ocupado

```bash
# Frontend en otro puerto
cd frontend
npm run dev -- --host --port 3000

# Backend en otro puerto (luego ajusta frontend/.env)
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

### El frontend no encuentra el backend desde la TV

`frontend/src/services/api.js` detecta automáticamente el host: si abres `http://192.168.1.29:5173` desde la TV, intenta llamar a `http://192.168.1.29:8000`. Si fijaste `VITE_API_URL` en `frontend/.env`, esa URL toma precedencia — **no la fijes** o ajústala a la IP de tu PC.

## API REST

```bash
# Health check
curl http://localhost:8000/health

# Lista de canales
curl http://localhost:8000/api/channels

# Documentación interactiva
# Abre en el navegador: http://localhost:8000/docs
```

## Variables de entorno

### `backend/.env`
```
DATABASE_URL=sqlite:///./bustaTv.db
SECRET_API_KEY=bustatv-dev-secret-key-changeme
```

### `frontend/.env`
```
VITE_API_URL=http://localhost:8000
```

> Si quieres acceso desde TV con auto-detección, **deja `VITE_API_URL` vacío** o no fijes ese archivo.

## Notas legales

Proyecto **solo con fines educativos**. Asegúrate de:
- Tener permisos para usar/distribuir cualquier contenido
- Cumplir los términos de servicio de plataformas externas
- Respetar derechos de autor y propiedad intelectual
- Verificar regulaciones locales sobre streaming

## Contribuciones

```bash
git checkout -b feature/mejora
git commit -m "feat: descripción de la mejora"
git push origin feature/mejora
# Abre un Pull Request en GitHub
```

## Licencia

MIT — ver `LICENSE`.

## Créditos

- **FofoStudio Edition** mantenida por [@FofoStudio](https://github.com/FofoStudio)
- Proyecto original: [@fofostudio/localTv](https://github.com/fofostudio/localTv)

---

**Versión:** 2.1.0 — FofoStudio Edition  
**Última actualización:** Abril 2026
