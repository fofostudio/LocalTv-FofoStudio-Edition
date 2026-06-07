import { createContext, useState, useEffect, useRef } from 'react';

export const FavoritesContext = createContext();

const FAVORITES_KEY = 'bustaTv_favorites';

export function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState([]);
  const isInitialized = useRef(false);

  // Load favorites from localStorage on mount + sync entre pestañas/ventanas
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (stored) setFavorites(JSON.parse(stored));
    } catch (error) {
      console.error('Error loading favorites:', error);
    }
    isInitialized.current = true;

    // Si otra pestaña cambia los favoritos, reflejarlo acá.
    const onStorage = (e) => {
      if (e.key !== FAVORITES_KEY) return;
      try {
        setFavorites(e.newValue ? JSON.parse(e.newValue) : []);
      } catch (_) { /* ignore corrupto */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Save favorites to localStorage when they change (but not on initial load)
  useEffect(() => {
    if (!isInitialized.current) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (error) {
      // QuotaExceededError u otros: no romper la UI por no poder persistir.
      console.error('Error guardando favoritos:', error);
    }
  }, [favorites]);

  const toggleFavorite = (channelId) => {
    setFavorites(prev => {
      if (prev.includes(channelId)) {
        return prev.filter(id => id !== channelId);
      } else {
        return [...prev, channelId];
      }
    });
  };

  const isFavorite = (channelId) => favorites.includes(channelId);

  const value = {
    favorites,
    toggleFavorite,
    isFavorite,
  };

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}
