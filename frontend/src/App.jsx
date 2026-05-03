import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useContext } from 'react';
import { ChannelProvider, ChannelContext } from './context/ChannelContext';
import { FavoritesProvider } from './context/FavoritesContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import ChannelPage from './pages/ChannelPage';
import AdminLogin from './pages/Admin/AdminLogin';
import AdminDashboard from './pages/Admin/AdminDashboard';
import styles from './App.module.css';

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
        <span className={styles.versionTag}>v1.0</span>
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <FavoritesProvider>
      <ChannelProvider>
        <BrowserRouter>
          <div className={styles.appContainer}>
            <Header />
            <main className={styles.routesContainer}>
              <Routes>
                <Route path="/" element={<Home />} />
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
            </main>
          </div>
        </BrowserRouter>
      </ChannelProvider>
    </FavoritesProvider>
  );
}
