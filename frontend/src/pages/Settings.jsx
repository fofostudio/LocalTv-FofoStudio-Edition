import { useContext, useEffect, useMemo, useState } from 'react';
import { FavoritesContext } from '../context/FavoritesContext';
import { ChannelContext } from '../context/ChannelContext';
import { usePreferences } from '../hooks/usePreferences';
import { api } from '../services/api';
import { vod } from '../services/vodApi';
import { isCapacitor } from '../services/platform';
import { getLiteMode, setLiteMode, isTvUserAgent } from '../utils/device';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconStar, IconCheck, IconShare } from '../components/icons/Icons';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Settings.module.css';

const VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
const REPO = 'https://github.com/fofostudio/LocalTv-FofoStudio-Edition';

// Categorías con más sentido para destacar (orden y emoji). El resto se agrega
// dinámico desde las categorías reales de la app.
const CAT_EMOJI = {
  deportes: '⚽', peliculas: '🎬', series: '📺', noticias: '📰', infantil: '🧒',
  infantiles: '🧒', musica: '🎵', entretenimiento: '🎭', documentales: '🎞️',
  educativo: '🎓', cultura: '🎨', nacionales: '🏳️', hd: '🔆', '24-7': '🔁',
  'cine-24-7': '🍿', 'mas-vistos': '🔥', espana: '🇪🇸', usa: '🇺🇸',
  religion: '🙏', reality: '🎙️', general: '🌐',
};
const catHue = (slug) => `hsl(${(slug || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 60% 45%)`;

export default function Settings() {
  const { favorites, toggleFavorite } = useContext(FavoritesContext);
  const { categories, channels } = useContext(ChannelContext);
  const { favoriteCategories, toggleCategory, sourceEnabled, toggleSourceEnabled } = usePreferences();
  const [net, setNet] = useState(null);
  const [copied, setCopied] = useState(false);
  const [lite, setLite] = useState(getLiteMode());
  // Token TMDB (películas/series). En la APK no hay backend ni token horneado,
  // así que el usuario puede pegar el suyo (gratis en themoviedb.org) y queda
  // guardado en el equipo. Es lo que habilita el catálogo de cine en móvil.
  const [tmdbTok, setTmdbTok] = useState('');
  const [tmdbHas, setTmdbHas] = useState(() => vod.hasToken());
  const saveTmdb = async () => {
    const r = await vod.setToken(tmdbTok.trim());
    setTmdbHas(!!r.has_token);
    if (r.has_token) setTmdbTok('');
  };
  const clearTmdb = async () => { await vod.setToken(''); setTmdbHas(vod.hasToken()); };

  // Conteo de canales por fuente (para mostrar cuántos hay).
  const srcCounts = useMemo(() => {
    let magma = 0, abiertos = 0;
    for (const c of (channels || [])) (c.region === 'Magma' ? (magma++) : (abiertos++));
    return { magma, abiertos };
  }, [channels]);

  // Categorías reales de la app, ordenadas: las destacadas primero.
  const cats = useMemo(() => {
    const order = Object.keys(CAT_EMOJI);
    return [...(categories || [])].sort((a, b) => {
      const ia = order.indexOf(a.slug); const ib = order.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
    });
  }, [categories]);

  const changeLite = (mode) => { setLiteMode(mode); setLite(mode); };

  useEffect(() => {
    if (isCapacitor()) return;
    let cancelled = false;
    api.getNetworkInfo?.().then((d) => { if (!cancelled) setNet(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // URL para ver la app desde otra pantalla de la misma red.
  const share = (() => {
    if (!net) return null;
    if (isCapacitor()) return net.lan_url ? { url: net.lan_url } : null;
    if (!net.lan_ip) return net.lan_url ? { url: net.lan_url } : null;
    const proto = window.location.protocol === 'https:' ? 'https' : 'http';
    const port = window.location.port || (proto === 'https' ? '443' : '80');
    return { url: `${proto}://${net.lan_ip}:${port}` };
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
    if (confirm('Esto borra tus favoritos, tu lista de películas y las preferencias de este equipo. ¿Continuar?')) {
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
          <h2 className={shell.title}>Ajustes</h2>
          <div className={shell.sub}>Todo se guarda solo en este equipo. Sin cuentas, sin anuncios de seguimiento.</div>
        </div>

        <div className={shell.body}>
          <div className={styles.stack}>

            {/* Ver en otra pantalla — solo desktop, mismo Wi-Fi */}
            {!isCapacitor() && share?.url && (
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.headIcon}><IconShare size={15} color="#fff" /></span>
                  Ver en otra pantalla
                </div>
                <div className={styles.cardNote}>
                  Abre esta dirección en tu Smart TV, celular o tablet conectados al mismo Wi-Fi.
                </div>
                <div className={styles.shareUrlRow}>
                  <a className={styles.shareUrl} href={share.url} target="_blank" rel="noopener noreferrer">{share.url}</a>
                  <button className={styles.shareCopy} onClick={copyUrl}>
                    <IconCheck size={13} color="currentColor" /> {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </section>
            )}

            {/* Fuentes de canales */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.headIcon}>📡</span>
                Fuentes de canales
              </div>
              <div className={styles.cardNote}>Activa o desactiva de dónde salen los canales.</div>
              {[
                { key: 'abiertos', name: 'Canales abiertos', desc: 'IPTV español, deportes y TDT', count: srcCounts.abiertos },
                { key: 'magma', name: 'Magma (premium)', desc: 'Catálogo Xtream de tu cuenta', count: srcCounts.magma },
              ].map((s) => (
                <div key={s.key} className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>{s.name} <span style={{ color: 'var(--lt-mute)', fontWeight: 400 }}>· {s.count}</span></div>
                    <div className={styles.rowDesc}>{s.desc}</div>
                  </div>
                  <div className={styles.seg}>
                    <button className={`${styles.segBtn} ${sourceEnabled(s.key) ? styles.segOn : ''}`} onClick={() => sourceEnabled(s.key) || toggleSourceEnabled(s.key)}>Sí</button>
                    <button className={`${styles.segBtn} ${!sourceEnabled(s.key) ? styles.segOn : ''}`} onClick={() => sourceEnabled(s.key) && toggleSourceEnabled(s.key)}>No</button>
                  </div>
                </div>
              ))}
            </section>

            {/* Categorías favoritas */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.headIcon}>★</span>
                Categorías favoritas
              </div>
              <div className={styles.cardNote}>Las categorías que elijas aparecen primero en Canales.</div>
              <div className={styles.sports}>
                {cats.map((c) => {
                  const on = favoriteCategories.includes(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      className={`${styles.sport} ${on ? styles.sportOn : ''}`}
                      onClick={() => toggleCategory(c.slug)}
                    >
                      <span className={styles.sportCode} style={{ background: catHue(c.slug) }}>
                        {CAT_EMOJI[c.slug] || (c.name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      {c.name}
                      {on && <span className={styles.sportCheck}><IconCheck size={12} color="#fff" /></span>}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Rendimiento */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.headIcon}>⚡</span>
                Velocidad
              </div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Modo ligero</div>
                  <div className={styles.rowDesc}>
                    Para TVs o equipos lentos: desactiva efectos para que cargue más rápido.
                    {isTvUserAgent() ? ' Detectamos una TV: se activa solo.' : ''}
                  </div>
                </div>
                <div className={styles.seg}>
                  {[{ id: 'auto', l: 'Auto' }, { id: 'on', l: 'Sí' }, { id: 'off', l: 'No' }].map((o) => (
                    <button
                      key={o.id}
                      className={`${styles.segBtn} ${lite === o.id ? styles.segOn : ''}`}
                      onClick={() => changeLite(o.id)}
                    >{o.l}</button>
                  ))}
                </div>
              </div>
            </section>

            {/* Películas y series (TMDB) — solo en la app, donde se necesita el token */}
            {isCapacitor() && (
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.headIcon}>🎬</span>
                  Películas y series
                </div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>
                      Token de TMDB {tmdbHas
                        ? <span style={{ color: 'var(--lt-green,#22c55e)' }}>· activo ✓</span>
                        : <span style={{ color: 'var(--lt-amber,#f5a524)' }}>· falta</span>}
                    </div>
                    <div className={styles.rowDesc}>
                      Pega tu token (gratis en themoviedb.org → Configuración → API) para ver el
                      catálogo de películas y series en la app.
                    </div>
                  </div>
                </div>
                <div className={styles.row} style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    value={tmdbTok}
                    onChange={(e) => setTmdbTok(e.target.value)}
                    placeholder={tmdbHas ? 'Token guardado — pega uno nuevo para cambiarlo' : 'Pega tu token TMDB (v4 eyJ… o api_key)'}
                    aria-label="Token TMDB"
                    style={{
                      flex: 1, minWidth: 180, padding: '10px 12px', borderRadius: 10,
                      border: '1px solid var(--lt-line2,#2e2e44)', background: 'var(--lt-panel2,#161823)',
                      color: 'var(--lt-text,#fff)', fontSize: 13,
                    }}
                  />
                  <button className={styles.btn} onClick={saveTmdb} disabled={!tmdbTok.trim()}>Guardar</button>
                  {tmdbHas && <button className={`${styles.btn} ${styles.btnDanger}`} onClick={clearTmdb}>Quitar</button>}
                </div>
              </section>
            )}

            {/* Mis datos */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.headIcon}><IconStar size={14} color="#fff" /></span>
                Mis datos
              </div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Canales favoritos</div>
                  <div className={styles.rowDesc}>{favorites.length} guardados</div>
                </div>
                <button className={styles.btn} onClick={clearFavorites} disabled={!favorites.length}>
                  Limpiar
                </button>
              </div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>Borrar todo</div>
                  <div className={styles.rowDesc}>Favoritos, lista de películas y preferencias de este equipo</div>
                </div>
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={clearLocalData}>
                  Borrar
                </button>
              </div>
            </section>

            {/* Acerca de */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.headIcon}>ℹ️</span>
                Acerca de
              </div>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>LocalTv · FofoStudio Edition</div>
                  <div className={styles.rowDesc}>Versión {VERSION}</div>
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
