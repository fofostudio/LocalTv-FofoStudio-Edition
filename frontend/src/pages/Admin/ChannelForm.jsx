import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from './Admin.module.css';

const slugify = (s) =>
  s.toLowerCase()
   .normalize('NFD')
   .replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, '-')
   .replace(/^-+|-+$/g, '');

export default function ChannelForm({ onClose, onSuccess, channel = null, apiKey }) {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    stream_url: '',
    logo_url: '',
    category_id: '',
    is_active: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => setCategories([]));
    if (channel) {
      setFormData({
        name: channel.name || '',
        slug: channel.slug || '',
        stream_url: channel.stream_url || '',
        logo_url: channel.logo_url || '',
        category_id: channel.category_id ?? '',
        is_active: channel.is_active !== false,
      });
    }
  }, [channel]);

  const handleNameChange = (e) => {
    const name = e.target.value;
    setFormData((f) => ({
      ...f,
      name,
      // Solo regenerar slug si estamos creando nuevo
      slug: channel ? f.slug : slugify(name),
    }));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((f) => ({ ...f, [name]: value }));
  };

  const isValidUrl = (url) => {
    try { new URL(url); return true; } catch { return false; }
  };

  const validate = () => {
    if (!formData.name.trim()) return 'El nombre es requerido';
    if (!formData.slug.trim()) return 'El slug es requerido';
    if (!formData.stream_url.trim()) return 'La URL de stream es requerida';
    if (!isValidUrl(formData.stream_url)) return 'URL de stream inválida';
    if (formData.logo_url && !isValidUrl(formData.logo_url)) return 'URL del logo inválida';
    if (!formData.category_id) return 'Selecciona una categoría';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        category_id: parseInt(formData.category_id, 10),
        logo_url: formData.logo_url || null,
      };
      if (channel) {
        await api.updateChannel(channel.id, payload, apiKey);
      } else {
        await api.createChannel(payload, apiKey);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar el canal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.formOverlay}>
      <div className={styles.formContainer}>
        <div className={styles.formHeader}>
          <h2>{channel ? 'Editar Canal' : 'Crear Nuevo Canal'}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} disabled={loading}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label>Nombre del Canal *</label>
            <input type="text" name="name" value={formData.name}
                   onChange={handleNameChange} className={styles.input} disabled={loading} />
          </div>

          <div className={styles.formGroup}>
            <label>Slug *</label>
            <input type="text" name="slug" value={formData.slug}
                   onChange={handleInputChange} className={styles.input} disabled={loading} />
          </div>

          <div className={styles.formGroup}>
            <label>URL de Stream *</label>
            <input type="url" name="stream_url" value={formData.stream_url}
                   onChange={handleInputChange} className={styles.input}
                   placeholder="https://tvtvhd.com/vivo/canales.php?stream=..." disabled={loading} />
          </div>

          <div className={styles.formGroup}>
            <label>URL del Logo (opcional)</label>
            <input type="url" name="logo_url" value={formData.logo_url}
                   onChange={handleInputChange} className={styles.input}
                   placeholder="https://example.com/logo.png" disabled={loading} />
          </div>

          <div className={styles.formGroup}>
            <label>Categoría *</label>
            <select name="category_id" value={formData.category_id}
                    onChange={handleInputChange} className={styles.input} disabled={loading}>
              <option value="">Selecciona una categoría</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>
              <input type="checkbox" name="is_active" checked={formData.is_active}
                     onChange={(e) => setFormData(f => ({ ...f, is_active: e.target.checked }))}
                     disabled={loading} />
              Activo
            </label>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.formActions}>
            <button type="button" className={styles.buttonSecondary} onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Guardando...' : channel ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
