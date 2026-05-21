import { useEffect, useState } from 'react';

// Preferencias locales del usuario (sin cuentas, solo este equipo).
// Por ahora: deportes favoritos para priorizar eventos en la agenda.

const KEY = 'localtv_fav_sports';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let value = read();
const listeners = new Set();

function write(next) {
  value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  listeners.forEach((l) => l(next));
}

/** Lectura puntual (para hooks que no necesitan re-render, p.ej. useDiaryEvents). */
export function getFavoriteSports() {
  return value;
}

export function usePreferences() {
  const [favoriteSports, setLocal] = useState(value);

  useEffect(() => {
    const l = (v) => setLocal(v);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);

  const toggleSport = (id) => {
    write(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const clearSports = () => write([]);

  return { favoriteSports, toggleSport, clearSports, setFavoriteSports: write };
}
