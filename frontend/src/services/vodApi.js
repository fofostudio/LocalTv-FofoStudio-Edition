// Cliente VOD (descubrimiento TMDB).
//
// El token se resuelve así: token local (Ajustes) → token horneado en build
// (VITE_TMDB_TOKEN, desde un GitHub Secret). Las llamadas van directo a TMDB
// (que soporta CORS) tanto en web/exe como en APK, así el token horneado sirve
// en todas las plataformas sin depender del backend.

import { isCapacitor } from './platform';

const TMDB = 'https://api.themoviedb.org/3';
const TOKEN_KEY = 'localtv_tmdb_token';
const BAKED_TOKEN = import.meta.env.VITE_TMDB_TOKEN || '';

// En la APK (Capacitor) NO hay backend: las rutas /api/vod/cine/* caen al
// catch-all del SPA y devuelven index.html → "unexpected token <". Por eso en
// móvil resolvemos catálogo/estrenos/clásicas/géneros con TMDB directo (que sí
// funciona con el token horneado). El catálogo "cine" (latino, reproducible)
// queda para web/.exe que sí tienen backend.
const NO_BACKEND = isCapacitor();

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
  // El token va horneado en el build (mismo para todos); nunca se le pide al
  // usuario. Si faltara, mostramos un error genérico sin mencionar el token.
  if (!t) throw new Error('Cine no disponible por ahora');
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

async function vodFetch(path, data, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch (_) {}
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

// GET al backend (catálogo CineCalidad sin TMDB). Blindado contra respuestas
// HTML (cuando no hay backend, el SPA devuelve index.html) para no tirar el
// críptico "unexpected token < in JSON".
async function cineGet(path) {
  if (NO_BACKEND) throw new Error('Catálogo cine no disponible sin servidor');
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('Respuesta no-JSON del servidor (¿sin backend?)');
  }
  return res.json();
}

// Normaliza items de CineCalidad al shape que esperan PosterCard/modal.
function normCine(items = []) {
  return items.map((it) => ({
    id: it.id,                 // URL de la ficha (clave + resolución directa)
    cine_url: it.cine_url || it.id,
    title: it.title,
    media_type: it.media_type || 'movie',
    _posterUrl: it.poster || null,   // PosterCard usa _posterUrl si existe
    release_date: it.year ? `${it.year}-01-01` : '',
    first_air_date: it.year ? `${it.year}-01-01` : '',
    overview: '',
    vote_average: null,
  }));
}

export const vod = {
  hasToken() { return !!token(); },
  async getConfig() {
    return { has_token: !!token(), baked: !!BAKED_TOKEN && !localToken() };
  },
  async setToken(tok) {
    try { localStorage.setItem(TOKEN_KEY, tok || ''); } catch { /* ignore */ }
    return { has_token: !!token() };
  },
  async trending(type = 'movie', page = 1) {
    if (!token()) {
      const d = await cineGet(`/api/vod/cine/catalog?kind=${type === 'tv' ? 'tv' : 'movie'}&page=${page}`);
      return { results: normCine(d.results) };
    }
    return tmdbDirect(`/trending/${type === 'tv' ? 'tv' : 'movie'}/week`, { page });
  },
  async search(q, page = 1) {
    if (!token()) {
      const d = await cineGet(`/api/vod/cine/search?q=${encodeURIComponent(q)}&page=${page}`);
      return { results: normCine(d.results) };
    }
    return tmdbDirect('/search/multi', { query: q, include_adult: 'false', page });
  },
  async detail(type, id) {
    // Item latino (id = URL): sinopsis/géneros/año/rating desde el sitio (sin TMDB).
    if (typeof id === 'string' && id.startsWith('http')) {
      try {
        const d = await cineGet(`/api/vod/cine/detail?url=${encodeURIComponent(id)}`);
        return {
          overview: d.overview || '',
          genres: (d.genres || []).map((g) => ({ name: g })),
          release_date: d.year ? `${d.year}-01-01` : '',
          vote_average: d.rating ? parseFloat(d.rating) : null,
          trailer: d.trailer || '',
          cast: d.cast || [],
          similar: normCine(d.similar || []),
          episodes: d.episodes || [],
        };
      } catch { return null; }
    }
    if (!token()) return Promise.resolve(null);
    return tmdbDirect(`/${type}/${id}`, { append_to_response: 'credits,videos' });
  },
  async estrenos(kind = 'movie', page = 1) {
    if (NO_BACKEND) {
      // Estrenos vía TMDB: lo que está en cartelera / al aire ahora.
      return tmdbDirect(kind === 'tv' ? '/tv/on_the_air' : '/movie/now_playing', { page });
    }
    const d = await cineGet(`/api/vod/cine/estrenos?kind=${kind}&page=${page}`);
    return { results: normCine(d.results) };
  },
  async clasicas(kind = 'movie', page = 1) {
    if (NO_BACKEND) {
      // Clásicas vía TMDB: títulos antiguos mejor valorados.
      return tmdbDirect(kind === 'tv' ? '/discover/tv' : '/discover/movie',
        kind === 'tv'
          ? { sort_by: 'vote_average.desc', 'vote_count.gte': 800, 'first_air_date.lte': '2012-12-31', page }
          : { sort_by: 'vote_average.desc', 'vote_count.gte': 2000, 'primary_release_date.lte': '2010-12-31', page });
    }
    const d = await cineGet(`/api/vod/cine/clasicas?kind=${kind}&page=${page}`);
    return { results: normCine(d.results) };
  },
  // Categorías (géneros).
  async genres() {
    if (NO_BACKEND) {
      try {
        const d = await tmdbDirect('/genre/movie/list');
        return (d.genres || []).map((g) => ({ slug: String(g.id), name: g.name }));
      } catch { return []; }
    }
    try { return (await cineGet('/api/vod/cine/genres')).genres || []; } catch { return []; }
  },
  async byGenre(slug, kind = 'movie', page = 1) {
    if (NO_BACKEND) {
      return tmdbDirect(kind === 'tv' ? '/discover/tv' : '/discover/movie',
        { with_genres: slug, sort_by: 'popularity.desc', page });
    }
    const d = await cineGet(`/api/vod/cine/genre?slug=${encodeURIComponent(slug)}&kind=${kind}&page=${page}`);
    return { results: normCine(d.results) };
  },
  season(tvId, n) {
    return tmdbDirect(`/tv/${tvId}/season/${n}`);
  },
  async resolve({ media_type, tmdb_id, season, episode, title, year, source_url } = {}) {
    if (NO_BACKEND) {
      // Sin backend (APK) reproducimos con embeds de terceros construidos desde
      // el tmdb_id (URLs deterministas) → no hace falta servidor. Se ven en
      // iframe (VodPlayer maneja kind:'embed').
      if (!tmdb_id) throw new Error('No hay id para reproducir este título.');
      const mt = media_type === 'tv' ? 'tv' : 'movie';
      const isTv = mt === 'tv';
      const s = season || 1; const e = episode || 1;
      const sources = isTv ? [
        { url: `https://vidsrc.to/embed/tv/${tmdb_id}/${s}/${e}`, kind: 'embed', provider: 'vidsrc', label: 'VidSrc' },
        { url: `https://vidsrc.xyz/embed/tv/${tmdb_id}/${s}-${e}`, kind: 'embed', provider: 'vidsrc.xyz', label: 'VidSrc 2' },
        { url: `https://www.2embed.cc/embedtv/${tmdb_id}&s=${s}&e=${e}`, kind: 'embed', provider: '2embed', label: '2Embed' },
        { url: `https://vidsrc.cc/v2/embed/tv/${tmdb_id}/${s}/${e}`, kind: 'embed', provider: 'vidsrc.cc', label: 'VidSrc 3' },
      ] : [
        { url: `https://vidsrc.to/embed/movie/${tmdb_id}`, kind: 'embed', provider: 'vidsrc', label: 'VidSrc' },
        { url: `https://vidsrc.xyz/embed/movie/${tmdb_id}`, kind: 'embed', provider: 'vidsrc.xyz', label: 'VidSrc 2' },
        { url: `https://www.2embed.cc/embed/${tmdb_id}`, kind: 'embed', provider: '2embed', label: '2Embed' },
        { url: `https://vidsrc.cc/v2/embed/movie/${tmdb_id}`, kind: 'embed', provider: 'vidsrc.cc', label: 'VidSrc 3' },
        { url: `https://multiembed.mom/?video_id=${tmdb_id}&tmdb=1`, kind: 'embed', provider: 'multiembed', label: 'MultiEmbed' },
      ];
      return { sources, detail: '' };
    }
    const res = await vodFetch('/api/vod/resolve', {
      media_type, tmdb_id: typeof tmdb_id === 'number' ? tmdb_id : 0,
      season, episode, title, year, source_url,
    }, 35000);
    return res;
  },
};

export const tmdbImg = (path, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
