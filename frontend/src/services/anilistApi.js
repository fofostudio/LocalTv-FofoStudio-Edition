// Cliente AniList (metadata de anime). API GraphQL pública y gratuita, sin
// token. Permite CORS desde el browser; en móvil usamos CapacitorHttp.

const ENDPOINT = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
  id
  title { romaji english }
  coverImage { large }
  bannerImage
  averageScore
  seasonYear
  episodes
  format
  genres
  description(asHtml: false)
`;

const TRENDING_Q = `query { Page(perPage: 30) { media(type: ANIME, sort: TRENDING_DESC) { ${MEDIA_FIELDS} } } }`;
const SEARCH_Q = `query ($q: String) { Page(perPage: 30) { media(type: ANIME, search: $q, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } } }`;

async function gql(query, variables = {}) {
  const cap = window.Capacitor;
  if (cap?.Plugins?.CapacitorHttp) {
    // CapacitorHttp serializa el body según Content-Type: hay que pasar `data`
    // como OBJETO, no como string JSON (si no, el POST llega mal y AniList
    // responde error → la pantalla de Anime quedaba vacía en Android).
    const r = await cap.Plugins.CapacitorHttp.post({
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: { query, variables },
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`AniList ${r.status}`);
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (d?.errors?.length) throw new Error(d.errors[0]?.message || 'AniList error');
    return d?.data;
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const d = await res.json();
  if (d?.errors?.length) throw new Error(d.errors[0]?.message || 'AniList error');
  return d?.data;
}

// Adaptamos al shape que usa PosterCard (title/poster/score/year).
function adapt(m) {
  return {
    id: m.id,
    media_type: 'anime',
    title: m.title?.english || m.title?.romaji || 'Sin título',
    _posterUrl: m.coverImage?.large || null,
    backdrop_url: m.bannerImage || null,
    vote_average: m.averageScore != null ? m.averageScore / 10 : null,
    first_air_date: m.seasonYear ? String(m.seasonYear) : '',
    episodes: m.episodes,
    genres: (m.genres || []).map((name) => ({ name })),
    overview: (m.description || '').replace(/<[^>]+>/g, ''),
  };
}

export const anilist = {
  async trending() {
    const d = await gql(TRENDING_Q);
    return (d?.Page?.media || []).map(adapt);
  },
  async search(q) {
    const d = await gql(SEARCH_Q, { q });
    return (d?.Page?.media || []).map(adapt);
  },
};
