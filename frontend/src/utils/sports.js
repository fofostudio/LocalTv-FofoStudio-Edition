// Catálogo de deportes (del diseño) + inferencia heurística del deporte de un
// evento a partir de su título / competición. No hay un campo "sport" en
// diaries.json, así que lo deducimos por palabras clave.

export const SPORTS = [
  { id: 'ft', name: 'Fútbol', code: 'FT', hue: '#1FB36B' },
  { id: 'nb', name: 'NBA / Basket', code: 'NB', hue: '#FF6B1A' },
  { id: 'nf', name: 'NFL', code: 'NF', hue: '#1E7BFF' },
  { id: 'mb', name: 'MLB / Béisbol', code: 'MB', hue: '#E54848' },
  { id: 'tn', name: 'Tenis', code: 'TN', hue: '#D6B400' },
  { id: 'mg', name: 'MotoGP', code: 'MG', hue: '#7A5BFF' },
  { id: 'f1', name: 'Fórmula 1', code: 'F1', hue: '#E54848' },
  { id: 'bo', name: 'Boxeo', code: 'BX', hue: '#222C57' },
  { id: 'uf', name: 'UFC / MMA', code: 'UF', hue: '#0E1633' },
];

const KEYWORDS = {
  ft: ['futbol', 'fútbol', 'liga', 'copa', 'champions', 'premier', 'laliga', 'la liga',
    'bundesliga', 'serie a', 'eredivisie', 'mls', 'libertadores', 'sudamericana', 'uefa',
    'fifa', 'eliminatorias', 'mundial', 'eurocopa', 'fc ', ' cf', 'boca', 'river'],
  nb: ['nba', 'basket', 'baloncesto', 'lakers', 'celtics', 'knicks', 'warriors'],
  nf: ['nfl', 'super bowl', 'touchdown'],
  mb: ['mlb', 'beisbol', 'béisbol', 'baseball', 'yankees', 'dodgers'],
  tn: ['tenis', 'atp', 'wta', 'roland garros', 'wimbledon', 'us open', 'australian open'],
  mg: ['motogp', 'moto2', 'moto3', 'motocicl'],
  f1: ['formula 1', 'fórmula 1', 'f1', 'gran premio', 'gp de', 'grand prix'],
  bo: ['boxeo', 'boxing', 'pelea de box'],
  uf: ['ufc', 'mma', 'fight night'],
};

export function inferSport(event) {
  const text = `${event?.title || ''} ${event?.competition || ''}`.toLowerCase();
  for (const sport of SPORTS) {
    const kws = KEYWORDS[sport.id] || [];
    if (kws.some((k) => text.includes(k))) return sport.id;
  }
  return null;
}

export function sportById(id) {
  return SPORTS.find((s) => s.id === id) || null;
}
