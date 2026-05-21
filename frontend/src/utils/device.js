// Detección de dispositivo y "modo ligero" (lite) para TVs / equipos lentos.
//
// En lite desactivamos efectos caros (blur/backdrop-filter, animaciones de
// degradado, muestreo de logos en canvas) para que cargue rápido y sea
// compatible con navegadores de Smart TV (Tizen, webOS, Android TV, etc.).

const LITE_KEY = 'localtv_lite'; // 'on' | 'off' | (ausente = auto)

const TV_UA = /smart-?tv|smarttv|tizen|web ?os|webos|netcast|netscape|bravia|aquos|hbbtv|viera|vidaa|hisense|philips|toshiba|sharp|crkey|chromecast|googletv|google tv|android ?tv|aft[a-z]*|firetv|fire tv|roku|dlnadoc|maple|nettv|opera ?tv|sony ?dtv|inettvbrowser/i;

export function isTvUserAgent() {
  if (typeof navigator === 'undefined') return false;
  return TV_UA.test(navigator.userAgent || '');
}

/** ¿Conviene arrancar en modo ligero? Respeta override manual y ?lite=. */
export function detectLite() {
  try {
    const ov = localStorage.getItem(LITE_KEY);
    if (ov === 'on') return true;
    if (ov === 'off') return false;
  } catch { /* ignore */ }

  try {
    const qp = new URLSearchParams(window.location.search);
    if (qp.get('lite') === '1') return true;
    if (qp.get('lite') === '0') return false;
  } catch { /* ignore */ }

  if (isTvUserAgent()) return true;

  // Heurística: pantalla grande + puntero grueso + sin hover ≈ control remoto/TV.
  try {
    const noHover = window.matchMedia('(hover: none)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const wide = window.innerWidth >= 1280;
    if (wide && noHover && coarse) return true;
  } catch { /* ignore */ }

  return false;
}

export function applyLite(on) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-lite', '1');
  else document.documentElement.removeAttribute('data-lite');
}

export function isLite() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-lite') === '1';
}

/** mode: 'auto' | 'on' | 'off'. Persiste y aplica al instante. */
export function setLiteMode(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(LITE_KEY);
    else localStorage.setItem(LITE_KEY, mode);
  } catch { /* ignore */ }
  applyLite(detectLite());
}

export function getLiteMode() {
  try {
    const ov = localStorage.getItem(LITE_KEY);
    if (ov === 'on' || ov === 'off') return ov;
  } catch { /* ignore */ }
  return 'auto';
}
