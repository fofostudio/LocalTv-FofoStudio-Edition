import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import ChannelForm from './ChannelForm';
import styles from './Admin.module.css';

export default function AdminDashboard() {
  const [apiKey] = useState(() => localStorage.getItem('apiKey'));
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [iptvStatus, setIptvStatus] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [iptvAllStatus, setIptvAllStatus] = useState(null);
  const [iptvCategories, setIptvCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [xtreamCfg, setXtreamCfg] = useState(null);
  const [xtreamStatus, setXtreamStatus] = useState(null);
  const [xtreamImporting, setXtreamImporting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!apiKey) {
      navigate('/admin');
      return;
    }
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const loadChannels = async () => {
    try {
      setLoading(true);
      const data = await api.validateApiKey(apiKey);
      setChannels(data);
      setError('');
      // Cargar categorías iptv-org disponibles
      api.getIptvCategories().then(setIptvCategories).catch(() => {});
      // Estado de la integración Xtream (Magma)
      api.xtreamStatus(apiKey).then(setXtreamCfg).catch(() => {});
    } catch (err) {
      setError('Error al cargar los canales');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('apiKey');
    navigate('/admin');
  };

  const handleAddChannel = () => {
    setSelectedChannel(null);
    setShowForm(true);
  };

  const handleEditChannel = (channel) => {
    setSelectedChannel(channel);
    setShowForm(true);
  };

  const handleToggleChannel = async (channel) => {
    try {
      await api.updateChannel(channel.id, { is_active: !channel.is_active }, apiKey);
      setChannels(channels.map((ch) =>
        ch.id === channel.id ? { ...ch, is_active: !ch.is_active } : ch
      ));
    } catch (err) {
      alert('Error al actualizar el canal');
    }
  };

  const handleDeleteChannel = async (channel) => {
    if (!window.confirm(`¿Eliminar canal "${channel.name}"?`)) return;
    try {
      await api.deleteChannel(channel.id, apiKey);
      setChannels(channels.filter((ch) => ch.id !== channel.id));
    } catch (err) {
      alert('Error al eliminar el canal');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await api.syncChannels(apiKey);
      setSyncStatus({
        type: 'ok',
        text: `Sincronización OK — ${result.created} nuevos, ${result.updated} actualizados (${result.total_scraped} totales).`,
      });
      await loadChannels();
    } catch (err) {
      setSyncStatus({ type: 'error', text: err.message || 'Error sincronizando' });
    } finally {
      setSyncing(false);
    }
  };

  const handleIptvImport = async () => {
    if (!selectedCategory) return;
    setImporting(true);
    setIptvStatus(null);
    try {
      const result = await api.importFromIptv(selectedCategory, apiKey);
      setIptvStatus({
        type: 'ok',
        text: `Importación iptv-org (${selectedCategory}) — ${result.created} nuevos, ${result.skipped} omitidos (${result.total} totales).`,
      });
      await loadChannels();
    } catch (err) {
      setIptvStatus({ type: 'error', text: err.message || 'Error importando' });
    } finally {
      setImporting(false);
    }
  };

  const handleIptvImportAll = async () => {
    setImportingAll(true);
    setIptvAllStatus(null);
    try {
      const result = await api.importAllFromIptv(apiKey);
      setIptvAllStatus({
        type: 'ok',
        text: `Importación masiva completada — ${result.created} nuevos, ${result.skipped} omitidos de ${result.categories_imported.length} categorías.`,
      });
      await loadChannels();
    } catch (err) {
      setIptvAllStatus({ type: 'error', text: err.message || 'Error en importación masiva' });
    } finally {
      setImportingAll(false);
    }
  };

  const handleXtreamImport = async (live) => {
    setXtreamImporting(true);
    setXtreamStatus(null);
    try {
      const result = await api.importXtream({ provider: 'Magma', live }, apiKey);
      const playable = result.configured
        ? `${result.created + result.updated} reproducibles`
        : `inactivos (faltan credenciales XTREAM_* en el .env)`;
      setXtreamStatus({
        type: 'ok',
        text: `Magma — ${result.created} nuevos, ${result.updated} actualizados, ${result.not_spanish} no-español omitidos · ${playable}.`,
      });
      api.xtreamStatus(apiKey).then(setXtreamCfg).catch(() => {});
      await loadChannels();
    } catch (err) {
      setXtreamStatus({ type: 'error', text: err.message || 'Error importando Magma' });
    } finally {
      setXtreamImporting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setXtreamStatus(null);
    try {
      const r = await api.verifyChannels('', apiKey);
      setXtreamStatus({
        type: 'ok',
        text: `Verificación — ${r.alive} reproducen, ${r.dead} muertos desactivados (${r.checked} revisados).`,
      });
      await loadChannels();
    } catch (err) {
      setXtreamStatus({ type: 'error', text: err.message || 'Error verificando' });
    } finally {
      setVerifying(false);
    }
  };

  if (!apiKey) return null;

  return (
    <div className={styles.dashboardWrapper}>
      <div className={styles.dashboardHeader}>
        <h1>Panel de Administración</h1>
        <button onClick={handleLogout} className={styles.logoutBtn}>Cerrar Sesión</button>
      </div>

      <div className={styles.dashboardContainer}>
        <div className={styles.tableToolbar}>
          <h2>Canales <span className={styles.countBadge}>{channels.length}</span></h2>
          <div className={styles.toolbarActions}>
            <button onClick={handleSync} className={styles.buttonSecondary} disabled={syncing}>
              {syncing ? 'Sincronizando...' : '↻ Sincronizar desde tvtvhd'}
            </button>
            <button onClick={handleAddChannel} className={styles.button}>
              + Agregar Canal
            </button>
          </div>
        </div>

        {syncStatus && (
          <p className={syncStatus.type === 'ok' ? styles.successText : styles.error}>
            {syncStatus.text}
          </p>
        )}

        <div className={styles.iptvSection}>
          <h3>Importar desde iptv-org</h3>
          <div className={styles.iptvRow}>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={styles.input}
              style={{ maxWidth: 300 }}
              disabled={importing}
            >
              <option value="">Selecciona categoría</option>
              {iptvCategories.map((cat) => (
                <option key={cat.slug} value={cat.slug}>{cat.label}</option>
              ))}
            </select>
            <button onClick={handleIptvImport} className={styles.buttonSecondary} disabled={importing || !selectedCategory}>
              {importing ? 'Importando...' : '⬇ Importar'}
            </button>
            <button onClick={handleIptvImportAll} className={styles.button} disabled={importingAll} style={{ width: 'auto' }}>
              {importingAll ? 'Importando todas...' : '⬇ Importar Todas'}
            </button>
          </div>
          {iptvStatus && (
            <p className={iptvStatus.type === 'ok' ? styles.successText : styles.error}>
              {iptvStatus.text}
            </p>
          )}
          {iptvAllStatus && (
            <p className={iptvAllStatus.type === 'ok' ? styles.successText : styles.error}>
              {iptvAllStatus.text}
            </p>
          )}
        </div>

        <div className={styles.iptvSection}>
          <h3>
            Importar Xtream — Magma{' '}
            {xtreamCfg && (
              <span className={xtreamCfg.configured ? styles.badgeActive : styles.badgeInactive}>
                {xtreamCfg.configured ? 'credenciales OK' : 'sin credenciales'}
              </span>
            )}
          </h3>
          <p className={styles.loadingText} style={{ marginTop: 0 }}>
            {xtreamCfg ? `${xtreamCfg.catalog_channels} canales en el catálogo local (solo español).` : ''}
            {xtreamCfg && !xtreamCfg.configured && (
              <> Define <code>XTREAM_HOST</code>, <code>XTREAM_USERNAME</code> y <code>XTREAM_PASSWORD</code> en el <code>.env</code> del backend para reproducirlos.</>
            )}
          </p>
          <div className={styles.iptvRow}>
            <button onClick={() => handleXtreamImport(false)} className={styles.buttonSecondary} disabled={xtreamImporting}>
              {xtreamImporting ? 'Importando...' : '⬇ Importar catálogo (offline)'}
            </button>
            <button
              onClick={() => handleXtreamImport(true)}
              className={styles.button}
              disabled={xtreamImporting || !(xtreamCfg && xtreamCfg.configured)}
              style={{ width: 'auto' }}
              title={xtreamCfg && xtreamCfg.configured ? 'Consulta el panel con tus credenciales' : 'Requiere credenciales XTREAM_* en el .env'}
            >
              {xtreamImporting ? 'Importando...' : '⬇ Importar en vivo'}
            </button>
            <button
              onClick={handleVerify}
              className={styles.buttonSecondary}
              disabled={verifying}
              title="Prueba las URLs y deja activos solo los que reproducen"
            >
              {verifying ? 'Verificando...' : '✓ Verificar y limpiar'}
            </button>
          </div>
          {xtreamStatus && (
            <p className={xtreamStatus.type === 'ok' ? styles.successText : styles.error}>
              {xtreamStatus.text}
            </p>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {loading ? (
          <p className={styles.loadingText}>Cargando canales...</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre</th>
                  <th>Slug</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan="5" className={styles.noDataCell}>
                      No hay canales. Crea uno o sincroniza desde tvtvhd.
                    </td>
                  </tr>
                ) : channels.map((channel) => (
                  <tr key={channel.id}>
                    <td>{channel.id}</td>
                    <td>{channel.name}</td>
                    <td>{channel.slug}</td>
                    <td>
                      <span className={channel.is_active ? styles.badgeActive : styles.badgeInactive}>
                        {channel.is_active ? 'Sí' : 'No'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actionButtons}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleToggleChannel(channel)}
                          title={channel.is_active ? 'Desactivar' : 'Activar'}
                        >
                          {channel.is_active ? '⊘' : '⊕'}
                        </button>
                        <button
                          className={styles.actionBtnEdit}
                          onClick={() => handleEditChannel(channel)}
                          title="Editar"
                        >✎</button>
                        <button
                          className={styles.actionBtnDelete}
                          onClick={() => handleDeleteChannel(channel)}
                          title="Eliminar"
                        >🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ChannelForm
          channel={selectedChannel}
          apiKey={apiKey}
          onClose={() => { setShowForm(false); setSelectedChannel(null); }}
          onSuccess={loadChannels}
        />
      )}
    </div>
  );
}
