# Inicio Rápido — LocalTv FofoStudio Edition

> **Repositorio:** https://github.com/FofoStudio/LocalTv-FofoStudio-Edition

## Prerequisitos

- **Python 3.11, 3.12 o 3.13** (no 3.14 — `pydantic-core` aún no publica wheels para 3.14)
- **Node.js 18+**
- **Git**

## Comando único — Instala + arranca

### Windows (PowerShell — recomendado)

```powershell
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
.\setup.ps1
```

Si la política de ejecución te bloquea:
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Windows (CMD)

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

## Solo instalar (sin arrancar)

Añade `--no-start`:

| Plataforma | Comando |
|-----------|---------|
| Windows PowerShell | `.\setup.ps1 --no-start` |
| Windows CMD | `setup.bat --no-start` |
| Linux / macOS | `./setup.sh --no-start` |

## Solo arrancar (ya instalado)

| Plataforma | Comando |
|-----------|---------|
| Windows PowerShell | `.\scripts\start.ps1` |
| Windows CMD | `scripts\start.bat` |
| Linux / macOS | `bash scripts/start.sh` |

## Acceso

Cuando arranque verás:

```
URLs de Acceso Local:
   Frontend:    http://localhost:5173
   Backend API: http://localhost:8000
   Swagger UI:  http://localhost:8000/docs

URLs de Acceso Remoto:
   Frontend:    http://<tu-ip-local>:5173
```

- **Desde tu PC:** http://localhost:5173
- **Desde tu TV / tablet (misma WiFi):** la IP local que muestra el script
- **Panel Admin:** http://localhost:5173/admin · API Key: `bustatv-dev-secret-key-changeme`

## Cómo instalar los prerequisitos rápidamente

### Windows

```powershell
winget install --id Python.Python.3.13
winget install --id OpenJS.NodeJS.LTS
winget install --id Git.Git
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y python3.13 python3.13-venv python3-pip nodejs npm git
# Si Node es < 18:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install -y python3.13 nodejs npm git
```

### macOS

```bash
# Homebrew (si no lo tienes)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python@3.13 node git
```

## Solución de problemas express

| Síntoma | Solución |
|---------|----------|
| `Failed to build pydantic-core` | Tienes Python 3.14 — instala 3.13, borra `backend/venv`, re-ejecuta setup |
| `Cannot find native binding @rolldown/...` | `node_modules` se instaló en otra plataforma — borra `frontend/node_modules` y `frontend/package-lock.json`, re-instala |
| `bash setup.sh` con rutas `/mnt/...` en Windows | Estás en WSL — usa `setup.ps1` desde PowerShell |
| `setup.sh: line N: $'\r': command not found` | CRLF — `sed -i 's/\r$//' setup.sh scripts/*.sh` |
| Puerto 5173/8000 ocupado | `npm run dev -- --port 3000` o `uvicorn ... --port 8001` |
| TV ve "fetch failed" | Comprueba firewall de Windows (puertos 5173 y 8000); ambos dispositivos en la misma WiFi |

## Funciones principales

### Pestaña "Canales"
- Lista de 100+ canales con búsqueda por nombre
- Click en un canal lo reproduce arriba

### Pestaña "Eventos"
- Eventos del día agrupados por competición (NBA, Copa Libertadores, Premier, ...)
- Búsqueda por equipo, competición o stream
- **Botones de stream**: click en cualquier badge intenta cargar el canal local correspondiente; si no hay match, se muestra un toast indicándolo

### Panel Admin
- URL: `/admin`
- API Key: `bustatv-dev-secret-key-changeme`
- CRUD de canales (crear, editar, activar/desactivar, eliminar)

## Mapa de scripts

| Script | Plataforma | Función |
|--------|-----------|---------|
| `setup.ps1` | Windows PowerShell | Instalar + arrancar |
| `setup.bat` | Windows CMD | Instalar + arrancar |
| `setup.sh` | Linux / macOS / Git Bash | Instalar + arrancar |
| `scripts/start.ps1` | Windows PowerShell | Solo arrancar |
| `scripts/start.bat` | Windows CMD | Solo arrancar |
| `scripts/start.sh` | Linux / macOS / Git Bash | Solo arrancar |

Todos los `setup.*` aceptan `--no-start` para saltarse el arranque.

---

**Documentación completa:** [README.md](./README.md)  
**Notas de desarrollo:** [CLAUDE.md](./CLAUDE.md)
