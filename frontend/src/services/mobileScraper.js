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

async function probeOne(slug) {
  const cap = window.Capacitor;
  const { CapacitorHttp } = cap.Plugins;
  const upstream = `https://tvtvhd.com/vivo/canales.php?stream=${encodeURIComponent(slug)}`;
  try {
    const r = await CapacitorHttp.get({
      url: upstream,
      headers: { ...HEADERS, Origin: 'https://tvtvhd.com' },
      connectTimeout: 4000, readTimeout: 5000,
    });
    if (r.status !== 200) return false;
    const html = typeof r.data === 'string' ? r.data : String(r.data);
    let m3u8 = null;
    for (const pat of M3U8_PATTERNS) {
      const m = pat.exec(html);
      if (m && m[1].startsWith('http')) { m3u8 = m[1]; break; }
    }
    if (!m3u8) return false;
    const r2 = await CapacitorHttp.get({
      url: m3u8,
      headers: { ...HEADERS, Origin: 'https://tvtvhd.com' },
      connectTimeout: 4000, readTimeout: 4000,
    });
    if (r2.status !== 200) return false;
    const text = typeof r2.data === 'string' ? r2.data : String(r2.data);
    return text.trimStart().startsWith('#EXTM3U');
  } catch (_) { return false; }
}

export async function checkHealth(_slugs, { concurrency = 8 } = {}) {
  // 1. Filtro inicial: status.json
  let candidates = [];
  try {
    const chans = await fetchChannels();
    candidates = chans.filter((c) => c.is_live).map((c) => c.slug);
  } catch (e) {
    console.warn('[mobileScraper] status.json falló:', e.message || e);
    return new Set();
  }
  // 2. Deep probe
  const live = new Set();
  let i = 0;
  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      const slug = candidates[idx];
      if (await probeOne(slug)) live.add(slug);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return live;
}
