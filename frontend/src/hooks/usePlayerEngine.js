import { useEffect, useState } from 'react';

// Store mínimo para exponer qué motor de reproducción está activo
// (hls.js / shaka / nativo) y mostrarlo en la UI.

let current = 'hls.js';
const listeners = new Set();

export function setPlayerEngine(name) {
  if (name === current) return;
  current = name;
  listeners.forEach((l) => l(current));
}

export function getPlayerEngine() {
  return current;
}

export function usePlayerEngine() {
  const [engine, setEngine] = useState(current);
  useEffect(() => {
    const l = (v) => setEngine(v);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return engine;
}
