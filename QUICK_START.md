# Inicio Rápido - localTv

## Comando único (instala + arranca)

### Windows (PowerShell — recomendado)

```powershell
cd localTv
.\setup.ps1
```

Si la política de ejecución te bloquea:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Windows (CMD)

```cmd
cd localTv
setup.bat
```

### Linux / macOS / Git Bash

```bash
cd localTv
bash setup.sh
```

Eso es todo. El script:

- Detecta Python 3.11/3.12/3.13 (rechaza 3.14 porque `pydantic-core` aún no publica wheels para 3.14)
- Detecta Node.js ≥ 18
- Crea el venv, instala dependencias backend
- Instala dependencias frontend (con detección de binarios cruzados Linux/Windows)
- Copia los archivos `.env` desde `.env.example`
- Arranca backend (`uvicorn`) y frontend (`vite`)

## Solo instalar (sin arrancar)

```powershell
.\setup.ps1 --no-start
```

```bash
bash setup.sh --no-start
```

```cmd
setup.bat --no-start
```

## Solo arrancar (ya instalado)

```powershell
.\scripts\start.ps1
```

```cmd
scripts\start.bat
```

```bash
bash scripts/start.sh
```

## Acceso

Cuando los servicios arranquen verás:

```
URLs de Acceso Local:
   Frontend:    http://localhost:5173
   Backend API: http://localhost:8000
   Swagger UI:  http://localhost:8000/docs

URLs de Acceso Remoto:
   Frontend:    http://<tu-ip-local>:5173
```

- **Desde tu PC:** http://localhost:5173
- **Desde tu TV u otro dispositivo en la red:** usa la IP local mostrada
- **Panel Admin:** http://localhost:5173/admin (API Key: `bustatv-dev-secret-key-changeme`)

## Solución de problemas comunes

### "Python no encontrado" o falla la build de `pydantic-core`

Tienes Python 3.14 (todavía no soportado) o no tienes Python instalado.

- Windows: descarga **Python 3.13** desde https://www.python.org/downloads/ (marca "Add Python to PATH")
- macOS: `brew install python@3.13`
- Ubuntu: `sudo apt install python3.13 python3.13-venv`

Después borra el venv viejo (si existe) y vuelve a ejecutar el setup:

```powershell
Remove-Item -Recurse -Force backend\venv
.\setup.ps1
```

### "Cannot find native binding" / `@rolldown/binding-linux-x64-gnu` o `win32-x64-msvc`

`node_modules` se instaló en otra plataforma (típico al cambiar entre WSL y PowerShell). El setup detecta esto y reinstala automáticamente, pero si lo arrancas manualmente:

```powershell
Remove-Item -Recurse -Force frontend\node_modules
Remove-Item frontend\package-lock.json -ErrorAction SilentlyContinue
cd frontend
npm install
```

### `bash setup.sh` falla en Windows con `ifconfig: command not found` o rutas raras

Estás usando WSL en lugar de PowerShell o Git Bash. **Usa `setup.ps1`** desde PowerShell. WSL es un Linux separado y no comparte el venv ni `node_modules` de Windows.

### Puerto 5173 o 8000 en uso

Detén el proceso que los esté ocupando, o cambia el puerto del frontend:

```bash
cd frontend
npm run dev -- --port 3000
```

## Estructura de scripts

| Script | Plataforma | Función |
|--------|-----------|---------|
| `setup.ps1` | Windows PowerShell | Instalar + arrancar (recomendado en Windows) |
| `setup.bat` | Windows CMD | Instalar + arrancar |
| `setup.sh` | Linux/macOS/Git Bash | Instalar + arrancar |
| `scripts/start.ps1` | Windows PowerShell | Solo arrancar |
| `scripts/start.bat` | Windows CMD | Solo arrancar |
| `scripts/start.sh` | Linux/macOS/Git Bash | Solo arrancar |

Todos los scripts soportan la flag `--no-start` (excepto los `start.*` que solo arrancan).
