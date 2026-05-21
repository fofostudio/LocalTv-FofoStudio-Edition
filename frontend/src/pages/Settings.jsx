import { useContext, useEffect, useState } from 'react';
import { FavoritesContext } from '../context/FavoritesContext';
import { usePreferences } from '../hooks/usePreferences';
import { SPORTS } from '../utils/sports';
import { api } from '../services/api';
import { vod } from '../services/vodApi';
import { isCapacitor } from '../services/platform';
import { getLiteMode, setLiteMode, isTvUserAgent } from '../utils/device';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconStar, IconCheck, IconShare, IconTv } from '../components/icons/Icons';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Settings.module.css';

const VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
const REPO = 'https://github.com/fofostudio/LocalTv-FofoStudio-Edition';

export default function Settings() {
  const { favorites, toggleFavorite } = useContext(FavoritesContext);
  const { favoriteSports, toggleSport } = usePreferences();
  const [net, setNet] = useState(null);
  const [copied, setCopied] = useState(false);
  const [lite, setLite] = useState(getLiteMode());

  const changeLite = (mode) => {
    setLiteMode(mode);
    setLite(mode);
  };

  // TMDB (módulo Cine)
  const [tmdbToken, setTmdbToken] = useState('');
  const [tmdbSet, setTmdbSet] = useState(false);
  const [tmdbSaving, setTmdbSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    vod.getConfig().then((c) => { if (!cancelled) setTmdbSet(!!c.has_token); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const saveTmdb = async () => {
    setTmdbSaving(true);
    try {
      const r = await vod.setToken(tmdbToken.trim());
      setTmdbSet(!!r.has_token);
      setTmdbToken('');
    } catch { /* ignore */ } finally {
      setTmdbSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.getNetworkInfo?.().then((d) => { if (!cancelled) setNet(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // La URL a compartir usa el puerto REAL con el que estás viendo la app
  // (window.location), porque ese es el server que sirve esta interfaz.
  // En APK (file://) usamos la lan_url que entrega el plugin nativo.
  const share = (() => {
    if (!net) return null;
    if (isCapacitor()) {
      if (!net.lan_url) return null;
      return { url: net.lan_url, ip: net.lan_ip, port: net.port };
    }
    if (!net.lan_ip) return net.lan_url ? { url: net.lan_url, ip: net.lan_ip, port: net.port } : null;
    const proto = window.location.protocol === 'https:' ? 'https' : 'http';
    const port = window.location.port || (proto === 'https' ? '443' : '80');
    return { url: `${proto}://${net.lan_ip}:${port}`, ip: net.lan_ip, port };
  })();

  const copyUrl = async () => {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  const clearFavorites = () => {
    if (!favorites.length) return;
    if (confirm('¿Quitar todos los canales de favoritos?')) {
      favorites.slice().forEach((id) => toggleFavorite(id));
    }
  };

  const clearLocalData = () => {
    if (confirm('Esto borra favoritos, preferencias y caché local de este equipo. ¿Continuar?')) {
      try { localStorage.clear(); } catch { /* ignore */ }
      location.reload();
    }
  };

  return (
    <div className={shell.shell}>
      <LtSidebar />
      <div className={shell.content}>
        <div className={shell.mobileTop}>
          <LocalTvMark size={26} radius={7} />
          <LocalTvWordmark size={15} />
        </div>

        <div className={shell.header}>
          <h2 className={shell.title}>Configuración</h2>
          <div className={shell.sub}>
            Todo lo que cambies se guarda solo en este equipo. Cero telemetría, cero cuentas.
          </div>
        </div>

        <div className={shell.body}>
          <div className={styles.stack}>
            {/* Perfil local */}
            <div className={styles.profile}>
              <div className={styles.profileGlow} aria-hidden="true" />
              <div className={styles.avatar}>L</div>
              <div className={styles.profileInfo}>
                <div className={styles.profileName}>Perfil local</div>
                <div className={styles.profileSub}>
                  Solo en este equipo · sin cuentas · {favorites.length} favoritos · {favoriteSports.length} deportes
                </div>
              </div>
            </div>

            {/* Compartir en casa / red */}
            <section className={styles.share}>
              <div className={`${styles.shareGlow} lt-glow`} aria-hidden="true" />
              <div className={styles.shareInner}>
                <div className={styles.shareHead}>
                  <span className={styles.shareIcon}><IconShare size={16} color="#fff" /></span>
                  Compartir en casa / red
                </div>
                {share?.url ? (
                  <>
                    <p className={styles.shareNote}>
                      Abrí esta dirección en cualquier dispositivo de tu red (Smart TV, celular, tablet)
                      para ver la misma interfaz de LocalTv:
                    </p>
                    <div className={styles.shareUrlRow}>
                      <a className={styles.shareUrl} href={share.url} target="_blank" rel="noopener noreferrer">
                        {share.url}
                      </a>
                      <button className={styles.shareCopy} onClick={copyUrl}>
                        <IconCheck size={13} color="currentColor" /> {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <div className={styles.shareMeta}>
                      <span><IconTv size={12} color="var(--lt-mute)" /> IP <b>{share.ip}</b></span>
                      <span>Puerto <b>{share.port}</b></span>
                      {net.hostname && <span>Equipo <b>{net.hostname}</b></span>}
                    </div>
                    <p className={styles.shareHint}>
                      El equipo y el dispositivo deben estar en la misma red Wi-Fi. Si no carga,
                      permití LocalTv en el Firewall de Windows (red privada).
                    </p>
                  </>
                ) : (
                  <p className={styles.shareNote}>
                    No se pudo obtener la IP de red. Asegurate de estar conectado a una red local.
                  </p>
                )}
              </div>
            </section>

            {/* Deportes favoritos */}
            <section className={styles.group}>
              <div className={styles.groupHead}>Deportes favoritos</div>
              <div className={styles.groupNote}>
                Elegí tus deportes y la agenda priorizará esos eventos primero.
              </div>
              <div className={styles.sports}>
                {SPORTS.map((s) => {
                  const on = favoriteSports.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`${styles.sport} ${on ? styles.sportOn : ''}`}
                      onClick={() => toggleSport(s.id)}
                    >
                      <span className={styles.sportCode} style={{ background: s.hue }}>{s.code}</span>
                      {s.name}
                      {on && <span className={styles.sportCheck}><IconCheck size={12} color="#fff" /></span>}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Cine / TMDB */}
            <section className={styles.card}>
              <div className={styles.cardHead}>Cine (TMDB)</div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Token de TMDB</div>
                  <div className={styles.rowDesc}>
                    {tmdbSet ? 'Configurado ✓ — ya podés usar Películas y Series.' : 'Pegá tu "API Read Access Token" (v4) de themoviedb.org para habilitar el descubrimiento.'}
                  </div>
                </div>
              </div>
              <div className={styles.row}>
                <input
                  type="password"
                  className={styles.input}
                  value={tmdbToken}
                  onChange={(e) => setTmdbToken(e.target.value)}
                  placeholder={tmdbSet ? '•••••••• (reemplazar)' : 'eyJhbGciOi...'}
                  aria-label="Token TMDB"
                />
                <button className={styles.btn} onClick={saveTmdb} disabled={tmdbSaving || !tmdbToken.trim()}>
                  {tmdbSaving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </section>

            {/* Datos locales */}
            <section className={styles.card}>
              <div className={styles.cardHead}>Datos locales</div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Canales favoritos</div>
                  <div className={styles.rowDesc}>{favorites.length} guardados en este equipo</div>
                </div>
                <button className={styles.btn} onClick={clearFavorites} disabled={!favorites.length}>
                  <IconStar size={13} color="currentColor" /> Limpiar
                </button>
              </div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Borrar datos locales</div>
                  <div className={styles.rowDesc}>Elimina favoritos, preferencias y caché</div>
                </div>
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={clearLocalData}>
                  Borrar
                </button>
              </div>
            </section>

            {/* Preferencias (informativas) */}
            <section className={styles.card}>
              <div className={styles.cardHead}>Preferencias de visualización</div>
              <div className={styles.prefGrid}>
                {[
                  { l: 'Idioma', v: 'Español' },
                  { l: 'Zona horaria', v: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local' },
                  { l: 'Calidad por defecto', v: 'Auto · adaptativa (hls.js)' },
                  { l: 'Reproductor', v: 'hls.js + <video> nativo' },
                ].map((it, i) => (
                  <div key={i} className={styles.pref}>
                    <div className={styles.prefLabel}>{it.l}</div>
                    <div className={styles.prefValue}>{it.v}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Rendimiento / modo ligero */}
            <section className={styles.card}>
              <div className={styles.cardHead}>Rendimiento</div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Modo ligero (TV / equipos lentos)</div>
                  <div className={styles.rowDesc}>
                    Desactiva blur y animaciones para cargar más rápido.
                    {isTvUserAgent() ? ' Detectamos una TV: se activa solo.' : ' "Auto" lo activa solo en TVs.'}
                  </div>
                </div>
                <div className={styles.seg}>
                  {[
                    { id: 'auto', l: 'Auto' },
                    { id: 'on', l: 'Sí' },
                    { id: 'off', l: 'No' },
                  ].map((o) => (
                    <button
                      key={o.id}
                      className={`${styles.segBtn} ${lite === o.id ? styles.segOn : ''}`}
                      onClick={() => changeLite(o.id)}
                    >{o.l}</button>
                  ))}
                </div>
              </div>
            </section>

            {/* Acerca de */}
            <section className={styles.card}>
              <div className={styles.cardHead}>Acerca de</div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>LocalTv · FofoStudio Edition</div>
                  <div className={styles.rowDesc}>Versión {VERSION} · Licencia MIT · open source</div>
                </div>
                <a className={styles.btn} href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
              </div>
            </section>
          </div>
        </div>
      </div>
      <LtMobileTabs />
    </div>
  );
}
