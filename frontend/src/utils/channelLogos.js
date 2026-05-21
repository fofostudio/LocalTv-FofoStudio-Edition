/**
 * Logos de canales — servidos como estáticos desde /logos/{slug}.png
 *
 * Los archivos PNG vienen del repo tv-logo/tv-logos (CC).
 * Se descargan con `python scripts/fetch_logos_v2.py` (genera el set de abajo).
 *
 * Solo devolvemos URL para slugs que sabemos tienen archivo, así evitamos
 * 404s en la consola del navegador. Para los demás, ChannelCard cae al
 * gradiente con iniciales.
 */

const SLUGS_WITH_LOGO = new Set([
  'azteca7','bein-sports-espanol','bein-sports-xtra-espanol','canal11','canal5',
  'cbs-sports-network','dazn1','dazn1-de','dazn2','dazn2-de','dazn-laliga',
  'dsports','dsports2','dsports-plus','espn','espn1-nl','espn2','espn2-nl',
  'espn3','espn3-nl','espn4','espn5','espn6','espn7','espn-deportes',
  'espn-premium','espnu','foxsports','foxsports1','foxsports2','foxsports3',
  'foxsports-premium','goltv','liga-campeones1','liga-campeones2',
  'liga-campeones3','premiere1','sky-sports-laliga','sporttv1','sporttv2',
  'sporttv3','sporttv4','sporttv5','sporttv6','sportv','sportv2','sportv3',
  'telefe','telemundo','tntsports','tudn','tycsports','unimas','univision',
  'usa-network',
]);

// Normaliza un identificador a solo [a-z0-9] (sin guiones, espacios ni acentos).
// Los slugs del seed usan otra convención que los nombres de archivo de logo
// (p.ej. seed "azteca-7" / "fox-sports-1" vs archivo "azteca7" / "foxsports1"),
// así que matcheamos por forma normalizada para resolver la mayoría.
const normLogo = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

// normalizado → nombre de archivo real
const NORM_TO_FILE = (() => {
  const m = new Map();
  for (const f of SLUGS_WITH_LOGO) m.set(normLogo(f), f);
  return m;
})();

// Aliases explícitos para canales con logo pero cuyo slug normalizado no coincide
// (p.ej. el seed agrega "de" o un sufijo de país).
const ALIASES = {
  'liga-de-campeones-1': 'liga-campeones1',
  'liga-de-campeones-2': 'liga-campeones2',
  'liga-de-campeones-3': 'liga-campeones3',
  'tnt-sports-chile': 'tntsports',
};

export function getLogoFor(channel) {
  if (!channel) return null;
  if (channel.logo_url) return channel.logo_url;

  const slug = channel.slug;
  // 1) match exacto por slug
  if (slug && SLUGS_WITH_LOGO.has(slug)) return `/logos/${slug}.png`;
  // 2) alias explícito
  if (slug && ALIASES[slug]) return `/logos/${ALIASES[slug]}.png`;
  // 3) match por slug normalizado
  if (slug) {
    const f = NORM_TO_FILE.get(normLogo(slug));
    if (f) return `/logos/${f}.png`;
  }
  // 4) match por nombre normalizado (último recurso)
  if (channel.name) {
    const f = NORM_TO_FILE.get(normLogo(channel.name));
    if (f) return `/logos/${f}.png`;
  }
  return null;
}
