// Helpers de presentación de canales, compartidos por las pantallas del
// diseño LocalTv (Home, En vivo, Canales, Configuración).

const HUES = [
  '#1E7BFF', '#1FB36B', '#FF6B1A', '#7A5BFF', '#E54848',
  '#0E1633', '#149C7A', '#0846C2', '#D6B400', '#222C57',
];

const REGION_LABEL = {
  LATINOAMERICA: 'Latinoamérica', ARGENTINA: 'Argentina', 'PERÚ': 'Perú', PERU: 'Perú',
  COLOMBIA: 'Colombia', 'MÉXICO': 'México', MEXICO: 'México', USA: 'USA', CHILE: 'Chile',
  BRASIL: 'Brasil', PORTUGAL: 'Portugal', 'ESPAÑA': 'España', ESPANA: 'España', MUNDO: 'Mundo',
};

export function regionLabel(region) {
  return REGION_LABEL[region] || region || 'Canal';
}

export function channelCode(ch) {
  const clean = (ch?.name || ch?.slug || '?').replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 3).toUpperCase() || '?';
}

export function channelHue(ch) {
  const key = ch?.slug || ch?.name || '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
