/**
 * Scraper de tvtvhd.com en JS — port directo de backend/app/services/scraper.py.
 *
 * Usa CapacitorHttp (no fetch del WebView) para evitar CORS y poder pasar el
 * User-Agent de browser que tvtvhd espera. fetch() del WebView también
 * funcionaría aquí porque tvtvhd manda CORS abierto en la home, pero
 * CapacitorHttp es más confiable y no depende de policy del WebView.
 */

const SOURCE_URL = 'https://tvtvhd.com/';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

function slugify(text) {
  return (text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'canal';
}

/** Extrae canales del HTML (mismos patrones que el scraper Python) */
function extractChannels(html) {
  const re = /(?:<a[^>]+href|onclick)\s*=\s*["'][^"']*?stream=([^"'&)]+)[^"']*?["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  const skipPrefix = /^(Activo|Inactivo|Link|Ver)\b/i;
  const seen = new Map();

  let m;
  while ((m = re.exec(html)) !== null) {
    const stream_param = m[1].trim();
    const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2 || name.length > 80) continue;
    if (skipPrefix.test(name)) continue;
    const slug = slugify(name);
    if (seen.has(slug)) continue;
    seen.set(slug, {
      name,
      slug,
      stream_param,
      stream_url: `https://tvtvhd.com/vivo/canales.php?stream=${stream_param}`,
    });
  }
  return [...seen.values()];
}

export async function fetchChannels() {
  const cap = window.Capacitor;
  if (!cap?.Plugins?.CapacitorHttp) {
    throw new Error('CapacitorHttp no disponible');
  }
  const { CapacitorHttp } = cap.Plugins;
  const r = await CapacitorHttp.get({
    url: SOURCE_URL,
    headers: HEADERS,
    connectTimeout: 15000,
    readTimeout: 30000,
  });
  if (r.status !== 200) throw new Error(`Upstream HTTP ${r.status}`);
  return extractChannels(typeof r.data === 'string' ? r.data : String(r.data));
}

/**
 * Health check: para cada slug activo, hace probe al HTML del player y
 * verifica que el m3u8 está accesible. Concurrency limitada porque
 * tvtvhd tira si vamos muy fuerte.
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
      headers: { ...HEADERS, Referer: SOURCE_URL, Origin: 'https://tvtvhd.com' },
      connectTimeout: 4000,
      readTimeout: 5000,
    });
    if (r.status !== 200) return false;
    const html = typeof r.data === 'string' ? r.data : String(r.data);
    let m3u8 = null;
    for (const pat of M3U8_PATTERNS) {
      const mm = pat.exec(html);
      if (mm && mm[1].startsWith('http')) { m3u8 = mm[1]; break; }
    }
    if (!m3u8) return false;

    const r2 = await CapacitorHttp.get({
      url: m3u8,
      headers: { ...HEADERS, Referer: SOURCE_URL, Origin: 'https://tvtvhd.com' },
      connectTimeout: 4000,
      readTimeout: 4000,
    });
    if (r2.status !== 200) return false;
    const text = typeof r2.data === 'string' ? r2.data : String(r2.data);
    return text.trimStart().startsWith('#EXTM3U');
  } catch (_) {
    return false;
  }
}

/** Devuelve un Set<string> con los slugs en vivo. Concurrency=8 (mobile-friendly). */
export async function checkHealth(slugs, { concurrency = 8 } = {}) {
  const live = new Set();
  let i = 0;
  async function worker() {
    while (i < slugs.length) {
      const idx = i++;
      const slug = slugs[idx];
      if (await probeOne(slug)) live.add(slug);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return live;
}
