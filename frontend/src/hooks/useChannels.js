import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useChannels() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchChannels = async () => {
      try {
        setLoading(true);
        const data = await api.getChannels();
        setChannels(data);
        setError(null);
      } catch (err) {
        console.error('Error fetching channels:', err);
        setError(err.message || 'Error fetching channels');
      } finally {
        setLoading(false);
      }
    };

    fetchChannels();
  }, []);

  return { channels, loading, error };
}
