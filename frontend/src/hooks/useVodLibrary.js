import { useEffect, useState } from 'react';

// Biblioteca VOD local (sin cuentas): "Mi lista" (watchlist) + "Seguir viendo"
// (progreso). Persistido en localStorage con store + suscripción para sync.

const LIST_KEY = 'localtv_vod_list';
const PROG_KEY = 'localtv_vod_progress';

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) || (key === LIST_KEY ? [] : {}); }
  catch { return key === LIST_KEY ? [] : {}; }
}

let list = read(LIST_KEY);
let progress = read(PROG_KEY);
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    localStorage.setItem(PROG_KEY, JSON.stringify(progress));
  } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

const keyOf = (mediaType, id) => `${mediaType}:${id}`;

export function useVodLibrary() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);

  return {
    list,
    progress,
    inList: (mediaType, id) => list.some((x) => x.media_type === mediaType && x.id === id),
    toggle: (item) => {
      const mt = item.media_type || 'movie';
      const i = list.findIndex((x) => x.media_type === mt && x.id === item.id);
      if (i >= 0) list = list.filter((_, idx) => idx !== i);
      else list = [{
        id: item.id,
        media_type: mt,
        title: item.title || item.name || 'Sin título',
        poster_path: item.poster_path || null,
        _posterUrl: item._posterUrl || null,
        vote_average: item.vote_average || null,
        first_air_date: item.first_air_date || item.release_date || '',
        addedAt: Date.now(),
      }, ...list];
      persist();
    },
    setProgress: (mediaType, id, position, duration) => {
      progress = { ...progress, [keyOf(mediaType, id)]: { position, duration, updatedAt: Date.now() } };
      persist();
    },
    getProgress: (mediaType, id) => progress[keyOf(mediaType, id)] || null,
    clear: () => { list = []; progress = {}; persist(); },
  };
}
