import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import styles from './DailyEvents.module.css';

export default function DailyEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const data = await api.getDiaryEvents();
        const sortedEvents = (data.data || []).sort((a, b) => {
          const timeA = a.attributes.diary_hour || '00:00:00';
          const timeB = b.attributes.diary_hour || '00:00:00';
          return timeA.localeCompare(timeB);
        });
        setEvents(sortedEvents);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  if (loading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.loadingMessage}>Cargando eventos...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.errorMessage}>No se pudieron cargar los eventos</div>
      </section>
    );
  }

  if (!events.length) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Eventos del Día</h2>
        <div className={styles.emptyMessage}>No hay eventos disponibles</div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Eventos del Día</h2>
      <div className={styles.eventsGrid}>
        {events.map((event) => (
          <div key={event.id} className={styles.eventCard}>
            {event.attributes.country?.data && (
              <div className={styles.leagueHeader}>
                <img
                  src={`https://pltvhd.com${event.attributes.country.data.attributes.image?.data?.attributes?.url || ''}`}
                  alt={event.attributes.country.data.attributes.name}
                  className={styles.leagueLogo}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                <span className={styles.leagueName}>
                  {event.attributes.country.data.attributes.name}
                </span>
              </div>
            )}
            <h3 className={styles.eventTitle}>
              {event.attributes.diary_description}
            </h3>
            <div className={styles.eventTime}>
              {event.attributes.diary_hour.substring(0, 5)}
            </div>
            {event.attributes.embeds?.data && event.attributes.embeds.data.length > 0 && (
              <div className={styles.streamsList}>
                {event.attributes.embeds.data.map((embed) => (
                  <span key={embed.id} className={styles.streamBadge}>
                    {embed.attributes.embed_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
