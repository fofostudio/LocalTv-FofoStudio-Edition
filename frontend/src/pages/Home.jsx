import { useContext, useMemo, useState } from 'react';
import { ChannelContext } from '../context/ChannelContext';
import { FavoritesContext } from '../context/FavoritesContext';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import { PLAYER_SLOT_ID } from '../components/PersistentPlayer/PersistentPlayer';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import ChannelBadge from '../components/ChannelBadge/ChannelBadge';
import ChannelLogo from '../components/ChannelLogo/ChannelLogo';
import { useDiaryEvents } from '../hooks/useDiaryEvents';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconStar, IconPlay, IconBell, IconCalendar } from '../components/icons/Icons';
import { regionLabel } from '../utils/channelDisplay';
import { getLogoFor } from '../utils/channelLogos';
import styles from './Home.module.css';

const TODAY_LABEL = (() => {
  try {
    const s = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return 'Hoy';
  }
})();

export default function Home() {
  const {
    channels, currentChannel, setCurrentChannel,
    filteredChannels, healthLoading, refreshHealth,
  } = useContext(ChannelContext);
  const { isFavorite, toggleFavorite } = useContext(FavoritesContext);
  const { events, counts, loading: eventsLoading } = useDiaryEvents();
  const playerEngine = usePlayerEngine();

  const [agendaFilter, setAgendaFilter] = useState('live');

  const visibleEvents = useMemo(
    () => events.filter((e) => e.status === agendaFilter),
    [events, agendaFilter]
  );

  const otherChannels = useMemo(
    () => filteredChannels.filter((c) => c.id !== currentChannel?.id).slice(0, 10),
    [filteredChannels, currentChannel]
  );

  const playEvent = (ev) => {
    const target = ev.streams.find((s) => s.channel);
    if (target) setCurrentChannel(target.channel);
  };

  if (eventsLoading && !channels.length) return <LoadingSpinner />;

  const fav = currentChannel ? isFavorite(currentChannel.id) : false;

  return (
    <div className={styles.shell}>
      {/* ===== LEFT SIDEBAR (compartido) ===== */}
      <LtSidebar />

      {/* ===== MAIN ===== */}
      <main className={styles.main}>
        {/* mobile top bar */}
        <div className={styles.mobileBar}>
          <div className={styles.brand}>
            <LocalTvMark size={26} radius={7} />
            <LocalTvWordmark size={15} />
          </div>
          <button
            type="button"
            className={styles.mobileHealth}
            onClick={refreshHealth}
            disabled={healthLoading}
          >
            <span className={`${styles.dot} ${styles.dotLive}`} />
            {healthLoading ? '…' : 'En vivo'}
          </button>
        </div>

        {/* mobile channel strip */}
        <div className={styles.chStrip}>
          {filteredChannels.slice(0, 30).map((ch) => {
            const selected = currentChannel?.id === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                className={`${styles.chip} ${selected ? styles.chipActive : ''}`}
                onClick={() => setCurrentChannel(ch)}
              >
                <ChannelBadge ch={ch} size={22} radius={5} />
                <span className={styles.chipName}>{ch.name}</span>
                <span className={`${styles.dot} ${styles.dotLive}`} />
              </button>
            );
          })}
        </div>

        {/* topbar */}
        <div className={styles.topbar}>
          <div className={styles.pills}>
            <button
              className={`${styles.pill} ${agendaFilter === 'live' ? styles.pillActive : ''}`}
              onClick={() => setAgendaFilter('live')}
            >En vivo · {counts.live}</button>
            <button
              className={`${styles.pill} ${agendaFilter === 'upcoming' ? styles.pillActive : ''}`}
              onClick={() => setAgendaFilter('upcoming')}
            >Próximos · {counts.upcoming}</button>
            <button
              className={`${styles.pill} ${agendaFilter === 'finished' ? styles.pillActive : ''}`}
              onClick={() => setAgendaFilter('finished')}
            >Finalizados · {counts.finished}</button>
          </div>
        </div>

        {/* player slot — el <video> persistente se posiciona aquí (ver PersistentPlayer) */}
        <div id={PLAYER_SLOT_ID} className={styles.playerBlock} />

        {/* agenda heading */}
        <div className={styles.agendaHead}>
          <div>
            <h3 className={styles.agendaTitle}>Agenda · {TODAY_LABEL}</h3>
            <div className={styles.agendaSub}>Sincronización en tiempo real · clic en un evento para reproducir</div>
          </div>
        </div>

        {/* agenda rows */}
        <div className={styles.agendaList}>
          {visibleEvents.map((ev) => {
            const playable = ev.streams.some((s) => s.channel);
            const live = ev.status === 'live';
            const evLogo = ev.streams.find((s) => s.channel)?.logo || null;
            return (
              <div key={ev.id} className={`${styles.match} ${live ? styles.matchLive : ''}`}>
                {evLogo && <img className={styles.matchBg} src={evLogo} alt="" aria-hidden="true" loading="lazy" />}
                <div className={`${styles.matchTime} ${live ? styles.matchTimeLive : ''}`}>
                  {live ? (
                    <span className={styles.matchLiveTag}>
                      <span className={styles.matchLiveDot} /> EN VIVO
                    </span>
                  ) : ev.status === 'finished' ? 'FIN' : ev.hour}
                </div>
                <div className={styles.matchBody}>
                  <div className={styles.matchTitle}>{ev.title}</div>
                  <div className={styles.matchMeta}>
                    {ev.competition}
                    {ev.relTime ? ` · ${ev.relTime}` : ''}
                    {ev.streams.length ? ` · ${ev.streams.length} canal${ev.streams.length > 1 ? 'es' : ''}` : ''}
                  </div>
                </div>
                <button
                  className={`${styles.matchBtn} ${live ? styles.matchBtnLive : ''}`}
                  disabled={!playable}
                  onClick={() => playEvent(ev)}
                >
                  {live ? <><IconPlay size={11} /> Ver</> : <><IconBell size={12} /> {playable ? 'Ver' : '—'}</>}
                </button>
              </div>
            );
          })}
          {!visibleEvents.length && (
            <div className={styles.emptyAgenda}>
              <IconCalendar size={28} color="rgba(255,255,255,0.25)" />
              <p>
                {agendaFilter === 'live' && 'No hay eventos en vivo ahora mismo.'}
                {agendaFilter === 'upcoming' && 'No hay próximos eventos hoy.'}
                {agendaFilter === 'finished' && 'Aún no hay eventos finalizados.'}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* ===== RIGHT DETAIL PANEL (rediseñado) ===== */}
      <aside className={styles.detail}>
        <div className={`${styles.detailGlow} lt-glow`} aria-hidden="true" />
        <div className={styles.detailInner}>
          <div className={styles.detailHead}>
            <span className={styles.detailEyebrow}>Reproduciendo</span>
            <span className={styles.detailLive}>
              <span className={styles.matchLiveDot} /> EN VIVO
            </span>
          </div>

          {currentChannel ? (
            <div className={styles.hero}>
              {getLogoFor(currentChannel) && (
                <img className={styles.heroBg} src={getLogoFor(currentChannel)} alt="" aria-hidden="true" />
              )}
              <div className={styles.heroLogo}>
                <ChannelLogo ch={currentChannel} size={76} radius={22} />
              </div>
              <div className={styles.heroName}>{currentChannel.name}</div>
              <div className={styles.heroMeta}>{regionLabel(currentChannel.region)}</div>
              <button
                type="button"
                className={`${styles.heroFav} ${fav ? styles.heroFavOn : ''}`}
                onClick={() => toggleFavorite(currentChannel.id)}
              >
                <IconStar size={15} color="currentColor" fill={fav ? 'currentColor' : 'none'} />
                {fav ? 'En favoritos' : 'Agregar a favoritos'}
              </button>
            </div>
          ) : (
            <div className={styles.curEmpty}>Selecciona un canal</div>
          )}

          <div className={styles.detailSectionLabel}>Más canales</div>
          <div className={styles.detailList}>
            {otherChannels.map((ch) => (
              <button key={ch.id} type="button" className={styles.detailRow} onClick={() => setCurrentChannel(ch)}>
                <ChannelLogo ch={ch} size={38} radius={12} />
                <span className={styles.detailRowText}>
                  <span className={styles.detailRowName}>{ch.name}</span>
                  <span className={styles.detailRowTag}>{regionLabel(ch.region)}</span>
                </span>
                <svg className={styles.detailGo} width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
                  <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
            {!otherChannels.length && <p className={styles.emptyMini}>No hay otros canales.</p>}
          </div>

          <div className={styles.detailFooter}>
            <span>Reproductor: {playerEngine}</span>
            <span className={styles.statusOk}>● en vivo</span>
          </div>
        </div>
      </aside>

      <LtMobileTabs />
    </div>
  );
}
