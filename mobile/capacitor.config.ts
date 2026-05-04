import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuración Capacitor para la app móvil de LocalTv.
 *
 * webDir: 'public' es la carpeta donde copiamos el build de Vite del
 * frontend (vía scripts/copy-frontend.mjs). Capacitor empaqueta esa
 * carpeta dentro del APK como assets/public/, y el WebView arranca
 * con index.html.
 *
 * El backend Python NO va en el APK: lo reemplaza el HlsProxyPlugin
 * (Kotlin) que arranca un mini-server local solo accesible por la
 * propia WebView.
 */
const config: CapacitorConfig = {
  appId: 'com.fofostudio.localtv',
  appName: 'LocalTv',
  webDir: 'public',
  android: {
    // El AndroidManifest deberá tener:
    //   android:usesCleartextTraffic="true"
    // para que la WebView pueda hacer fetch a http://127.0.0.1:<puerto>
    // del HlsProxyPlugin (HTTP plano, no HTTPS).
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true, // poner false en release final
  },
  server: {
    androidScheme: 'https', // file:// no es válido para algunos APIs (fetch CORS)
  },
};

export default config;
