import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useContext, lazy, Suspense } from 'react';
import { ChannelProvider, ChannelContext } from './context/ChannelContext';
import { FavoritesProvider } from './context/FavoritesContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import LoadingSpinner from './components/LoadingSpinner/LoadingSpinner';
import UpdateGate from './components/UpdateGate/UpdateGate';
import PersistentPlayer from './components/PersistentPlayer/PersistentPlayer';
import styles from './App.module.css';

// Code-splitting: las pantallas secundarias se cargan bajo demanda para que el
// arranque (Home) sea más liviano — clave en TVs y conexiones lentas.
const Live = lazy(() => import('./pages/Live'));
const Channels = lazy(() => import('./pages/Channels'));
const Settings = lazy(() => import('./pages/Settings'));
const ChannelPage = lazy(() => import('./pages/ChannelPage'));
const AdminLogin = lazy(() => import('./pages/Admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/Admin/AdminDashboard'));

// Rutas con su propio shell (LtSidebar + tab bar móvil): ocultan el header/footer
// global para no duplicar navegación.
const FULLSCREEN_ROUTES = ['/', '/en-vivo', '/canales', '/favoritos', '/config'];

function GlobalSearch() {
  const { searchQuery, setSearchQuery, channels } = useContext(ChannelContext);
  return (
    <div className={styles.searchWrap}>
      <svg className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M10 4a6 6 0 1 1-3.873 10.568l-4.243 4.243-1.414-1.414 4.243-4.243A6 6 0 0 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>
      </svg>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={`Buscar entre ${channels.length} canales...`}
        className={styles.searchInput}
        aria-label="Buscar canal"
      />
      {searchQuery && (
        <button
          className={styles.clearBtn}
          onClick={() => setSearchQuery('')}
          aria-label="Limpiar búsqueda"
        >×</button>
      )}
    </div>
  );
}

function HealthRefreshButton() {
  const { liveSlugs, channels, healthLoading, refreshHealth } = useContext(ChannelContext);
  const liveCount = liveSlugs.size;
  const totalCount = channels.length;
  return (
    <button
      className={`${styles.healthBtn} ${healthLoading ? styles.healthSpin : ''}`}
      onClick={refreshHealth}
      disabled={healthLoading}
      title="Verificar qué canales están disponibles ahora mismo"
    >
      <span className={styles.healthDot} />
      {healthLoading ? 'Verificando...' : `${liveCount}/${totalCount} live`}
      <span className={styles.healthRefresh}>↻</span>
    </button>
  );
}

function Header() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  // Las pantallas con shell propio (Agenda, En vivo, Canales, etc.) ya traen
  // marca, búsqueda y navegación, así que ocultamos el header global ahí.
  if (FULLSCREEN_ROUTES.includes(location.pathname)) return null;
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        <span className={styles.brandLogo} aria-hidden="true">
          <span className={styles.brandLogoDot} />
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandFofo}>Fofo</span>
          <span className={styles.brandStudio}>Studio</span>
          <span className={styles.brandSeparator}>·</span>
          <span className={styles.brandLocalTv}>LocalTv</span>
        </span>
      </Link>

      {!isAdmin && <GlobalSearch />}

      <nav className={styles.nav}>
        {!isAdmin && <HealthRefreshButton />}
        <Link to="/" className={`${styles.navLink} ${location.pathname === '/' ? styles.navActive : ''}`}>
          Inicio
        </Link>
        <Link to="/admin" className={`${styles.navLink} ${isAdmin ? styles.navActive : ''}`}>
          Admin
        </Link>
        <span className={styles.versionTag}>v{import.meta.env.VITE_APP_VERSION || '0.0.0'}</span>
      </nav>
    </header>
  );
}

function Footer() {
  const location = useLocation();
  const v = import.meta.env.VITE_APP_VERSION || '0.0.0';
  // Las pantallas con shell propio incluyen su propio footer/estado.
  if (FULLSCREEN_ROUTES.includes(location.pathname)) return null;
  return (
    <footer className={styles.footer}>
      <span className={styles.footerLeft}>
        <span className={styles.footerLogo} aria-hidden="true">
          <span className={styles.footerLogoDot} />
        </span>
        <span>
          LocalTv <span className={styles.footerSep}>·</span>{' '}
          <a
            href="https://github.com/fofostudio"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerLink}
          >
            creado por <strong>FofoStudio</strong>
          </a>
        </span>
      </span>
      <span className={styles.footerRight}>
        <a
          href="https://github.com/fofostudio/LocalTv-FofoStudio-Edition"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          GitHub
        </a>
        <span className={styles.footerSep}>·</span>
        <a
          href={`https://github.com/fofostudio/LocalTv-FofoStudio-Edition/releases/tag/v${v}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          v{v}
        </a>
        <span className={styles.footerSep}>·</span>
        <span className={styles.footerMuted}>MIT</span>
      </span>
    </footer>
  );
}

export default function App() {
  return (
    <UpdateGate>
      <FavoritesProvider>
        <ChannelProvider>
          <BrowserRouter>
            <div className={styles.appContainer}>
              <Header />
              <main className={styles.routesContainer}>
                <Suspense fallback={<LoadingSpinner />}>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/en-vivo" element={<Live />} />
                    <Route path="/canales" element={<Channels />} />
                    <Route path="/favoritos" element={<Channels favoritesOnly />} />
                    <Route path="/config" element={<Settings />} />
                    <Route path="/channel/:channelId" element={<ChannelPage />} />
                    <Route path="/admin" element={<AdminLogin />} />
                    <Route
                      path="/admin/dashboard"
                      element={
                        <ProtectedRoute>
                          <AdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                  </Routes>
                </Suspense>
              </main>
              <Footer />
              <PersistentPlayer />
            </div>
          </BrowserRouter>
        </ChannelProvider>
      </FavoritesProvider>
    </UpdateGate>
  );
}
