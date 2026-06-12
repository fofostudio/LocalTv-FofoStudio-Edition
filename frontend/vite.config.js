import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// La versión del bundle se inyecta en build time. Prioridad:
//   1. process.env.LOCALTV_VERSION (lo pasa build.ps1, build.sh y el workflow CI)
//   2. package.json del frontend
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = process.env.LOCALTV_VERSION || pkg.version || '0.0.0';

export default defineConfig(({ mode }) => {
  // Cargamos los .env* (prefijo vacío = todas las vars) para poder hornear el
  // token también desde el archivo .env local, no solo desde process.env. El
  // `define` de abajo pisa la inyección automática de Vite, así que SIN esto el
  // token del .env se ignoraba. Prioridad: process.env (CI) > .env (local).
  const env = loadEnv(mode, __dirname, '');
  const TMDB_TOKEN = process.env.VITE_TMDB_TOKEN || env.VITE_TMDB_TOKEN || '';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
      'import.meta.env.VITE_TMDB_TOKEN': JSON.stringify(TMDB_TOKEN),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
