import { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';

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

  // Setter wrapping para que la selección actualice también el "current"
  const setCurrentChannel = useCallback((ch) => {
    setCurrentChannelState(ch);
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

  // Filtrar canales por búsqueda + categoría + región
  const filteredChannels = useMemo(() => {
    let list = channels;
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
    // Ordenar: live primero, luego por nombre
    return [...list].sort((a, b) => {
      const al = liveSlugs.has(a.slug) ? 0 : 1;
      const bl = liveSlugs.has(b.slug) ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });
  }, [channels, activeCategory, activeRegion, searchQuery, liveSlugs]);

  // Próximo canal LIVE distinto al actual (para auto-skip cuando un canal falla)
  const nextLiveChannel = useCallback((excludeSlug) => {
    const lives = channels.filter(
      (c) => liveSlugs.has(c.slug) && c.slug !== excludeSlug
    );
    if (!lives.length) return null;
    return lives[Math.floor(Math.random() * lives.length)];
  }, [channels, liveSlugs]);

  const value = {
    channels,
    categories,
    currentChannel,
    setCurrentChannel,
    activeCategory,
    setActiveCategory,
    activeRegion,
    setActiveRegion,
    regions,
    searchQuery,
    setSearchQuery,
    filteredChannels,
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
