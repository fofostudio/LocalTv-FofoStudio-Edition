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

// ----- Categorías favoritas (canales) -----
const CAT_KEY = 'localtv_fav_categories';

function readCats() {
  try {
    const v = JSON.parse(localStorage.getItem(CAT_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let catValue = readCats();
const catListeners = new Set();

function writeCats(next) {
  catValue = next;
  try { localStorage.setItem(CAT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  catListeners.forEach((l) => l(next));
}

export function getFavoriteCategories() {
  return catValue;
}

// ----- Fuentes de canales desactivadas (Magma / abiertos / país) -----
const SRC_KEY = 'localtv_disabled_sources';
function readSrc() {
  try { const v = JSON.parse(localStorage.getItem(SRC_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
let srcValue = readSrc();
const srcListeners = new Set();
function writeSrc(next) {
  srcValue = next;
  try { localStorage.setItem(SRC_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  srcListeners.forEach((l) => l(next));
}
/** Lectura puntual (para filtrar canales sin re-render). */
export function getDisabledSources() { return srcValue; }
/** Clave de fuente de un canal (Magma = premium; resto = abiertos). */
export function channelSource(ch) {
  return ch && ch.region === 'Magma' ? 'magma' : 'abiertos';
}

export function usePreferences() {
  const [favoriteSports, setLocal] = useState(value);
  const [favoriteCategories, setCatLocal] = useState(catValue);
  const [disabledSources, setSrcLocal] = useState(srcValue);

  useEffect(() => {
    const l = (v) => setLocal(v);
    listeners.add(l);
    const cl = (v) => setCatLocal(v);
    catListeners.add(cl);
    const sl = (v) => setSrcLocal(v);
    srcListeners.add(sl);
    return () => { listeners.delete(l); catListeners.delete(cl); srcListeners.delete(sl); };
  }, []);

  const toggleSport = (id) => {
    write(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const clearSports = () => write([]);

  const toggleCategory = (slug) => {
    writeCats(catValue.includes(slug) ? catValue.filter((x) => x !== slug) : [...catValue, slug]);
  };
  const clearCategories = () => writeCats([]);

  // Una fuente está activa salvo que esté en la lista de desactivadas.
  const sourceEnabled = (key) => !disabledSources.includes(key);
  const toggleSourceEnabled = (key) => {
    writeSrc(disabledSources.includes(key)
      ? disabledSources.filter((x) => x !== key)
      : [...disabledSources, key]);
  };

  return {
    favoriteSports, toggleSport, clearSports, setFavoriteSports: write,
    favoriteCategories, toggleCategory, clearCategories,
    disabledSources, sourceEnabled, toggleSourceEnabled,
  };
}
