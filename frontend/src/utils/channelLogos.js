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

export function getLogoFor(channel) {
  if (!channel) return null;
  if (channel.logo_url) return channel.logo_url;
  if (channel.slug && SLUGS_WITH_LOGO.has(channel.slug)) {
    return `/logos/${channel.slug}.png`;
  }
  return null;
}
