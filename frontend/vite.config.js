import { defineConfig } from 'vite';
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

// Token TMDB horneado en build-time desde un GitHub Secret (no se versiona en
// el repo). Si está vacío, la app pide el token en Ajustes como fallback.
const TMDB_TOKEN = process.env.VITE_TMDB_TOKEN || '';

export default defineConfig({
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
});
