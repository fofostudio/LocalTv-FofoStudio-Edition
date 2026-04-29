import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { ChannelProvider } from './context/ChannelContext';
import { FavoritesProvider } from './context/FavoritesContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import ChannelPage from './pages/ChannelPage';
import AdminLogin from './pages/Admin/AdminLogin';
import AdminDashboard from './pages/Admin/AdminDashboard';
import styles from './App.module.css';

export default function App() {
  return (
    <FavoritesProvider>
      <ChannelProvider>
        <BrowserRouter>
          <div className={styles.appContainer}>
            <header className={styles.brandHeader}>
              <Link to="/" className={styles.brand}>
                FofoStudio
                <span className={styles.brandSuffix}>· LocalTv</span>
              </Link>
              <span className={styles.brandTagline}>FofoStudio Edition</span>
            </header>
            <div className={styles.routesContainer}>
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
            </div>
          </div>
        </BrowserRouter>
      </ChannelProvider>
    </FavoritesProvider>
  );
}
