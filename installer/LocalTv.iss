; ============================================================================
; LocalTv · FofoStudio Edition — Inno Setup script
;
; Genera LocalTv-Setup-{version}.exe que instala la app SIN requerir admin
; (en %LOCALAPPDATA%\Programs\LocalTv) y crea acceso directo en escritorio
; + entrada en menú inicio.
;
; Compilar:
;   iscc installer\LocalTv.iss
; ============================================================================

#define MyAppName        "LocalTv"
#define MyAppVersion     "1.0.0"
#define MyAppPublisher   "FofoStudio"
#define MyAppURL         "https://github.com/fofostudio"
#define MyAppExeName     "LocalTv.exe"
#define MyAppDescription "LocalTv — Streaming en vivo · FofoStudio Edition"

[Setup]
; ID único de la aplicación. NO cambiar entre versiones.
AppId={{8FA3B2E1-7C4D-4E6F-9A1B-2D5E8F0C3A47}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Instalación per-user (sin admin) bajo %LOCALAPPDATA%\Programs\LocalTv
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Apariencia del wizard
WizardStyle=modern
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

; Output
OutputDir=..\dist
OutputBaseFilename=LocalTv-Setup-{#MyAppVersion}
Compression=lzma2/ultra
SolidCompression=yes

; No mostrar pantalla de bienvenida (ahorra clicks)
DisableWelcomePage=no
ShowLanguageDialog=no

; Min Windows: 10
MinVersion=10.0

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; \
    GroupDescription: "Iconos adicionales:"; Flags: checkedonce

[Files]
; Copiar todo el contenido de dist/LocalTv (PyInstaller --onedir output)
Source: "..\dist\LocalTv\*"; DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Menú inicio
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; \
    IconFilename: "{app}\{#MyAppExeName}"; Comment: "{#MyAppDescription}"

; Escritorio (opcional — controlado por el checkbox)
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; \
    IconFilename: "{app}\{#MyAppExeName}"; Comment: "{#MyAppDescription}"; \
    Tasks: desktopicon

; Desinstalar
Name: "{userprograms}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
; Lanzar al terminar
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar {#MyAppName} ahora"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Limpiar logs/cache locales (NO la BD del usuario en %LOCALAPPDATA%\LocalTv\)
Type: filesandordirs; Name: "{app}"
