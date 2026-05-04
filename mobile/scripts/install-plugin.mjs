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
    signingConfigs {
        localtvSigning {
            storeFile file('../../localtv.keystore') // mobile/localtv.keystore
            storePassword 'localtv-fofostudio'
            keyAlias 'localtv'
            keyPassword 'localtv-fofostudio'
        }
    }
`;
  // Insertar signingConfigs DENTRO del bloque android { ... }, justo
  // después de la apertura.
  gradle = gradle.replace(/android\s*\{/, (m) => `${m}${signingBlock}`);

  // Asignar la signingConfig a debug y release.
  gradle = gradle.replace(
    /buildTypes\s*\{([\s\S]*?)\}/,
    (full, body) => {
      // localtv-signing en cada buildType existente
      let newBody = body
        .replace(/(release\s*\{)/, '$1\n            signingConfig signingConfigs.localtvSigning')
        .replace(/(debug\s*\{)/, '$1\n            signingConfig signingConfigs.localtvSigning');
      // Si no hay bloques release/debug aún, agregarlos
      if (!/release\s*\{/.test(body)) {
        newBody = `\n        release {\n            signingConfig signingConfigs.localtvSigning\n            minifyEnabled false\n        }${newBody}`;
      }
      if (!/debug\s*\{/.test(body)) {
        newBody = `${newBody}\n        debug {\n            signingConfig signingConfigs.localtvSigning\n        }`;
      }
      return `buildTypes {${newBody}}`;
    },
  );
  // Si no había buildTypes, agregarlo
  if (!gradle.includes('buildTypes')) {
    gradle = gradle.replace(/android\s*\{[^}]*signingBlock[\s\S]*?(\n\s*)}/, (m) => m);
  }
  mutated = true;
  // Marcador comentado para detección idempotente
  gradle = gradle.replace(
    'signingConfigs {',
    '// localtv-signing: keystore commiteada en mobile/localtv.keystore\n    signingConfigs {',
  );
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

console.log('\n[install-plugin] OK. Próximos pasos:');
console.log('  npx cap sync android');
console.log('  npx cap open android   # abre Android Studio para buildear');
