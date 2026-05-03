# Empieza aquí — LocalTv FofoStudio Edition

## ⚡ La forma fácil (Windows): instalador `.exe`

Si solo quieres **usar** LocalTv en Windows, no necesitas nada de lo que sigue.

1. Ve a la sección **Releases** del repo en GitHub.
2. Descarga `LocalTv-Setup-1.0.0.exe`.
3. Doble clic. Sigue el asistente (no pide admin).
4. Aparece un acceso directo "**LocalTv**" en tu escritorio. Doble clic y listo.

La app se abre en tu navegador automáticamente. Para apagarla, cierra la pequeña ventana "LocalTv está corriendo".

> Si quieres modificar el código, contribuir, o estás en macOS/Linux, sigue leyendo.

---

## 🛠️ La forma de desarrollador

Guía paso a paso para personas que **nunca han instalado un proyecto de programación**. No necesitas saber código. Sigue los pasos en orden.

> **Tiempo total:** entre 10 y 20 minutos la primera vez (la mayor parte es esperar descargas).

---

## ¿Qué es LocalTv?

Una app web que muestra canales de TV en vivo y eventos deportivos del día. Corre en tu computadora y la puedes ver también desde tu Smart TV o tablet (si están en la misma WiFi).

---

## Lo que necesitas instalar (solo la primera vez)

LocalTv necesita 3 programas previos. Si ya los tienes, salta esta sección.

| Programa | Para qué sirve | Cómo saber si ya lo tienes |
|----------|----------------|----------------------------|
| **Git** | Bajar el código del proyecto | Abre la terminal y escribe `git --version`. Si ves un número, ya está. |
| **Python 3.13** | Motor del backend (servidor) | En la terminal: `python --version`. Debe decir `3.11`, `3.12` o `3.13`. **No 3.14.** |
| **Node.js 18 o más** | Motor del frontend (la web) | En la terminal: `node -v`. Debe decir `v18` o más. |

> **¿Cómo abro "la terminal"?**
> - **Windows:** busca `PowerShell` en el menú Inicio y ábrelo.
> - **macOS:** abre la app `Terminal` (en `Aplicaciones → Utilidades`).
> - **Linux:** ya sabes 😉 (o `Ctrl+Alt+T`).

---

## 🪟 Si estás en Windows

### 1) Instala Git

Descárgalo de aquí:  
**https://git-scm.com/download/win**

- Abre el `.exe` que se descarga.
- Acepta todos los valores por defecto (siguiente, siguiente, instalar). No tienes que entender qué significan.
- Al terminar, **cierra** todas las ventanas de PowerShell y abre una nueva.

### 2) Instala Python 3.13

Descárgalo de aquí:  
**https://www.python.org/downloads/release/python-3132/**

Baja un poco hasta la sección "Files" y descarga `Windows installer (64-bit)`.

> ⚠️ Importante: en la primera pantalla del instalador **marca la casilla "Add python.exe to PATH"** abajo. Si no la marcas, Python no funcionará en la terminal.

- Click en `Install Now`. Espera.
- Al terminar, cierra y abre PowerShell de nuevo.

### 3) Instala Node.js LTS

Descárgalo de aquí:  
**https://nodejs.org/en/download**

- Elige `Windows Installer (.msi) — 64-bit — LTS`.
- Abre el `.msi` y acepta todo por defecto.
- Cierra y abre PowerShell de nuevo.

### 4) (Atajo) Instalación con un solo comando

Si tienes Windows 10/11 actualizado, en lugar de descargar cada uno, abre PowerShell y pega esto:

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.13 -e
winget install --id OpenJS.NodeJS.LTS -e
```

Acepta cualquier diálogo que aparezca. Después **cierra y abre PowerShell de nuevo**.

### 5) Verifica que todo funciona

Pega esto en PowerShell:

```powershell
git --version
python --version
node -v
```

Deberías ver tres líneas, algo como:

```
git version 2.45.0
Python 3.13.2
v20.11.1
```

Si una falla, vuelve al paso correspondiente.

---

## 🐧 Si estás en Linux (Ubuntu / Debian / Mint)

Abre la terminal y pega:

```bash
sudo apt update
sudo apt install -y git python3.13 python3.13-venv python3-pip nodejs npm
```

Verifica:

```bash
git --version
python3.13 --version
node -v
```

Si Node es menor a 18, instálalo desde NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 🍎 Si estás en macOS

### 1) Instala Homebrew (si no lo tienes)

Homebrew es un instalador de programas para Mac. Pega en la terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Sigue lo que el instalador te pida (te puede pedir tu contraseña de Mac).

### 2) Instala Git, Python y Node

```bash
brew install git python@3.13 node
```

### 3) Verifica

```bash
git --version
python3.13 --version
node -v
```

---

## 📥 Bajar el proyecto LocalTv

Ya con todo instalado, abre la terminal **en la carpeta donde quieras tener el proyecto**. Por ejemplo, tu Escritorio:

### Windows (PowerShell)
```powershell
cd $HOME\Desktop
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
```

### macOS / Linux
```bash
cd ~/Desktop
git clone https://github.com/FofoStudio/LocalTv-FofoStudio-Edition.git
cd LocalTv-FofoStudio-Edition
```

> Esto crea una carpeta llamada `LocalTv-FofoStudio-Edition` en tu Escritorio con todo el código.

---

## 🚀 Arrancar LocalTv

**Un solo comando**, según tu sistema:

### Windows (PowerShell)
```powershell
.\setup.ps1
```

> Si te aparece un error rojo de "ExecutionPolicy" o "no se puede cargar el script", pega esto en su lugar:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\setup.ps1
> ```

### Windows (CMD — el de fondo negro de toda la vida)
```cmd
setup.bat
```

### Linux / macOS
```bash
chmod +x setup.sh
./setup.sh
```

### ¿Qué pasa cuando lo ejecutas?

El script:
1. Comprueba que tengas Python 3.11–3.13 y Node 18+.
2. Descarga todas las dependencias (la primera vez tarda unos minutos — verás barras de progreso).
3. Configura los archivos del proyecto.
4. **Abre dos ventanas nuevas** (una con el "Backend" y otra con el "Frontend"). **No las cierres** mientras uses la app.

Cuando termine verás algo así:

```
URLs de Acceso Local:
   Frontend:    http://localhost:5173
   Backend API: http://localhost:8000
```

---

## 👀 Ver la app

### En tu computadora

Abre tu navegador (Chrome, Edge, Firefox, Safari) y entra a:

**http://localhost:5173**

¡Listo! Verás los canales y eventos.

### En tu Smart TV o tablet (misma WiFi)

El script imprime también una IP local, algo como `http://192.168.1.29:5173`. Esa es la URL para tu TV.

1. Toma nota de esa IP (lo que dice "Acceso Remoto" en la salida del script).
2. En tu TV, abre el navegador y entra a `http://<la-IP-que-viste>:5173`
3. La app cargará igual que en tu computadora.

> **¿No carga en la TV?**
> - Comprueba que tu TV y tu PC estén en la **misma red WiFi**.
> - Cuando arranques por primera vez, Windows preguntará si permitir el acceso a la red para Python/Node — **dale "Permitir"**. Si por error le diste "Cancelar", cambia eso en `Configuración → Red → Firewall`.

---

## 🔄 Cómo apagar LocalTv

Cierra las dos ventanas que abrió el script (la del Backend y la del Frontend). Ya está apagado.

## 🔄 Cómo arrancarlo otra vez (sin reinstalar)

La próxima vez **no necesitas hacer todo el setup de nuevo**. Solo abre la terminal en la carpeta del proyecto y ejecuta:

| Sistema | Comando |
|---------|---------|
| Windows PowerShell | `.\scripts\start.ps1` |
| Windows CMD | `scripts\start.bat` |
| Linux / macOS | `bash scripts/start.sh` |

---

## 🔧 Panel de administración

Si quieres añadir, editar o borrar canales:

1. Abre http://localhost:5173/admin
2. Pega esta clave: `bustatv-dev-secret-key-changeme`
3. Verás una tabla con todos los canales. Puedes editarlos.

---

## ❓ Errores comunes y cómo arreglarlos

### "El término 'python' no se reconoce" o "command not found: python"

Significa que Python no está en la lista de programas que la terminal conoce. Revisa que al instalar Python marcaste **"Add python.exe to PATH"** (Windows). Si no lo hiciste, desinstala Python y vuelve a instalarlo marcando esa casilla.

### "Failed to build pydantic-core" / "PyO3 maximum supported version is 3.13"

Tienes **Python 3.14**, que aún no funciona con el proyecto. Necesitas Python 3.13.

**Windows:**
```powershell
winget install --id Python.Python.3.13
Remove-Item -Recurse -Force backend\venv
.\setup.ps1
```

**macOS:**
```bash
brew install python@3.13
rm -rf backend/venv
./setup.sh
```

### "Cannot find native binding @rolldown/..."

Pasa cuando saltas entre WSL (Linux dentro de Windows) y PowerShell. Borra y reinstala la parte del frontend:

**Windows:**
```powershell
Remove-Item -Recurse -Force frontend\node_modules
Remove-Item frontend\package-lock.json -ErrorAction SilentlyContinue
.\setup.ps1
```

**Linux/macOS:**
```bash
rm -rf frontend/node_modules frontend/package-lock.json
./setup.sh
```

### "Puerto 5173 ya está en uso"

Otro programa ya está usando ese puerto. La forma más fácil: cierra todas las ventanas de terminal que tengas abiertas y vuelve a empezar.

### Mi TV ve "fetch failed" pero en el PC funciona

- Comprueba que el firewall de Windows permita los puertos 5173 y 8000. Lo más fácil: cuando arrancas el setup la primera vez, Windows pregunta si permitir el acceso — dale "Permitir en redes privadas".
- Verifica que la TV está en la **misma WiFi** que el PC.

### "bash setup.sh" en Windows da errores raros tipo `$'\r'`

Estás usando **WSL** (Linux dentro de Windows) en lugar de PowerShell. WSL no comparte la instalación de Python ni Node con Windows. **Usa `setup.ps1` desde PowerShell.**

### No entiendo nada y nada funciona

Cierra todo, reinicia el PC, abre una nueva terminal **como administrador** y vuelve a intentar desde el paso "Bajar el proyecto LocalTv". El 80% de los problemas se arreglan así.

---

## 📚 Documentación más técnica

- **README.md** — descripción completa del proyecto, arquitectura, API
- **QUICK_START.md** — referencia rápida con tabla de comandos
- **CLAUDE.md** — notas de desarrollo

---

## 🆘 ¿Sigue sin funcionar?

Abre un issue describiendo qué hiciste y qué error viste:  
**https://github.com/FofoStudio/LocalTv-FofoStudio-Edition/issues**

Pega:
1. Tu sistema operativo (Windows 11, macOS Sonoma, Ubuntu 22.04, etc.)
2. Salida de `git --version`, `python --version`, `node -v`
3. El mensaje de error completo

---

**¡Disfruta LocalTv!** 🎬
