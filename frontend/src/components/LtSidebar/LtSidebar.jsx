import { useContext } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChannelContext } from '../../context/ChannelContext';
import { LocalTvMark, LocalTvWordmark } from '../Brand/Brand';
import ChannelBadge from '../ChannelBadge/ChannelBadge';
import {
  IconCalendar, IconLive, IconTv, IconStar, IconSettings, IconSearch, IconRefresh,
} from '../icons/Icons';
import { regionLabel } from '../../utils/channelDisplay';
import { isLite } from '../../utils/device';
import styles from './LtSidebar.module.css';

const LITE_MAX = 60; // en modo TV limitamos el DOM para que cargue ágil

const NAV = [
  { to: '/', label: 'Agenda', Icon: IconCalendar, end: true },
  { to: '/en-vivo', label: 'En vivo', Icon: IconLive, live: true },
  { to: '/canales', label: 'Canales', Icon: IconTv },
  { to: '/favoritos', label: 'Favoritos', Icon: IconStar },
  { to: '/config', label: 'Configuración', Icon: IconSettings },
];

export default function LtSidebar() {
  const {
    channels, currentChannel, setCurrentChannel,
    filteredChannels, searchQuery, setSearchQuery,
    liveSlugs, healthLoading, refreshHealth, healthCheckedAt,
  } = useContext(ChannelContext);
  const location = useLocation();
  const navigate = useNavigate();

  const liveCount = liveSlugs.size;
  const lastSync = healthCheckedAt
    ? healthCheckedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : 'Listo';

  const pickChannel = (ch) => {
    setCurrentChannel(ch);
    if (location.pathname !== '/') navigate('/');
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <LocalTvMark size={30} radius={8} />
        <div>
          <LocalTvWordmark size={16} />
          <div className={styles.brandSub}>FofoStudio Edition · v{import.meta.env.VITE_APP_VERSION || '1.0.0'}</div>
        </div>
      </div>

      <div className={styles.sectionLabel}>NAVEGAR</div>
      <nav className={styles.nav}>
        {NAV.map(({ to, label, Icon, end, live }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
          >
            {({ isActive }) => (
              <>
                <Icon size={16} color={isActive ? 'var(--lt-blue)' : 'var(--lt-mute)'} />
                <span>{label}</span>
                {live && liveCount > 0 && <span className={styles.navBadge}>{liveCount}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}><IconSearch size={14} color="rgba(255,255,255,0.45)" /></span>
        <input
          className={styles.searchInput}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar canal..."
          aria-label="Buscar canal"
        />
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Canales · {channels.length}</span>
        <span className={styles.sectionLive}>
          <span className={`${styles.dot} ${styles.dotLive}`} /> en vivo
        </span>
      </div>

      <div className={styles.list}>
        {(isLite() ? filteredChannels.slice(0, LITE_MAX) : filteredChannels).map((ch) => (
          <button
            key={ch.id}
            type="button"
            className={`${styles.row} ${currentChannel?.id === ch.id ? styles.rowActive : ''}`}
            onClick={() => pickChannel(ch)}
          >
            <ChannelBadge ch={ch} />
            <span className={styles.rowText}>
              <span className={styles.rowName}>{ch.name}</span>
              <span className={styles.rowTag}>{regionLabel(ch.region)}</span>
            </span>
            <span className={`${styles.dot} ${styles.dotLive}`} />
          </button>
        ))}
        {isLite() && filteredChannels.length > LITE_MAX && (
          <p className={styles.empty}>+{filteredChannels.length - LITE_MAX} más · usá la búsqueda</p>
        )}
        {!filteredChannels.length && <p className={styles.empty}>Sin canales para mostrar.</p>}
      </div>

      <button
        type="button"
        className={`${styles.footer} ${healthLoading ? styles.spinning : ''}`}
        onClick={refreshHealth}
        disabled={healthLoading}
        title="Re-sincronizar canales"
      >
        <span className={styles.footerLeft}>
          <span className={`${styles.dot} ${styles.dotLive}`} />
          {healthLoading ? 'Sincronizando…' : 'Todo en línea'}
        </span>
        <span className={styles.footerRight}>
          {lastSync} <IconRefresh size={13} color="rgba(255,255,255,0.5)" />
        </span>
      </button>
    </aside>
  );
}
