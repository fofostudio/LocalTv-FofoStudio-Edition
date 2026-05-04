/**
 * Detección de plataforma — desktop (web/exe) vs móvil (Capacitor APK).
 *
 * En web/exe la app usa el backend FastAPI (relative URLs).
 * En mobile Capacitor inyecta `window.Capacitor`; usamos el plugin nativo
 * HlsProxy para tener un mini-server localhost que hace el proxy HLS con
 * el header `Referer` que el WebView no puede setear.
 */

export const isCapacitor = () =>
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

export const platform = () => {
  if (typeof window === 'undefined') return 'server';
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() || 'native';
  return 'web';
};

/**
 * URL base para llamadas a "/api/streams/..." y la API en general.
 *
 * - Web/desktop: '' (mismo origen, FastAPI los sirve)
 * - Mobile: el HlsProxy plugin expone http://127.0.0.1:<puerto> que
 *   reemplaza /api/streams/*. La API de canales (no streams) usa SQLite
 *   local — no se hace fetch HTTP para esos endpoints.
 */
let _hlsProxyBase = null;

export async function ensureHlsProxy() {
  if (!isCapacitor()) return '';
  if (_hlsProxyBase) return _hlsProxyBase;
  const HlsProxy = window.Capacitor.Plugins?.HlsProxy;
  if (!HlsProxy) {
    console.warn('[platform] HlsProxy plugin no disponible — fallback a relative URLs');
    return '';
  }
  const { baseUrl } = await HlsProxy.start();
  _hlsProxyBase = baseUrl;
  return baseUrl;
}

/**
 * Devuelve la URL del playlist HLS para un canal, en la plataforma actual.
 *
 * Web:    /api/streams/{slug}/playlist.m3u8                    (mismo origen)
 * Mobile: http://127.0.0.1:<puerto>/stream/{slug}/playlist.m3u8 (plugin nativo)
 */
export async function streamPlaylistUrl(slug) {
  if (isCapacitor()) {
    const base = await ensureHlsProxy();
    return `${base}/stream/${slug}/playlist.m3u8`;
  }
  return `/api/streams/${slug}/playlist.m3u8`;
}
