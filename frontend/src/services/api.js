// Cliente unificado: misma API en web/desktop (FastAPI) y móvil (Capacitor + SQLite local).
//
// El switch ocurre runtime con isCapacitor(). En web/desktop hace fetch al
// backend que está en el mismo origen. En mobile usa SQLite del celu vía
// @capacitor-community/sqlite y un scraper JS que reemplaza al endpoint de
// admin (sync-channels) y al health check.

import { isCapacitor } from './platform';

const BASE_URL = (() => {
  if (import.meta.env.VITE_API_URL !== undefined) return import.meta.env.VITE_API_URL;
  return ''; // mismo origen
})();

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    if (res.status === 401) throw new Error('API Key inválida');
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_) { /* ignore */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Web/desktop (FastAPI) ----------
const webApi = {
  getChannels: () => jsonFetch('/api/channels/'),
  getChannel:  (id) => jsonFetch(`/api/channels/${id}`),
  getCategories: () => jsonFetch('/api/categories/'),

  validateApiKey: (apiKey) => jsonFetch('/api/channels/', { headers: { 'X-API-Key': apiKey } }),

  createChannel: (data, apiKey) => jsonFetch('/api/channels/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(data),
  }),
  updateChannel: (id, data, apiKey) => jsonFetch(`/api/channels/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(data),
  }),
  deleteChannel: (id, apiKey) => jsonFetch(`/api/channels/${id}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  }),

  syncChannels: (apiKey) => jsonFetch('/api/admin/sync-channels', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  }),

  getStreamHealth: () => jsonFetch('/api/streams/health'),

  getDiaryEvents: async () => {
    const res = await fetch('https://pltvhd.com/diaries.json');
    if (!res.ok) throw new Error('Failed to fetch diary events');
    return res.json();
  },
};

// ---------- Mobile (SQLite + scraper JS) ----------
// Las funciones se importan lazy para que en web no carguen los módulos
// de Capacitor (que pesan y no hacen falta en el bundle desktop).
const mobileApi = {
  async getChannels() {
    const m = await import('./mobileDb');
    return m.getChannels();
  },
  async getChannel(slug) {
    const all = await this.getChannels();
    return all.find((c) => c.slug === String(slug) || c.id === Number(slug));
  },
  async getCategories() {
    const m = await import('./mobileDb');
    return m.getCategories();
  },

  // En mobile no hay API key — la app es local. Validamos siempre OK.
  validateApiKey: async () => [],

  async createChannel(data) {
    const m = await import('./mobileDb');
    await m.upsertChannels([data]);
  },
  async updateChannel(idOrSlug, data) {
    const m = await import('./mobileDb');
    if (data.is_active !== undefined) await m.setChannelActive(idOrSlug, !!data.is_active);
    if (data.stream_url || data.name) await m.upsertChannels([{ slug: idOrSlug, ...data }]);
  },
  async deleteChannel(idOrSlug) {
    const m = await import('./mobileDb');
    await m.setChannelActive(idOrSlug, false);
  },

  async syncChannels() {
    const [{ fetchChannels }, { upsertChannels }] = await Promise.all([
      import('./mobileScraper'),
      import('./mobileDb'),
    ]);
    const scraped = await fetchChannels();
    return upsertChannels(scraped);
  },

  async getStreamHealth() {
    const [{ checkHealth }, { getChannels }] = await Promise.all([
      import('./mobileScraper'),
      import('./mobileDb'),
    ]);
    const all = await getChannels();
    const live = await checkHealth(all.filter((c) => c.is_active).map((c) => c.slug));
    return {
      live: [...live].sort(),
      total: live.size,
      cached_age_s: 0,
    };
  },

  async getDiaryEvents() {
    const cap = window.Capacitor;
    const { CapacitorHttp } = cap.Plugins;
    const r = await CapacitorHttp.get({ url: 'https://pltvhd.com/diaries.json' });
    if (r.status !== 200) throw new Error('Failed to fetch diary events');
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  },
};

export const api = isCapacitor() ? mobileApi : webApi;
