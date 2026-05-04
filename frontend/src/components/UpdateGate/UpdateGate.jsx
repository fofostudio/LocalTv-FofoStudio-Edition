/**
 * UpdateGate
 *
 * Envuelve la app y verifica al arrancar si hay una versión nueva publicada
 * en GitHub Releases. Si es así, bloquea la UI con una pantalla full-screen
 * que solo permite descargar/instalar la actualización.
 *
 * - Si no hay red o falla el chequeo: NO bloquea (renderiza la app).
 * - Si la versión local >= la última: renderiza la app.
 * - Si la versión local <  la última: muestra el prompt obligatorio.
 *
 * Comportamiento por plataforma al pulsar "Actualizar":
 * - Android (Capacitor): plugin AppUpdater (descarga APK + intent install).
 * - Windows/macOS/Web: abre la URL del asset; el navegador / WebView lo
 *   descarga y el user lanza el installer.
 */
import { useEffect, useState } from 'react';
import styles from './UpdateGate.module.css';

const REPO = 'fofostudio/LocalTv-FofoStudio-Edition';
const CURRENT_VERSION = (import.meta.env.VITE_APP_VERSION || '0.0.0').replace(/^v/, '');

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function detectPlatform() {
  if (typeof window === 'undefined') return 'web';
  if (window.Capacitor?.isNativePlatform?.()) {
    const p = window.Capacitor.getPlatform?.();
    return p === 'android' ? 'android' : (p === 'ios' ? 'ios' : 'mobile');
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  const pf = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/mac|darwin/.test(pf) || /mac os x/.test(ua)) return 'mac';
  if (/win/.test(pf) || /windows/.test(ua)) return 'win';
  return 'web';
}

function pickAsset(assets, platform) {
  if (!Array.isArray(assets)) return null;
  if (platform === 'android') return assets.find((a) => /\.apk$/i.test(a.name));
  if (platform === 'win')     return assets.find((a) => /\.exe$/i.test(a.name));
  if (platform === 'mac')     return assets.find((a) => /\.dmg$/i.test(a.name));
  return null;
}

/**
 * Intenta auto-actualizar via el endpoint /api/update/install del backend
 * Python (que solo existe dentro del .exe / .app empaquetado). Si responde
 * 200 → la app se va a cerrar sola en ~1.5s. Si no hay backend (browser
 * puro) o no está bundled, devuelve false para que el caller use fallback.
 */
async function tryAutoUpdate(url, assetName) {
  try {
    // 1) Verificar que el backend tiene capability de auto-update
    const cap = await fetch('/api/update/capabilities', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!cap?.canAutoUpdate) return false;

    // 2) Disparar la instalación
    const res = await fetch('/api/update/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, asset_name: assetName }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export default function UpdateGate({ children }) {
  const [state, setState] = useState({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    const platform = detectPlatform();

    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      // No-cache para no quedarnos con un latest viejo
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const latest = (data?.tag_name || '').replace(/^v/, '');
        if (!latest) {
          setState({ status: 'ok' });
          return;
        }
        const cmp = compareVersions(latest, CURRENT_VERSION);
        if (cmp <= 0) {
          setState({ status: 'ok', latest, current: CURRENT_VERSION });
          return;
        }
        const asset = pickAsset(data.assets, platform);
        setState({
          status: 'outdated',
          latest,
          current: CURRENT_VERSION,
          asset,
          notes: data.body || '',
          publishedAt: data.published_at || '',
          platform,
          releaseUrl: data.html_url,
        });
      })
      .catch((err) => {
        // Sin red, rate-limit, etc: NO bloquear. La app debe abrir.
        console.warn('[UpdateGate] check fallo, sigue sin bloquear:', err?.message || err);
        if (!cancelled) setState({ status: 'ok', error: String(err?.message || err) });
      });

    return () => { cancelled = true; };
  }, []);

  if (state.status === 'checking') {
    return (
      <div className={styles.checking}>
        <div className={styles.spinner} />
        <div className={styles.checkingText}>Verificando actualizaciones…</div>
      </div>
    );
  }
  if (state.status === 'outdated') {
    return <UpdatePrompt {...state} />;
  }
  return children;
}

function UpdatePrompt({ latest, current, asset, notes, platform, releaseUrl }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [progress, setProgress] = useState(null); // 'downloading' | 'installing'

  const handleUpdate = async () => {
    setBusy(true);
    setErr(null);
    setProgress(null);

    try {
      // ----- Android: plugin Capacitor AppUpdater
      if (platform === 'android' && asset?.browser_download_url) {
        setProgress('downloading');
        const Updater = window.Capacitor?.Plugins?.AppUpdater;
        if (Updater?.downloadAndInstall) {
          await Updater.downloadAndInstall({
            url: asset.browser_download_url,
            filename: asset.name,
          });
          return;
        }
        if (window.Capacitor?.Plugins?.Browser?.open) {
          await window.Capacitor.Plugins.Browser.open({ url: asset.browser_download_url });
        } else {
          window.open(asset.browser_download_url, '_blank');
        }
        return;
      }

      // ----- Windows / macOS dentro del .exe / .app: usar endpoint nativo
      // que descarga e instala silencioso. Si no hay backend (browser web
      // puro) o no es bundled, cae a window.open.
      if ((platform === 'win' || platform === 'mac') && asset?.browser_download_url) {
        const handled = await tryAutoUpdate(asset.browser_download_url, asset.name);
        if (handled) {
          setProgress('installing');
          // El backend va a matar el proceso en ~1.5s. Mostramos un mensaje
          // y esperamos a que la app se cierre sola.
          return;
        }
      }

      // ----- Fallback general: abrir URL de descarga en el browser
      const url = asset?.browser_download_url || releaseUrl;
      if (url) window.open(url, '_blank');
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      // Si fue installing, dejamos busy=true porque la app se está cerrando
      if (progress !== 'installing') setBusy(false);
    }
  };

  const platformLabel = (
    { android: 'Android (.apk)', win: 'Windows (.exe)', mac: 'macOS (.dmg)', web: 'navegador' }
  )[platform] || 'tu plataforma';

  return (
    <div className={styles.gate}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.badge}>Actualización requerida</div>

        <h1 className={styles.title}>
          Hay una versión nueva<br />
          <span className={styles.gradient}>de LocalTv</span>
        </h1>

        <div className={styles.versions}>
          <div>
            <div className={styles.versionLabel}>Tu versión</div>
            <div className={`${styles.version} ${styles.versionOld}`}>{current || '—'}</div>
          </div>
          <div className={styles.arrow}>→</div>
          <div>
            <div className={styles.versionLabel}>Disponible</div>
            <div className={`${styles.version} ${styles.versionNew}`}>{latest}</div>
          </div>
        </div>

        <p className={styles.subtitle}>
          Esta versión incluye mejoras y correcciones importantes. Para seguir
          usando la app necesitás actualizar a la última versión disponible
          para {platformLabel}.
        </p>

        {asset ? (
          <div className={styles.assetRow}>
            <span className={styles.assetName}>{asset.name}</span>
            <span className={styles.assetSize}>
              {(asset.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
        ) : (
          <p className={styles.warning}>
            No encontramos un instalador específico para tu plataforma —
            descargalo manualmente desde GitHub Releases.
          </p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.btnPrimary}
            onClick={handleUpdate}
            disabled={busy}
          >
            {progress === 'installing'
              ? 'Instalando, la app se cerrará…'
              : progress === 'downloading'
                ? 'Descargando…'
                : busy
                  ? 'Procesando…'
                  : 'Actualizar ahora →'}
          </button>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnGhost}
          >
            Ver release en GitHub
          </a>
        </div>

        {progress === 'installing' && (
          <div className={styles.installing}>
            ⚙ El instalador está corriendo silencioso en segundo plano.
            La app se va a cerrar y abrir sola con la versión nueva.
          </div>
        )}

        {err && <div className={styles.error}>Error: {err}</div>}

        {notes && (
          <details className={styles.notes}>
            <summary>Qué cambia en {latest}</summary>
            <pre className={styles.notesBody}>{notes}</pre>
          </details>
        )}

        <div className={styles.footer}>
          LocalTv · FofoStudio Edition · No podés usar la app sin actualizar.
        </div>
      </div>
    </div>
  );
}
