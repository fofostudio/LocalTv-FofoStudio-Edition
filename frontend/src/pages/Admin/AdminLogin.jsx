import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import styles from './Admin.module.css';

export default function AdminLogin() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Ingresa una API Key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.validateApiKey(apiKey);
      localStorage.setItem('apiKey', apiKey);
      navigate('/admin/dashboard');
    } catch (err) {
      if (err.message === 'API Key inválida') {
        setError('API Key inválida');
      } else {
        setError('Error al conectar con el servidor');
      }
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginBox}>
        <h1>Admin Login</h1>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={styles.input}
            disabled={loading}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? 'Validando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
