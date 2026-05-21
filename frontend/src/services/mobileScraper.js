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
// Mirror de respaldo (el repo versiona un snapshot del seed) por si tvtvhd
// está caído o bloqueado en la red del dispositivo.
const FALLBACK_URL =
  'https://raw.githubusercontent.com/fofostudio/LocalTv-FofoStudio-Edition/main/mobile/public-seed/channels.json';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.9',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  Referer: 'https://tvtvhd.com/',
};

// Caché en memoria del último status.json normalizado. La comparten el
// health-check y el sync para no golpear la red en cada refresh.
const CACHE_TTL_MS = 30_000;
let _cache = { at: 0, data: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// GET con CapacitorHttp (evita CORS y permite User-Agent de browser). Fallback
// a fetch del WebView si el plugin no está. Reintenta una vez ante fallo.
async function httpGetJson(url, { headers = HEADERS, retries = 1 } = {}) {
  const cap = window.Capacitor;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (cap?.Plugins?.CapacitorHttp) {
        const r = await cap.Plugins.CapacitorHttp.get({
          url,
          headers,
          connectTimeout: 8000,
          readTimeout: 12000,
        });
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      }
      const res = await fetch(url, { headers: { Accept: headers.Accept } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function getJson() {
  try {
    return await httpGetJson(STATUS_URL);
  } catch (e) {
    // tvtvhd caído/bloqueado → intentamos el mirror del repo (formato seed).
    console.warn('[mobileScraper] status.json falló, probando mirror:', e?.message || e);
    return httpGetJson(FALLBACK_URL, { retries: 0 });
  }
}

/**
 * Devuelve los canales normalizados. Usa caché en memoria (TTL 30s) para que
 * health-check y sync no disparen fetches repetidos. Si la red falla pero hay
 * caché previa (aunque vencida), la devuelve para no romper la UI.
 */
export async function fetchChannels({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.data && now - _cache.at < CACHE_TTL_MS) {
    return _cache.data;
  }
  try {
    const data = await getJson();
    let chans = normalizeStatus(data);
    // El mirror tiene forma de seed ({channels:[...]}), no de status.json.
    if (!chans.length && Array.isArray(data?.channels)) {
      chans = data.channels.map((c) => ({
        name: c.name,
        slug: c.slug,
        stream_param: null,
        stream_url: c.stream_url || `https://tvtvhd.com/vivo/canales.php?stream=${c.slug}`,
        region: c.region || null,
        is_live: c.is_active !== false,
      }));
    }
    if (chans.length) _cache = { at: now, data: chans };
    return chans.length ? chans : (_cache.data || []);
  } catch (e) {
    if (_cache.data) {
      console.warn('[mobileScraper] usando caché previa tras fallo:', e?.message || e);
      return _cache.data;
    }
    throw e;
  }
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
