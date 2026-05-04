// Copia frontend/dist → mobile/public para que Capacitor lo empaquete.
// Idempotente: limpia public/ antes de copiar.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, '..', 'frontend', 'dist');
const DST = path.resolve(ROOT, 'public');

if (!fs.existsSync(SRC)) {
  console.error(`[copy-frontend] No existe ${SRC}. Corre 'npm run frontend:build' primero.`);
  process.exit(1);
}

if (fs.existsSync(DST)) {
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
fs.cpSync(SRC, DST, { recursive: true });

// También copiamos el seed al bundle (mobile/public/public-seed/) para que
// el WebView pueda hacer `fetch('/public-seed/channels.json')` offline en
// el primer arranque.
const SEED_SRC = path.resolve(ROOT, 'public-seed');
const SEED_DST = path.resolve(DST, 'public-seed');
if (fs.existsSync(SEED_SRC)) {
  fs.cpSync(SEED_SRC, SEED_DST, { recursive: true });
}

const count = (function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n += 1;
  }
  return n;
})(DST);

console.log(`[copy-frontend] OK · ${count} archivos copiados a mobile/public/`);
