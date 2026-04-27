import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from './Admin.module.css';

export default function ChannelForm({ onClose, onSuccess, channel = null, apiKey }) {
  const [formData, setFormData] = useState({
    nombre: '',
    slug: '',
    stream_url: '',
    logo_url: '',
    categoria: '',
    is_active: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    // Fetch categories
    fetch('http://localhost:8000/api/categories')
      .then(res => res.json())
      .then(data => setCategories(data))
      .catch(err => console.error('Error fetching categories:', err));

    if (channel) {
      setFormData({
        nombre: channel.nombre || '',
        slug: channel.slug || '',
        stream_url: channel.stream_url || '',
        logo_url: channel.logo_url || '',
        categoria: channel.categoria || '',
        is_active: channel.is_active !== false,
      });
    }
  }, [channel]);

  const generateSlug = (nombre) => {
    return nombre.toLowerCase().replace(/\s+/g, '-');
  };

  const handleNombreChange = (e) => {
    const nombre = e.target.value;
    setFormData({
      ...formData,
      nombre,
      slug: generateSlug(nombre),
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleCheckboxChange = (e) => {
    setFormData({ ...formData, is_active: e.target.checked });
  };

  const isValidUrl = (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const validateForm = () => {
    if (!formData.nombre.trim()) {
      setError('El nombre es requerido');
      return false;
    }
    if (!formData.slug.trim()) {
      setError('El slug es requerido');
      return false;
    }
    if (!formData.stream_url.trim()) {
      setError('La URL de stream es requerida');
      return false;
    }
    if (!isValidUrl(formData.stream_url)) {
      setError('URL de stream inválida');
      return false;
    }
    if (!formData.logo_url.trim()) {
      setError('La URL del logo es requerida');
      return false;
    }
    if (!isValidUrl(formData.logo_url)) {
      setError('URL del logo inválida');
      return false;
    }
    if (!formData.categoria.trim()) {
      setError('Selecciona una categoría');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      if (channel) {
        // Edit
        await api.updateChannel(channel.id, formData, apiKey);
        alert('Canal actualizado exitosamente');
      } else {
        // Create
        await api.createChannel(formData, apiKey);
        alert('Canal creado exitosamente');
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar el canal');
      console.error('Form error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.formOverlay}>
      <div className={styles.formContainer}>
        <div className={styles.formHeader}>
          <h2>{channel ? 'Editar Canal' : 'Crear Nuevo Canal'}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label>Nombre del Canal *</label>
            <input
              type="text"
              name="nombre"
              value={formData.nombre}
              onChange={handleNombreChange}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Slug (Auto-generado) *</label>
            <input
              type="text"
              name="slug"
              value={formData.slug}
              onChange={handleInputChange}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label>URL de Stream *</label>
            <input
              type="url"
              name="stream_url"
              value={formData.stream_url}
              onChange={handleInputChange}
              className={styles.input}
              placeholder="https://example.com/stream.m3u8"
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label>URL del Logo *</label>
            <input
              type="url"
              name="logo_url"
              value={formData.logo_url}
              onChange={handleInputChange}
              className={styles.input}
              placeholder="https://example.com/logo.png"
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Categoría *</label>
            <select
              name="categoria"
              value={formData.categoria}
              onChange={handleInputChange}
              className={styles.input}
              disabled={loading}
            >
              <option value="">Selecciona una categoría</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.nombre}>
                  {cat.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>
              <input
                type="checkbox"
                name="is_active"
                checked={formData.is_active}
                onChange={handleCheckboxChange}
                disabled={loading}
              />
              Activo
            </label>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.button}
              disabled={loading}
            >
              {loading ? 'Guardando...' : channel ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
