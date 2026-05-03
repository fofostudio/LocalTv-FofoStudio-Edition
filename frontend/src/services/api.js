// Detectar URL del backend dinámicamente.
// En el .exe el frontend se sirve desde el mismo origen que el backend → '' (rutas relativas).
const BASE_URL = (() => {
  if (import.meta.env.VITE_API_URL !== undefined) {
    return import.meta.env.VITE_API_URL;
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return ''; // mismo origen
  }
  return '';
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

export const api = {
  // Canales (públicos)
  getChannels: () => jsonFetch('/api/channels/'),
  getChannel: (id) => jsonFetch(`/api/channels/${id}`),
  getCategories: () => jsonFetch('/api/categories/'),

  // Admin
  validateApiKey: (apiKey) => jsonFetch('/api/channels/', {
    headers: { 'X-API-Key': apiKey },
  }),

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

  // Health: cuáles canales están realmente disponibles ahora
  getStreamHealth: () => jsonFetch('/api/streams/health'),

  // Eventos diarios (fuente externa)
  getDiaryEvents: async () => {
    const res = await fetch('https://pltvhd.com/diaries.json');
    if (!res.ok) throw new Error('Failed to fetch diary events');
    return res.json();
  },
};
