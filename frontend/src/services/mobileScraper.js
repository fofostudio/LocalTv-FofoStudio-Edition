/**
 * Scraper de tvtvhd.com en JS — port directo de backend/app/services/scraper.py.
 *
 * Antes parseaba HTML. tvtvhd cambió: ahora la home es vacía y los canales
 * se cargan dinámicamente desde https://tvtvhd.com/status.json. Lee ese
 * JSON, devuelve canales + estado live/offline.
 *
 * Usa CapacitorHttp (no fetch del WebView) para evitar CORS y poder pasar
 * el User-Agent de browser que tvtvhd espera.
 */

const STATUS_URL = 'https://tvtvhd.com/status.json';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.9',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  Referer: 'https://tvtvhd.com/',
};

function slugify(text) {
  return (text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'canal';
}

function parseStreamParam(link) {
  const m = /stream=([^&\s"']+)/.exec(link || '');
  return m ? m[1].trim() : null;
}

function normalizeStatus(payload) {
  const seen = new Map();
  for (const region of Object.keys(payload || {})) {
    const items = payload[region];
    if (!Array.isArray(items)) continue;
    for (const entry of items) {
      if (!entry || typeof entry !== 'object') continue;
      const name = String(entry.Canal || '').trim();
      const estado = String(entry.Estado || '').trim().toLowerCase();
      const link = entry.Link || '';
      const stream_param = parseStreamParam(link);
      if (!name || !stream_param) continue;
      const slug = slugify(name);
      if (seen.has(slug)) {
        // Si ya existe, ascender a "live" si esta versión lo está
        if (estado === 'activo' && !seen.get(slug).is_live) {
          seen.get(slug).is_live = true;
        }
        continue;
      }
      seen.set(slug, {
        name,
        slug,
        stream_param,
        stream_url: `https://tvtvhd.com/vivo/canales.php?stream=${stream_param}`,
        region,
        is_live: estado === 'activo',
      });
    }
  }
  return [...seen.values()];
}

async function getJson() {
  const cap = window.Capacitor;
  if (!cap?.Plugins?.CapacitorHttp) throw new Error('CapacitorHttp no disponible');
  const { CapacitorHttp } = cap.Plugins;
  const r = await CapacitorHttp.get({
    url: STATUS_URL,
    headers: HEADERS,
    connectTimeout: 10000,
    readTimeout: 15000,
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}

export async function fetchChannels() {
  const data = await getJson();
  return normalizeStatus(data);
}

/**
 * Health check híbrido:
 * 1. status.json filtra los slugs que tvtvhd marca "Activo" (barato).
 * 2. Para cada uno hacemos deep probe: pedimos el HTML del player,
 *    extraemos la URL del .m3u8 real, GET y verificamos que el body
 *    empiece con #EXTM3U. Solo así lo marcamos live.
 *
 * Esto evita falsos positivos cuando el JSON dice "Activo" pero el
 * stream real ya está roto (lag entre status y realidad).
 *
 * Devuelve Set<string> con los slugs realmente en vivo.
 */
const M3U8_PATTERNS = [
  /playbackURL\s*[=:]\s*["']?([^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
  /<source[^>]+src=["']([^"']+\.m3u8[^"']*)["']/i,
  /(https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
];

/**
 * Health check: usa status.json de tvtvhd directo. Es la lista oficial
 * de canales al aire — un solo fetch ~300ms.
 *
 * Lag conocido (1-2 min) entre que un canal cae y status.json lo refleja:
 * para ese bache las defensas del player (validación Content-Type=html
 * en HlsProxy + recovery agresivo de hls.js + panel "Stream corrupto"
 * con botón "Probar otro canal disponible") absorben el caso.
 */
export async function checkHealth(_slugs) {
  try {
    const chans = await fetchChannels();
    const live = new Set();
    for (const c of chans) if (c.is_live) live.add(c.slug);
    return live;
  } catch (e) {
    console.warn('[mobileScraper] status.json falló:', e.message || e);
    return new Set();
  }
}
