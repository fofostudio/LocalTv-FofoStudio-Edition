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
