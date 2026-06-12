import { NavLink } from 'react-router-dom';
import { IconHome, IconLive, IconTv, IconUser, IconMovie, IconFilm } from '../icons/Icons';
import styles from './LtMobileTabs.module.css';

const TABS = [
  { to: '/', label: 'Inicio', Icon: IconHome, end: true },
  { to: '/en-vivo', label: 'En vivo', Icon: IconLive },
  { to: '/canales', label: 'Canales', Icon: IconTv },
  { to: '/peliculas', label: 'Películas', Icon: IconMovie },
  { to: '/series', label: 'Series', Icon: IconFilm },
  { to: '/config', label: 'Perfil', Icon: IconUser },
];

export default function LtMobileTabs() {
  return (
    <nav className={styles.tabs} aria-label="Navegación">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
        >
          {({ isActive }) => (
            <>
              <Icon size={22} color={isActive ? 'var(--lt-blue)' : 'var(--lt-mute)'} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
