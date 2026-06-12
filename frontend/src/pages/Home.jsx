import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { isLite } from '../utils/device';
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
  const navigate = useNavigate();
  const {
    channels, currentChannel, setCurrentChannel,
    filteredChannels, healthLoading, refreshHealth, categories,
  } = useContext(ChannelContext);
  const { isFavorite, toggleFavorite } = useContext(FavoritesContext);
  const { events, counts, loading: eventsLoading } = useDiaryEvents();
  const playerEngine = usePlayerEngine();

  // En TV (lite) renderizamos MUCHO menos DOM: menos canales por fila, menos
  // filas y menos "más canales". Menos nodos = scroll y pintado fluidos.
  // isLite() se lee en render (el atributo data-lite ya está aplicado).
  const TV = isLite();
  const STRIP_MAX = TV ? 14 : 30;   // tira superior de canales
  const ROW_MAX = TV ? 3 : 6;       // filas de categoría
  const ROW_ITEMS = TV ? 8 : 15;    // canales por fila
  const MORE_MAX = TV ? 8 : 12;     // "Más canales"

  const [agendaFilter, setAgendaFilter] = useState('live');

  const visibleEvents = useMemo(
    () => events.filter((e) => e.status === agendaFilter),
    [events, agendaFilter]
  );

  // Map category id -> info (lo necesita "Más canales" para etiquetar y agrupar).
  const catMap = useMemo(() => {
    const m = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  // "Más canales" = los de la MISMA categoría que el canal actual (sin el actual);
  // si quedan pocos, se completa con el resto. Así lo de al lado es afín a lo que ves.
  const otherChannels = useMemo(() => {
    const rest = filteredChannels.filter((c) => c.id !== currentChannel?.id);
    if (currentChannel?.category_id == null) return rest.slice(0, MORE_MAX);
    const same = rest.filter((c) => c.category_id === currentChannel.category_id);
    const diff = rest.filter((c) => c.category_id !== currentChannel.category_id);
    return [...same, ...diff].slice(0, MORE_MAX);
  }, [filteredChannels, currentChannel]);

  // Etiqueta de la sección: el nombre de la categoría que se está viendo.
  const currentCatName = currentChannel
    ? (catMap[currentChannel.category_id]?.name || null)
    : null;

  const catRows = useMemo(() => {
    const groups = {};
    for (const ch of filteredChannels) {
      const cat = catMap[ch.category_id];
      const slug = cat ? cat.slug : 'general';
      const name = cat ? cat.name : 'General';
      if (!groups[slug]) groups[slug] = { name, channels: [] };
      if (groups[slug].channels.length < ROW_ITEMS) groups[slug].channels.push(ch);
    }
    // La categoría del canal actual va primero (es la que estás viendo).
    const curSlug = catMap[currentChannel?.category_id]?.slug;
    const entries = Object.entries(groups).sort(([a], [b]) => {
      if (a === curSlug) return -1;
      if (b === curSlug) return 1;
      return 0;
    });
    return entries.slice(0, ROW_MAX);
  }, [filteredChannels, catMap, currentChannel]);

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
        <div className={`${styles.chStrip} lt-stagger`}>
          {filteredChannels.slice(0, STRIP_MAX).map((ch) => {
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

          {/* Category rows */}
          {catRows.map(([slug, group]) => (
            <div key={slug} className={styles.catRow}>
              <div className={styles.catRowHead}>
                <h4 className={styles.catRowTitle}>{group.name}</h4>
                <button
                  type="button"
                  className={styles.catRowMore}
                  onClick={() => navigate(`/channels?cat=${slug}`)}
                >Ver todos</button>
              </div>
              <div className={`${styles.catRowStrip} lt-stagger`}>
                {group.channels.map((ch) => {
                  const selected = currentChannel?.id === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      className={`${styles.catRowCard} ${selected ? styles.catRowCardActive : ''}`}
                      onClick={() => setCurrentChannel(ch)}
                    >
                      <div className={styles.catRowThumb}>
                        {!TV && getLogoFor(ch) ? (
                          <img src={getLogoFor(ch)} alt="" className={styles.catRowImg} loading="lazy" />
                        ) : (
                          <span className={styles.catRowCode}>{ch.name.slice(0, 3).toUpperCase()}</span>
                        )}
                      </div>
                      <span className={styles.catRowName}>{ch.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
              {!TV && getLogoFor(currentChannel) && (
                <img className={styles.heroBg} src={getLogoFor(currentChannel)} alt="" aria-hidden="true" loading="lazy" />
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

          <div className={styles.detailSectionLabel}>
            {currentCatName ? `Más de ${currentCatName}` : 'Más canales'}
          </div>
          <div className={`${styles.detailList} lt-stagger`}>
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
