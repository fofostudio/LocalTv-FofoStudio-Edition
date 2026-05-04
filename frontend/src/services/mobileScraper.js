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
 * Health check rápido: un solo fetch a status.json devuelve el estado
 * Activo/Inactivo de cada canal. Sustituye los probes paralelos viejos.
 *
 * Devuelve Set<string> con los slugs en vivo.
 */
export async function checkHealth(slugs) {
  // ignoramos el parámetro slugs — status.json los trae a todos
  try {
    const chans = await fetchChannels();
    const live = new Set();
    for (const c of chans) if (c.is_live) live.add(c.slug);
    return live;
  } catch (e) {
    console.warn('[mobileScraper] health falló:', e.message || e);
    return new Set();
  }
}
