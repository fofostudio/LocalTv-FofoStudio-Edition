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
let _hlsProxyStarting = null;

export async function ensureHlsProxy() {
  if (!isCapacitor()) return '';
  if (_hlsProxyBase) return _hlsProxyBase;
  // Dedup de llamadas concurrentes: streamPlaylistUrl y lanStreamUrl pueden
  // pedir el proxy a la vez al cambiar de canal. Sin esto arrancábamos el
  // server nativo dos veces (y se filtraba uno).
  if (_hlsProxyStarting) return _hlsProxyStarting;
  const HlsProxy = window.Capacitor.Plugins?.HlsProxy;
  if (!HlsProxy) {
    console.warn('[platform] HlsProxy plugin no disponible — fallback a relative URLs');
    return '';
  }
  _hlsProxyStarting = (async () => {
    try {
      const { baseUrl } = await HlsProxy.start();
      _hlsProxyBase = baseUrl;
      return baseUrl;
    } finally {
      _hlsProxyStarting = null;
    }
  })();
  return _hlsProxyStarting;
}

/**
 * Invalida el baseUrl cacheado del proxy nativo. Se llama si una request al
 * proxy falla con error de red (el server pudo reiniciar en otro puerto tras
 * un resume de la app) para forzar un nuevo start() en la próxima reproducción.
 */
export function resetHlsProxy() {
  _hlsProxyBase = null;
  _hlsProxyStarting = null;
}

/**
 * Devuelve la URL del playlist HLS para un canal, en la plataforma actual.
 *
 * Web:    /api/streams/{slug}/playlist.m3u8                    (mismo origen)
 * Mobile: http://127.0.0.1:<puerto>/stream/{slug}/playlist.m3u8 (plugin nativo)
 */
/**
 * Diagnóstico del proxy nativo (Android), para depurar "no carga el stream":
 * dice si el plugin está registrado, qué baseUrl devolvió y si responde /health.
 * Se muestra en el panel de error del reproductor en móvil.
 */
export async function getProxyDiagnostics(slug) {
  const diag = { platform: platform() };
  if (!isCapacitor()) return diag;
  try {
    const HlsProxy = window.Capacitor?.Plugins?.HlsProxy;
    diag.plugin = !!HlsProxy;
    if (!HlsProxy) return diag;
    const base = await ensureHlsProxy();
    diag.base = base || '(vacío)';
    if (!base) return diag;

    // 1) /health del server nativo
    try { diag.health = (await fetch(`${base}/health`, { cache: 'no-store' })).status; }
    catch (e) { diag.health = `err:${e?.message || e}`; }

    // 2) playlist del canal: ¿resuelve y devuelve HLS?
    if (slug) {
      try {
        const r = await fetch(`${base}/stream/${slug}/playlist.m3u8`, { cache: 'no-store' });
        diag.pl = r.status;
        const txt = await r.text();
        diag.plHls = txt.startsWith('#EXTM3U');
        // 3) primer segmento del playlist: ¿baja bytes?
        const segLine = txt.split('\n').find((l) => l.includes('/segment?u='));
        if (segLine) {
          const segUrl = segLine.startsWith('http') ? segLine : `${base}${segLine.trim()}`;
          try {
            const sr = await fetch(segUrl, { cache: 'no-store' });
            const buf = await sr.arrayBuffer();
            diag.seg = `${sr.status}/${buf.byteLength}b`;
          } catch (e) { diag.seg = `err:${e?.message || e}`; }
        } else {
          diag.seg = txt.startsWith('#EXTM3U') ? 'sin-segmento' : 'no-hls';
        }
      } catch (e) { diag.pl = `err:${e?.message || e}`; }
    }
  } catch (e) {
    diag.error = String(e?.message || e);
  }
  return diag;
}

export async function streamPlaylistUrl(slug) {
  if (isCapacitor()) {
    const base = await ensureHlsProxy();
    return `${base}/stream/${slug}/playlist.m3u8`;
  }
  return `/api/streams/${slug}/playlist.m3u8`;
}

/**
 * URL absoluta del stream apta para Chromecast / AirPlay / otros
 * dispositivos en la red. Tiene que ser una URL pública alcanzable
 * por el dispositivo de cast — localhost no sirve.
 *
 * Web/desktop: pregunta a /api/network/info por la IP LAN.
 * Mobile (Capacitor): pregunta al plugin HlsProxy por la IP LAN del celu.
 */
let _lanBaseCache = null;

export async function lanStreamUrl(slug) {
  const base = await ensureLanBase();
  if (!base) return null;
  if (isCapacitor()) return `${base}/stream/${slug}/playlist.m3u8`;
  return `${base}/api/streams/${slug}/playlist.m3u8`;
}

async function ensureLanBase() {
  if (_lanBaseCache) return _lanBaseCache;
  try {
    if (isCapacitor()) {
      const HlsProxy = window.Capacitor?.Plugins?.HlsProxy;
      if (!HlsProxy?.networkInfo) return null;
      const info = await HlsProxy.networkInfo();
      if (!info?.lanUrl) return null;
      _lanBaseCache = info.lanUrl;
      return _lanBaseCache;
    }
    const res = await fetch('/api/network/info');
    if (!res.ok) return null;
    const data = await res.json();
    _lanBaseCache = data.lan_url;
    return _lanBaseCache;
  } catch (_) {
    return null;
  }
}
