// Cliente VOD (descubrimiento TMDB).
//  - Web/desktop: usa el proxy del backend (/api/vod/*), que guarda el token.
//  - Móvil (Capacitor): pega directo a TMDB con el token guardado en localStorage
//    (vía CapacitorHttp para evitar CORS).

import { isCapacitor } from './platform';

const BASE = import.meta.env.VITE_API_URL || '';
const TMDB = 'https://api.themoviedb.org/3';
const TOKEN_KEY = 'localtv_tmdb_token';

function localToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

async function tmdbDirect(path, params = {}) {
  const token = localToken();
  if (!token) throw new Error('Configurá tu token de TMDB en Ajustes');
  const url = new URL(TMDB + path);
  url.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cap = window.Capacitor;
  if (cap?.Plugins?.CapacitorHttp) {
    const r = await cap.Plugins.CapacitorHttp.get({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.status !== 200) throw new Error(`TMDB ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function backend(path) {
  const res = await fetch(`${BASE}/api/vod${path}`);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* ignore */ }
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const vod = {
  async getConfig() {
    if (isCapacitor()) return { has_token: !!localToken() };
    return backend('/config');
  },
  async setToken(token) {
    if (isCapacitor()) {
      try { localStorage.setItem(TOKEN_KEY, token || ''); } catch { /* ignore */ }
      return { has_token: !!token };
    }
    const res = await fetch(`${BASE}/api/vod/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.json();
  },
  async trending(type = 'movie') {
    if (isCapacitor()) return tmdbDirect(`/trending/${type === 'tv' ? 'tv' : 'movie'}/week`);
    return backend(`/trending?type=${type === 'tv' ? 'tv' : 'movie'}`);
  },
  async search(q) {
    if (isCapacitor()) return tmdbDirect('/search/multi', { query: q, include_adult: 'false' });
    return backend(`/search?q=${encodeURIComponent(q)}`);
  },
  async detail(type, id) {
    if (isCapacitor()) return tmdbDirect(`/${type}/${id}`, { append_to_response: 'credits,videos' });
    return backend(`/${type}/${id}`);
  },
  // Punto de extensión: devuelve fuentes reproducibles si hay un resolver
  // conectado (autorizado). Por defecto no hay ninguna.
  async resolve({ media_type, tmdb_id, season, episode }) {
    if (isCapacitor()) return { sources: [], detail: 'Sin resolver configurado' };
    const res = await fetch(`${BASE}/api/vod/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type, tmdb_id, season, episode }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

export const tmdbImg = (path, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
