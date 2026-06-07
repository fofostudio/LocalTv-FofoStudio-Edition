/**
 * Copia android-plugin/*.kt al proyecto Android generado por Capacitor
 * y deja registrado el plugin en MainActivity.java.
 *
 * Idempotente: lo podés correr cuantas veces quieras.
 *
 * Uso (después de `npx cap add android`):
 *   node scripts/install-plugin.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PKG = 'com.fofostudio.localtv';
const PKG_DIR = PKG.replace(/\./g, '/'); // com/fofostudio/localtv
const APP_SRC = path.resolve(ROOT, 'android', 'app', 'src', 'main');
const JAVA_PKG = path.resolve(APP_SRC, 'java', PKG_DIR);
const PROXY_DIR = path.resolve(JAVA_PKG, 'proxy');

if (!fs.existsSync(APP_SRC)) {
  console.error(`[install-plugin] No existe ${APP_SRC}.`);
  console.error('Corre primero:  npx cap add android');
  process.exit(1);
}

// ---- 1) Copiar los .kt del plugin a android/app/src/main/java/.../proxy/
fs.mkdirSync(PROXY_DIR, { recursive: true });
const SRC_PLUGIN = path.resolve(ROOT, 'android-plugin');
for (const f of fs.readdirSync(SRC_PLUGIN)) {
  if (!f.endsWith('.kt')) continue;
  const dst = path.join(PROXY_DIR, f);
  fs.copyFileSync(path.join(SRC_PLUGIN, f), dst);
  console.log(`[install-plugin] copiado ${f} -> ${path.relative(ROOT, dst)}`);
}

// ---- 2) Asegurar que build.gradle tiene Kotlin + las deps que necesitamos
const APP_GRADLE = path.resolve(ROOT, 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(APP_GRADLE, 'utf-8');
const REQUIRED_DEPS = [
  `implementation "org.nanohttpd:nanohttpd:2.3.1"`,
  `implementation "com.squareup.okhttp3:okhttp:4.12.0"`,
  `implementation "org.jetbrains.kotlin:kotlin-stdlib:1.9.24"`,
];

let mutated = false;
for (const dep of REQUIRED_DEPS) {
  if (!gradle.includes(dep.split('"')[1])) {
    gradle = gradle.replace(/dependencies\s*\{/, (m) => `${m}\n    ${dep}`);
    mutated = true;
    console.log(`[install-plugin] agregada dep: ${dep}`);
  }
}
if (!gradle.includes('kotlin-android')) {
  gradle = gradle.replace(
    /apply plugin: ['"]com\.android\.application['"]/,
    `$&\napply plugin: 'kotlin-android'`,
  );
  mutated = true;
  console.log('[install-plugin] agregado plugin kotlin-android');
}

// ---- 2b) signingConfigs para que TODOS los APKs (debug y release) se
//          firmen con la misma keystore commiteada. Solución para el bug
//          "problema con el paquete" al actualizar — Android requiere que
//          la firma sea idéntica entre versiones.
if (!gradle.includes('localtv-signing')) {
  const signingBlock = `
    // localtv-signing: keystore commiteada en mobile/localtv.keystore
    signingConfigs {
        localtvSigning {
            storeFile file('../../localtv.keystore') // mobile/localtv.keystore
            storePassword 'localtv-fofostudio'
            keyAlias 'localtv'
            keyPassword 'localtv-fofostudio'
        }
    }
`;
  // Insertar signingConfigs DENTRO del bloque android { ... }, justo tras la apertura.
  gradle = gradle.replace(/android\s*\{/, (m) => `${m}${signingBlock}`);

  // release: agregar la signingConfig (idempotente).
  if (/release\s*\{/.test(gradle) && !/release\s*\{[^}]*localtvSigning/.test(gradle)) {
    gradle = gradle.replace(
      /(release\s*\{)/,
      '$1\n            signingConfig signingConfigs.localtvSigning',
    );
  }

  // debug: bloque hermano de release DENTRO de buildTypes. La plantilla de
  // Capacitor no trae bloque debug, así que lo insertamos limpio (no anidado).
  // El bug viejo lo metía DENTRO de release (release nunca se cerraba, '}}'),
  // dejando el debug sin firmar de forma estable → "app no instalada" al update.
  if (/buildTypes\s*\{/.test(gradle)) {
    if (!/debug\s*\{/.test(gradle)) {
      gradle = gradle.replace(
        /(buildTypes\s*\{)/,
        '$1\n        debug {\n            signingConfig signingConfigs.localtvSigning\n        }',
      );
    } else if (!/debug\s*\{[^}]*localtvSigning/.test(gradle)) {
      gradle = gradle.replace(
        /(debug\s*\{)/,
        '$1\n            signingConfig signingConfigs.localtvSigning',
      );
    }
  } else {
    // Plantilla sin buildTypes: agregamos un bloque completo dentro de android{}.
    gradle = gradle.replace(
      /android\s*\{/,
      (m) =>
        `${m}\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.localtvSigning\n        }\n        release {\n            signingConfig signingConfigs.localtvSigning\n            minifyEnabled false\n        }\n    }`,
    );
  }
  mutated = true;
  console.log('[install-plugin] configurada signingConfig fija (debug + release)');
}
if (mutated) fs.writeFileSync(APP_GRADLE, gradle);

// ---- 2.5) Asegurar Kotlin classpath en android/build.gradle (top-level)
const TOP_GRADLE = path.resolve(ROOT, 'android', 'build.gradle');
if (fs.existsSync(TOP_GRADLE)) {
  let top = fs.readFileSync(TOP_GRADLE, 'utf-8');
  if (!top.includes('kotlin-gradle-plugin')) {
    top = top.replace(
      /classpath\s+['"]com\.android\.tools\.build:gradle.*?['"]/,
      `$&\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24"`,
    );
    fs.writeFileSync(TOP_GRADLE, top);
    console.log('[install-plugin] agregado classpath kotlin-gradle-plugin');
  }
}

// ---- 3) Registrar plugins en MainActivity.java (explícito)
//      Capacitor 6 dice que auto-descubre @CapacitorPlugin pero a veces falla
//      con clases en subpackages. Forzamos registerPlugin(...) explícito.
const MAIN_ACTIVITY = path.resolve(JAVA_PKG, 'MainActivity.java');
if (fs.existsSync(MAIN_ACTIVITY)) {
  let mainSrc = fs.readFileSync(MAIN_ACTIVITY, 'utf-8');
  const plugins = ['HlsProxyPlugin', 'AppUpdaterPlugin'];

  // Imports
  for (const p of plugins) {
    const importLine = `import ${PKG}.proxy.${p};`;
    if (!mainSrc.includes(importLine)) {
      mainSrc = mainSrc.replace(
        /(import com\.getcapacitor\.BridgeActivity;)/,
        `$1\n${importLine}`,
      );
    }
  }

  // registerPlugin calls
  const registerLines = plugins
    .map((p) => `        registerPlugin(${p}.class);`)
    .join('\n');

  if (!plugins.every((p) => mainSrc.includes(`registerPlugin(${p}.class)`))) {
    if (mainSrc.includes('public class MainActivity extends BridgeActivity')) {
      if (!mainSrc.includes('protected void onCreate')) {
        mainSrc = mainSrc.replace(
          /(public class MainActivity extends BridgeActivity\s*\{)/,
          `$1
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
${registerLines}
        super.onCreate(savedInstanceState);
    }
`,
        );
      } else {
        // Insertar las que falten antes de super.onCreate (idempotente)
        for (const p of plugins) {
          if (!mainSrc.includes(`registerPlugin(${p}.class)`)) {
            mainSrc = mainSrc.replace(
              /(protected void onCreate\([^)]*\)\s*\{)/,
              `$1\n        registerPlugin(${p}.class);`,
            );
          }
        }
      }
    }
  }
  fs.writeFileSync(MAIN_ACTIVITY, mainSrc);
  console.log(`[install-plugin] MainActivity.java parcheada con registerPlugin para: ${plugins.join(', ')}`);
}

// ---- 4) AndroidManifest: cleartext + permisos + FileProvider
const MANIFEST = path.resolve(APP_SRC, 'AndroidManifest.xml');
let manifest = fs.readFileSync(MANIFEST, 'utf-8');

// 4a) cleartext traffic (HLS proxy local en http://127.0.0.1)
if (!manifest.includes('usesCleartextTraffic')) {
  manifest = manifest.replace(
    /<application/,
    '<application android:usesCleartextTraffic="true"',
  );
  console.log('[install-plugin] habilitado usesCleartextTraffic="true"');
}

// 4b) Permisos para AppUpdater (descargar APK + lanzar instalación)
const requiredPerms = [
  'android.permission.INTERNET',
  'android.permission.REQUEST_INSTALL_PACKAGES',
];
for (const perm of requiredPerms) {
  const tag = `<uses-permission android:name="${perm}" />`;
  if (!manifest.includes(perm)) {
    manifest = manifest.replace(/<\/manifest>/, `    ${tag}\n</manifest>`);
    console.log(`[install-plugin] agregado permiso ${perm}`);
  }
}

// 4c) FileProvider para que el intent install pueda leer el APK descargado
const fpAuthority = `${PKG}.fileprovider`;
if (!manifest.includes('android:authorities="' + fpAuthority + '"')) {
  const provider = `        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${fpAuthority}"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>`;
  manifest = manifest.replace(/(<\/application>)/, `${provider}\n    $1`);
  console.log('[install-plugin] agregado <provider> FileProvider');
}
fs.writeFileSync(MANIFEST, manifest);

// 4d) res/xml/file_paths.xml — paths que FileProvider sirve
const xmlDir = path.resolve(APP_SRC, 'res', 'xml');
const filePathsFile = path.resolve(xmlDir, 'file_paths.xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(
  filePathsFile,
  `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- DownloadManager.setDestinationInExternalFilesDir guarda en
         getExternalFilesDir(); lo exponemos como external-files-path. -->
    <external-files-path name="downloads" path="Download/" />
    <external-files-path name="external_files" path="." />
    <files-path name="internal_files" path="." />
    <cache-path name="cache" path="." />
</paths>
`,
);
console.log('[install-plugin] generado res/xml/file_paths.xml');

// ---- 5) Icono de launcher propio (reemplaza el default de Capacitor).
//      mobile/android/ se regenera en CI con `cap add android`, así que el
//      icono debe inyectarse acá desde mobile/icon/ (commiteado). Sobrescribimos
//      los PNGs legacy + el foreground adaptive y definimos el adaptive-icon con
//      recursos propios (color dedicado) para no chocar con el template.
const ICON_SRC = path.resolve(ROOT, 'icon');
const RES_DIR = path.resolve(APP_SRC, 'res');
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

if (fs.existsSync(ICON_SRC)) {
  for (const dens of DENSITIES) {
    const srcDir = path.join(ICON_SRC, dens);
    const dstDir = path.join(RES_DIR, `mipmap-${dens}`);
    if (!fs.existsSync(srcDir)) continue;
    fs.mkdirSync(dstDir, { recursive: true });
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const s = path.join(srcDir, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dstDir, f));
    }
  }

  // Color de fondo del adaptive-icon (nombre propio para no pisar el template).
  const valuesDir = path.join(RES_DIR, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'localtv_icon_bg.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="localtv_icon_bg">#14102a</color>
</resources>
`,
  );

  // Adaptive-icon (API 26+): fondo = color propio, foreground = nuestro PNG.
  const anydpiDir = path.join(RES_DIR, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/localtv_icon_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml);
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml);

  console.log('[install-plugin] icono de launcher LocalTv inyectado (5 densidades + adaptive)');
} else {
  console.warn(`[install-plugin] WARN: no existe ${ICON_SRC}, se mantiene el icono default`);
}

console.log('\n[install-plugin] OK. Próximos pasos:');
console.log('  npx cap sync android');
console.log('  npx cap open android   # abre Android Studio para buildear');
