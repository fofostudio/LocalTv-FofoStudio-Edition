import { useContext, useEffect, useMemo, useState } from 'react';
import { ChannelContext } from '../context/ChannelContext';
import { api } from '../services/api';
import { getLogoFor } from '../utils/channelLogos';
import { inferSport } from '../utils/sports';
import { usePreferences } from './usePreferences';

const ASSUMED_DURATION_MIN = 130;

const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(hd|sd|4k|fhd|uhd|h264|h\.264)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

function findChannelByStreamName(streamName, channels) {
  if (!streamName || !channels?.length) return null;
  const target = normalize(streamName);
  if (!target) return null;
  const exact = channels.find(
    (ch) => normalize(ch.name) === target || normalize(ch.slug) === target
  );
  if (exact) return exact;
  return (
    channels.find((ch) => {
      const n = normalize(ch.name);
      const s = normalize(ch.slug);
      return (
        (n && (n.includes(target) || target.includes(n))) ||
        (s && (s.includes(target) || target.includes(s)))
      );
    }) || null
  );
}

function classifyEvent(diaryHour) {
  if (!diaryHour) return 'upcoming';
  const [hh, mm] = diaryHour.split(':').map(Number);
  const now = new Date();
  const eventDate = new Date(now);
  eventDate.setHours(hh || 0, mm || 0, 0, 0);
  const diffMin = (eventDate.getTime() - now.getTime()) / 60000;
  if (diffMin > 0) return 'upcoming';
  if (diffMin > -ASSUMED_DURATION_MIN) return 'live';
  return 'finished';
}

function timeUntil(diaryHour) {
  if (!diaryHour) return '';
  const [hh, mm] = diaryHour.split(':').map(Number);
  const now = new Date();
  const eventDate = new Date(now);
  eventDate.setHours(hh || 0, mm || 0, 0, 0);
  const diffMin = Math.round((eventDate.getTime() - now.getTime()) / 60000);
  if (diffMin > 0) {
    if (diffMin < 60) return `en ${diffMin} min`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m ? `en ${h}h ${m}m` : `en ${h}h`;
  }
  if (diffMin > -ASSUMED_DURATION_MIN) {
    const ago = -diffMin;
    if (ago < 60) return `hace ${ago} min`;
    return `hace ${Math.floor(ago / 60)}h ${ago % 60}m`;
  }
  return 'finalizado';
}

/**
 * Carga diaries.json, clasifica los eventos en live/upcoming/finished y
 * matchea cada stream a un canal local. Compartido por Home (agenda) y otros.
 */
export function useDiaryEvents() {
  const { channels, currentChannel, isLive } = useContext(ChannelContext);
  const { favoriteSports } = usePreferences();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await api.getDiaryEvents();
        const sorted = (data.data || [])
          .slice()
          .sort((a, b) =>
            (a.attributes.diary_hour || '').localeCompare(b.attributes.diary_hour || '')
          );
        if (!cancelled) setRaw(sorted);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render cada minuto para refrescar las clasificaciones temporales.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const events = useMemo(() => {
    const mapped = raw.map((ev) => {
      const a = ev.attributes;
      const competition = a.country?.data?.attributes?.name || 'Otros';
      const competitionLogo = a.country?.data?.attributes?.image?.data?.attributes?.url;
      const embeds = a.embeds?.data || [];
      const streams = embeds.map((e) => {
        const name = e.attributes.embed_name;
        const matched = findChannelByStreamName(name, channels);
        return {
          id: e.id,
          name,
          channel: matched,
          logo: matched ? getLogoFor(matched) : null,
          live: matched ? isLive(matched.slug) : false,
          isCurrent: matched && currentChannel?.id === matched.id,
        };
      });
      const title = a.diary_description || 'Sin título';
      const sport = inferSport({ title, competition });
      return {
        id: ev.id,
        title,
        hour: (a.diary_hour || '').slice(0, 5),
        competition,
        competitionLogo,
        sport,
        favorite: sport ? favoriteSports.includes(sport) : false,
        status: classifyEvent(a.diary_hour),
        relTime: timeUntil(a.diary_hour),
        streams,
      };
    });

    // Si hay deportes favoritos, los priorizamos (manteniendo orden por hora
    // dentro de cada grupo). El índice original preserva el orden estable.
    if (!favoriteSports.length) return mapped;
    return mapped
      .map((ev, i) => ({ ev, i }))
      .sort((x, y) => {
        if (x.ev.favorite !== y.ev.favorite) return x.ev.favorite ? -1 : 1;
        return x.i - y.i;
      })
      .map((o) => o.ev);
  }, [raw, channels, currentChannel, isLive, favoriteSports]);

  const counts = useMemo(() => {
    const c = { live: 0, upcoming: 0, finished: 0 };
    events.forEach((e) => {
      c[e.status] = (c[e.status] || 0) + 1;
    });
    return c;
  }, [events]);

  return { events, counts, loading, error };
}
