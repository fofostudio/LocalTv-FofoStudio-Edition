import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import ChannelForm from './ChannelForm';
import styles from './Admin.module.css';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function AdminDashboard() {
  const [apiKey] = useState(() => localStorage.getItem('apiKey'));
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!apiKey) {
      navigate('/admin');
      return;
    }
    loadChannels();
  }, [apiKey, navigate]);

  const loadChannels = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/api/channels`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) throw new Error('Error loading channels');
      const data = await res.json();
      setChannels(data);
      setError('');
    } catch (err) {
      setError('Error al cargar los canales');
      console.error('Load error:', err);
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
      await api.updateChannel(
        channel.id,
        { ...channel, is_active: !channel.is_active },
        apiKey
      );
      setChannels(
        channels.map((ch) =>
          ch.id === channel.id ? { ...ch, is_active: !ch.is_active } : ch
        )
      );
    } catch (err) {
      alert('Error al actualizar el canal');
      console.error('Toggle error:', err);
    }
  };

  const handleDeleteChannel = async (channel) => {
    if (!window.confirm(`¿Eliminar canal "${channel.nombre}"?`)) {
      return;
    }

    try {
      await api.deleteChannel(channel.id, apiKey);
      setChannels(channels.filter((ch) => ch.id !== channel.id));
      alert('Canal eliminado exitosamente');
    } catch (err) {
      alert('Error al eliminar el canal');
      console.error('Delete error:', err);
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedChannel(null);
  };

  const handleFormSuccess = () => {
    loadChannels();
  };

  if (!apiKey) {
    return null;
  }

  return (
    <div className={styles.dashboardWrapper}>
      <div className={styles.dashboardHeader}>
        <h1>Panel de Administración</h1>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          Cerrar Sesión
        </button>
      </div>

      <div className={styles.dashboardContainer}>
        <div className={styles.tableToolbar}>
          <h2>Canales</h2>
          <button onClick={handleAddChannel} className={styles.button}>
            + Agregar Canal Nuevo
          </button>
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
                  <th>Categoría</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={styles.noDataCell}>
                      No hay canales. Crea uno nuevo para empezar.
                    </td>
                  </tr>
                ) : (
                  channels.map((channel) => (
                    <tr key={channel.id}>
                      <td>{channel.id}</td>
                      <td>{channel.nombre}</td>
                      <td>{channel.slug}</td>
                      <td>{channel.categoria}</td>
                      <td>
                        <span
                          className={
                            channel.is_active
                              ? styles.badgeActive
                              : styles.badgeInactive
                          }
                        >
                          {channel.is_active ? 'Sí' : 'No'}
                        </span>
                      </td>
                      <td>
                        <div className={styles.actionButtons}>
                          <button
                            className={styles.actionBtn}
                            onClick={() => handleToggleChannel(channel)}
                            title={
                              channel.is_active ? 'Desactivar' : 'Activar'
                            }
                          >
                            {channel.is_active ? '⊘' : '⊕'}
                          </button>
                          <button
                            className={styles.actionBtnEdit}
                            onClick={() => handleEditChannel(channel)}
                            title="Editar"
                          >
                            ✎
                          </button>
                          <button
                            className={styles.actionBtnDelete}
                            onClick={() => handleDeleteChannel(channel)}
                            title="Eliminar"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ChannelForm
          channel={selectedChannel}
          apiKey={apiKey}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
}
