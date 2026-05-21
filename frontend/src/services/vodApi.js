// Cliente VOD (descubrimiento TMDB).
//
// El token se resuelve así: token local (Ajustes) → token horneado en build
// (VITE_TMDB_TOKEN, desde un GitHub Secret). Las llamadas van directo a TMDB
// (que soporta CORS) tanto en web/exe como en APK, así el token horneado sirve
// en todas las plataformas sin depender del backend.

const TMDB = 'https://api.themoviedb.org/3';
const TOKEN_KEY = 'localtv_tmdb_token';
const BAKED_TOKEN = import.meta.env.VITE_TMDB_TOKEN || '';

function localToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function token() {
  return localToken() || BAKED_TOKEN;
}
// v4 = JWT (eyJ...), v3 = api key hex de 32.
function isV4(t) {
  return t.startsWith('eyJ') || t.split('.').length === 3 || t.length > 45;
}

async function tmdbDirect(path, params = {}) {
  const t = token();
  if (!t) throw new Error('Configurá tu token de TMDB en Ajustes');
  const url = new URL(TMDB + path);
  url.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (isV4(t)) headers.Authorization = `Bearer ${t}`;
  else url.searchParams.set('api_key', t);

  const cap = window.Capacitor;
  if (cap?.Plugins?.CapacitorHttp) {
    const r = await cap.Plugins.CapacitorHttp.get({ url: url.toString(), headers });
    if (r.status < 200 || r.status >= 300) throw new Error(`TMDB ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

const DEMO_OFF = { sources: [], detail: 'No hay ninguna fuente conectada.' };

export const vod = {
  async getConfig() {
    return { has_token: !!token(), baked: !!BAKED_TOKEN && !localToken() };
  },
  async setToken(tok) {
    try { localStorage.setItem(TOKEN_KEY, tok || ''); } catch { /* ignore */ }
    return { has_token: !!token() };
  },
  trending(type = 'movie') {
    return tmdbDirect(`/trending/${type === 'tv' ? 'tv' : 'movie'}/week`);
  },
  search(q) {
    return tmdbDirect('/search/multi', { query: q, include_adult: 'false' });
  },
  detail(type, id) {
    return tmdbDirect(`/${type}/${id}`, { append_to_response: 'credits,videos' });
  },
  season(tvId, n) {
    return tmdbDirect(`/tv/${tvId}/season/${n}`);
  },
  async resolve() {
    // Punto de extensión: conectá aquí fuentes que estés autorizado a usar.
    return DEMO_OFF;
  },
};

export const tmdbImg = (path, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
