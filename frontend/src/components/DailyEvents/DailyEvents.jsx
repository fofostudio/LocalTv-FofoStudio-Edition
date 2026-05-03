import { useContext, useEffect, useMemo, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { api } from '../../services/api';
import { getLogoFor } from '../../utils/channelLogos';
import styles from './DailyEvents.module.css';

const ASSUMED_DURATION_MIN = 130; // duración asumida del evento (sport ~ 2h10)

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

  return channels.find((ch) => {
    const n = normalize(ch.name);
    const s = normalize(ch.slug);
    return (
      (n && (n.includes(target) || target.includes(n))) ||
      (s && (s.includes(target) || target.includes(s)))
    );
  }) || null;
}

/** Devuelve la categoría temporal del evento. */
function classifyEvent(diaryHour) {
  if (!diaryHour) return 'upcoming';
  const [hh, mm] = diaryHour.split(':').map(Number);
  const now = new Date();
  const eventDate = new Date(now);
  eventDate.setHours(hh || 0, mm || 0, 0, 0);
  const diffMin = (eventDate.getTime() - now.getTime()) / 60000;

  if (diffMin > 0) return 'upcoming';                  // empieza más tarde
  if (diffMin > -ASSUMED_DURATION_MIN) return 'live';  // empezó hace <2h10
  return 'finished';
}

/** Diferencia humanizada al inicio del evento. */
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

const SECTIONS = [
  { key: 'live',     title: 'EN VIVO AHORA',  hint: 'Eventos transmitiéndose ahora mismo' },
  { key: 'upcoming', title: 'PRÓXIMOS HOY',   hint: 'Aún no comenzaron' },
  { key: 'finished', title: 'FINALIZADOS',    hint: 'Ya terminaron' },
];

export default function DailyEvents({ onStreamClick }) {
  const { channels, currentChannel, isLive } = useContext(ChannelContext);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('live'); // 'live' | 'upcoming' | 'finished' | 'all'

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const data = await api.getDiaryEvents();
        const sorted = (data.data || []).slice().sort((a, b) =>
          (a.attributes.diary_hour || '').localeCompare(b.attributes.diary_hour || '')
        );
        setEvents(sorted);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  // Re-render cada minuto para que las clasificaciones live/upcoming/finished se actualicen
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Pre-procesar eventos: matchear streams a canales locales + clasificar
  const enriched = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return events
      .map((ev) => {
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
        return {
          id: ev.id,
          title: a.diary_description || 'Sin título',
          hour: (a.diary_hour || '').slice(0, 5),
          competition,
          competitionLogo,
          status: classifyEvent(a.diary_hour),
          relTime: timeUntil(a.diary_hour),
          streams,
        };
      })
      .filter((ev) => {
        if (!q) return true;
        if (ev.title.toLowerCase().includes(q)) return true;
        if (ev.competition.toLowerCase().includes(q)) return true;
        if (ev.streams.some((s) => s.name.toLowerCase().includes(q))) return true;
        return false;
      });
  }, [events, searchQuery, channels, currentChannel, isLive]);

  // Conteos por status
  const counts = useMemo(() => {
    const c = { live: 0, upcoming: 0, finished: 0 };
    enriched.forEach((e) => { c[e.status] = (c[e.status] || 0) + 1; });
    return c;
  }, [enriched]);

  // Eventos visibles según filter
  const visibleEvents = useMemo(() => {
    if (filter === 'all') return enriched;
    return enriched.filter((e) => e.status === filter);
  }, [enriched, filter]);

  if (loading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.empty}>Cargando eventos...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.error}>No se pudieron cargar los eventos</div>
      </section>
    );
  }

  if (!events.length) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.empty}>No hay eventos disponibles</div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Eventos del Día</h2>

      <input
        type="text"
        placeholder="Buscar por equipo, competición o canal..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={styles.searchInput}
      />

      <div className={styles.filterTabs} role="tablist">
        <FilterChip active={filter === 'live'}     onClick={() => setFilter('live')}     count={counts.live}     dot live>EN VIVO</FilterChip>
        <FilterChip active={filter === 'upcoming'} onClick={() => setFilter('upcoming')} count={counts.upcoming} dot>Próximos</FilterChip>
        <FilterChip active={filter === 'finished'} onClick={() => setFilter('finished')} count={counts.finished}>Finalizados</FilterChip>
        <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}      count={enriched.length}>Todos</FilterChip>
      </div>

      {visibleEvents.length === 0 ? (
        <div className={styles.empty}>
          {filter === 'live' && 'No hay eventos en vivo ahora mismo.'}
          {filter === 'upcoming' && 'No hay próximos eventos.'}
          {filter === 'finished' && 'No hay eventos finalizados aún.'}
          {filter === 'all' && 'Sin resultados.'}
        </div>
      ) : (
        <div className={styles.eventsList}>
          {visibleEvents.map((ev) => (
            <EventCard key={ev.id} event={ev} onStreamClick={onStreamClick} />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, count, children, live, dot }) {
  return (
    <button
      className={`${styles.chip} ${active ? styles.chipActive : ''} ${live ? styles.chipLive : ''}`}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {dot && <span className={`${styles.chipDot} ${live ? styles.chipDotLive : ''}`} />}
      {children}
      <span className={styles.chipCount}>{count}</span>
    </button>
  );
}

function EventCard({ event, onStreamClick }) {
  const statusBadgeClass =
    event.status === 'live'     ? styles.evLive :
    event.status === 'upcoming' ? styles.evUpcoming : styles.evFinished;

  return (
    <article className={`${styles.eventCard} ${statusBadgeClass}`}>
      <header className={styles.evHeader}>
        <div className={styles.evCompetition}>
          {event.competitionLogo && (
            <img
              src={`https://pltvhd.com${event.competitionLogo}`}
              alt=""
              className={styles.evCompetitionLogo}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <span className={styles.evCompetitionName}>{event.competition}</span>
        </div>
        <span className={styles.evTime}>
          <span className={styles.evHour}>{event.hour}</span>
          <span className={styles.evRel}>{event.relTime}</span>
        </span>
      </header>

      <h3 className={styles.evTitle}>{event.title}</h3>

      {event.streams.length > 0 ? (
        <div className={styles.streamsList}>
          {event.streams.map((s) => (
            <button
              key={s.id}
              className={`${styles.streamPill}
                ${s.isCurrent ? styles.streamCurrent : ''}
                ${s.channel ? '' : styles.streamUnmatched}
                ${s.channel && !s.live ? styles.streamOff : ''}`}
              onClick={() => onStreamClick && onStreamClick(s.name)}
              title={s.channel
                ? (s.live ? `Reproducir ${s.channel.name} (en vivo)` : `${s.channel.name} (no disponible ahora)`)
                : `No hay canal local mapeado para "${s.name}"`}
            >
              {s.logo ? (
                <img
                  src={s.logo}
                  alt=""
                  className={styles.streamLogo}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <span className={styles.streamLogoPlaceholder}>📺</span>
              )}
              <span className={styles.streamName}>{s.name}</span>
              {s.channel && (
                <span className={`${styles.streamDot} ${s.live ? styles.streamDotLive : styles.streamDotOff}`} />
              )}
              {s.isCurrent && <span className={styles.streamPlayingTag}>▶</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.noStreams}>Sin canales asignados.</p>
      )}
    </article>
  );
}
