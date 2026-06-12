import { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import { usePreferences, channelSource } from '../hooks/usePreferences';

export const ChannelContext = createContext();

/** Normaliza nombres: limpia HD/SD/FHD/4K, normaliza espacios. */
function cleanName(name) {
  return (name || '')
    .replace(/\b(HD|SD|FHD|UHD|4K|FULL HD)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ChannelProvider({ children }) {
  const [channels, setChannels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currentChannel, setCurrentChannelState] = useState(null);
  // Reproducción VOD (película/serie) a nivel app, para que sobreviva al "atrás"
  // y se pueda minimizar a PiP. `vod` = { source, title, subtitles, startAt,
  // mediaType, id } | null. `vodMin` = está en mini-player (PiP).
  const [vod, setVod] = useState(null);
  const [vodMin, setVodMin] = useState(false);
  const playVod = useCallback((payload) => { setVod(payload); setVodMin(false); }, []);
  const minimizeVod = useCallback(() => setVodMin(true), []);
  const expandVod = useCallback(() => setVodMin(false), []);
  const closeVod = useCallback(() => { setVod(null); setVodMin(false); }, []);
  // Mientras hay VOD (fullscreen o PiP) el canal en vivo se pausa.
  const vodActive = !!vod;
  // Modo inmersivo (pantalla completa propia con zapping de canales). A nivel
  // app para que cualquier botón del player lo abra y el zapper lo controle.
  const [immersive, setImmersive] = useState(false);
  const enterImmersive = useCallback(() => setImmersive(true), []);
  const exitImmersive = useCallback(() => setImmersive(false), []);
  // PiP nativo de Android (fuera de la app): el video llena la ventana flotante
  // del sistema, sin el overlay de zapping.
  const [nativePip, setNativePip] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeRegion, setActiveRegion] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Set de slugs realmente disponibles ahora mismo (probed contra tvtvhd)
  const [liveSlugs, setLiveSlugs] = useState(() => new Set());
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthCheckedAt, setHealthCheckedAt] = useState(null);

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await api.getStreamHealth();
      setLiveSlugs(new Set(data.live || []));
      setHealthCheckedAt(new Date());
    } catch (e) {
      console.error('Health check failed:', e);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Setter wrapping. Cuando el usuario elige un canal queremos que el
  // reproductor quede a la vista — sobre todo en mobile donde la lista
  // empuja al player fuera del viewport. La auto-selección inicial usa
  // setCurrentChannelState directo y no dispara este scroll.
  const setCurrentChannel = useCallback((ch) => {
    setCurrentChannelState(ch);
    if (typeof window !== 'undefined' && ch) {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (_) {
        window.scrollTo(0, 0);
      }
    }
  }, []);

  // Fetch inicial: canales + categorías
  useEffect(() => {
    Promise.all([api.getChannels(), api.getCategories()])
      .then(([channelsData, categoriesData]) => {
        // Estandarizar nombres (quitar HD/SD/etc) sin perder el original
        const cleaned = (channelsData || []).map((c) => ({
          ...c,
          name: cleanName(c.name),
          _originalName: c.name,
        }));
        setChannels(cleaned);
        setCategories(categoriesData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Fetch health en paralelo (no bloquea la UI inicial)
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Auto-seleccionar el primer canal LIVE cuando tengamos datos
  useEffect(() => {
    if (currentChannel || !channels.length) return;
    if (healthLoading) return;
    const firstLive = channels.find((c) => liveSlugs.has(c.slug));
    setCurrentChannelState(firstLive || channels[0]);
  }, [channels, liveSlugs, healthLoading, currentChannel]);

  const isLive = useCallback((slug) => liveSlugs.has(slug), [liveSlugs]);

  // Lista de regiones únicas, ordenadas (regions disponibles para el filtro UI)
  const regions = useMemo(() => {
    const set = new Set();
    for (const c of channels) if (c.region) set.add(c.region);
    return [...set].sort();
  }, [channels]);

  // Fuentes de canales activas (Ajustes) — filtro global: aplica al sidebar,
  // Home, búsqueda y demás, no solo a la página de Canales.
  const { sourceEnabled } = usePreferences();

  // Canales visibles según las fuentes activas (sin filtros de categoría/región).
  // Base para los conteos de la UI.
  const visibleChannels = useMemo(
    () => channels.filter((ch) => sourceEnabled(channelSource(ch))),
    [channels, sourceEnabled],
  );

  // Filtrar canales por fuente + búsqueda + categoría + región
  const filteredChannels = useMemo(() => {
    let list = visibleChannels;
    if (activeCategory !== 'all') {
      list = list.filter((ch) => ch.category_id === activeCategory);
    }
    if (activeRegion !== 'all') {
      list = list.filter((ch) => ch.region === activeRegion);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((ch) => ch.name.toLowerCase().includes(q));
    }
    // Ordenar pensando en el canal que se está viendo: primero ese canal, luego
    // los de su MISMA categoría (para que "lo de al lado" sea afín a lo que ves),
    // y dentro de cada bloque los live primero y por nombre. Así el sidebar, el
    // strip móvil y "Más canales" surfacean el contexto del canal actual.
    const curId = currentChannel?.id;
    const curCat = currentChannel?.category_id;
    return [...list].sort((a, b) => {
      if (a.id === curId) return -1;
      if (b.id === curId) return 1;
      if (curCat != null) {
        const aSame = a.category_id === curCat ? 0 : 1;
        const bSame = b.category_id === curCat ? 0 : 1;
        if (aSame !== bSame) return aSame - bSame;
      }
      const al = liveSlugs.has(a.slug) ? 0 : 1;
      const bl = liveSlugs.has(b.slug) ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });
  }, [visibleChannels, activeCategory, activeRegion, searchQuery, liveSlugs, currentChannel]);

  // Próximo canal LIVE distinto al actual (para auto-skip cuando un canal falla)
  const nextLiveChannel = useCallback((excludeSlug) => {
    const lives = channels.filter(
      (c) => liveSlugs.has(c.slug) && c.slug !== excludeSlug
    );
    if (!lives.length) return null;
    return lives[Math.floor(Math.random() * lives.length)];
  }, [channels, liveSlugs]);

  // Zapping: salta al canal anterior/siguiente (dir = +1 | -1) dentro de los
  // canales visibles (respeta las fuentes activas), cíclico. Sin scroll (el
  // overlay inmersivo cubre la página). Lo usa el zapper con ←/→ y swipe.
  const zap = useCallback((dir = 1) => {
    const list = visibleChannels;
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === currentChannel?.id);
    const ni = i < 0 ? 0 : (i + (dir > 0 ? 1 : -1) + list.length) % list.length;
    setCurrentChannelState(list[ni]);
  }, [visibleChannels, currentChannel]);

  const value = {
    channels,
    categories,
    currentChannel,
    setCurrentChannel,
    // Versión sin scroll-to-top: para el auto-skip silencioso (failover de un
    // canal caído) que no debe mover la vista del usuario.
    setCurrentChannelSilent: setCurrentChannelState,
    vodActive,
    vod,
    vodMin,
    playVod,
    minimizeVod,
    expandVod,
    closeVod,
    // Modo inmersivo + zapping
    immersive,
    enterImmersive,
    exitImmersive,
    zap,
    // PiP nativo (Android)
    nativePip,
    setNativePip,
    activeCategory,
    setActiveCategory,
    activeRegion,
    setActiveRegion,
    regions,
    searchQuery,
    setSearchQuery,
    filteredChannels,
    visibleChannels,
    loading,
    error,
    // health
    liveSlugs,
    isLive,
    healthLoading,
    healthCheckedAt,
    refreshHealth,
    nextLiveChannel,
  };

  return (
    <ChannelContext.Provider value={value}>
      {children}
    </ChannelContext.Provider>
  );
}
