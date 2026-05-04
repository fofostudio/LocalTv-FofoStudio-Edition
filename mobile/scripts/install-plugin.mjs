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

// ---- 3) Registrar el plugin en MainActivity.java
//      Capacitor 6: los plugins anotados con @CapacitorPlugin se descubren
//      automáticamente. NO hace falta editar MainActivity. Pero verificamos
//      que existe el archivo y dejamos un comentario por si el user lo abre.
const MAIN_ACTIVITY = path.resolve(JAVA_PKG, 'MainActivity.java');
if (fs.existsSync(MAIN_ACTIVITY)) {
  console.log(`[install-plugin] MainActivity.java OK en ${path.relative(ROOT, MAIN_ACTIVITY)}`);
  console.log('  (Capacitor 6 auto-discover los plugins, no hay que editarla)');
}

// ---- 4) Asegurar que AndroidManifest permite cleartext traffic en localhost
const MANIFEST = path.resolve(APP_SRC, 'AndroidManifest.xml');
let manifest = fs.readFileSync(MANIFEST, 'utf-8');
if (!manifest.includes('usesCleartextTraffic')) {
  manifest = manifest.replace(
    /<application/,
    '<application android:usesCleartextTraffic="true"',
  );
  fs.writeFileSync(MANIFEST, manifest);
  console.log('[install-plugin] habilitado usesCleartextTraffic="true" en AndroidManifest');
}

console.log('\n[install-plugin] OK. Próximos pasos:');
console.log('  npx cap sync android');
console.log('  npx cap open android   # abre Android Studio para buildear');
