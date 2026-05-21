import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import PosterCard from '../components/PosterCard/PosterCard';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconSearch, IconPlay, IconClose } from '../components/icons/Icons';
import { vod, tmdbImg } from '../services/vodApi';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Discover.module.css';

function DetailModal({ item, kind, onClose }) {
  const [data, setData] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [playMsg, setPlayMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    vod.detail(kind, item.id).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.id, kind]);

  const tryPlay = async () => {
    setResolving(true);
    setPlayMsg(null);
    try {
      const r = await vod.resolve({ media_type: kind, tmdb_id: item.id });
      if (r.sources?.length) {
        setPlayMsg({ ok: true, text: `${r.sources.length} fuente(s) disponible(s).` });
        // Aquí se enviaría la fuente al reproductor (cuando haya un resolver conectado).
      } else {
        setPlayMsg({ ok: false, text: 'No hay ninguna fuente conectada para reproducir este título.' });
      }
    } catch (e) {
      setPlayMsg({ ok: false, text: e.message });
    } finally {
      setResolving(false);
    }
  };

  const d = data || item;
  const title = d.title || d.name || 'Sin título';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const rating = d.vote_average ? d.vote_average.toFixed(1) : null;
  const backdrop = tmdbImg(d.backdrop_path, 'w780');

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">
          <IconClose size={16} color="#fff" />
        </button>
        {backdrop && <img className={styles.modalBackdrop} src={backdrop} alt="" />}
        <div className={styles.modalBody}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <div className={styles.modalMeta}>
            {year && <span>{year}</span>}
            {rating && <span className={styles.modalRating}>★ {rating}</span>}
            <span className={styles.modalKind}>{kind === 'tv' ? 'Serie' : 'Película'}</span>
          </div>
          {d.genres?.length > 0 && (
            <div className={styles.modalGenres}>{d.genres.map((g) => g.name).join(' · ')}</div>
          )}
          <p className={styles.modalOverview}>{d.overview || 'Sin sinopsis disponible.'}</p>
          <div className={styles.modalActions}>
            <button className={styles.playBtn} onClick={tryPlay} disabled={resolving}>
              <IconPlay size={14} color="currentColor" /> {resolving ? 'Buscando fuente…' : 'Reproducir'}
            </button>
          </div>
          {playMsg && (
            <p className={`${styles.playMsg} ${playMsg.ok ? styles.playOk : styles.playWarn}`}>{playMsg.text}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Discover({ defaultKind = 'movie' }) {
  const [kind, setKind] = useState(defaultKind);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needToken, setNeedToken] = useState(false);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(0);

  useEffect(() => { setKind(defaultKind); }, [defaultKind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    clearTimeout(debounceRef.current);

    const run = async () => {
      try {
        const cfg = await vod.getConfig();
        if (!cfg.has_token) { if (!cancelled) { setNeedToken(true); setLoading(false); } return; }
        setNeedToken(false);
        const data = query.trim() ? await vod.search(query) : await vod.trending(kind);
        let results = data.results || [];
        if (query.trim()) {
          results = results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
        }
        if (!cancelled) setItems(results);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    debounceRef.current = setTimeout(run, query.trim() ? 400 : 0);
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, [kind, query]);

  const heading = useMemo(() => (query.trim() ? 'Resultados' : 'Tendencias'), [query]);

  return (
    <div className={shell.shell}>
      <LtSidebar />
      <div className={shell.content}>
        <div className={shell.mobileTop}>
          <LocalTvMark size={26} radius={7} />
          <LocalTvWordmark size={15} />
        </div>

        <div className={shell.header}>
          <div className={shell.headTop}>
            <h2 className={shell.title}>{kind === 'tv' ? 'Series' : 'Películas'}</h2>
          </div>
          <div className={shell.sub}>Descubrí contenido · datos de TMDB</div>

          <div className={shell.filterRow}>
            <button className={`${shell.pill} ${kind === 'movie' ? shell.pillActive : ''}`} onClick={() => setKind('movie')}>Películas</button>
            <button className={`${shell.pill} ${kind === 'tv' ? shell.pillActive : ''}`} onClick={() => setKind('tv')}>Series</button>
            <div className={shell.search}>
              <IconSearch size={13} color="var(--lt-mute)" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar título..." aria-label="Buscar" />
            </div>
          </div>
        </div>

        <div className={shell.body}>
          {needToken ? (
            <div className={shell.empty}>
              <p>Necesitás un token de TMDB para descubrir contenido.</p>
              <Link to="/config" className={styles.tokenLink}>Configurar token en Ajustes →</Link>
            </div>
          ) : loading ? (
            <LoadingSpinner />
          ) : error ? (
            <div className={shell.empty}><p>Error: {error}</p></div>
          ) : !items.length ? (
            <div className={shell.empty}><p>Sin resultados.</p></div>
          ) : (
            <>
              <div className={styles.sectionLabel}>{heading}</div>
              <div className={styles.grid}>
                {items.map((it) => (
                  <PosterCard key={`${it.media_type || kind}-${it.id}`} item={it} onOpen={(item, k) => setSelected({ item, kind: k })} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && <DetailModal item={selected.item} kind={selected.kind} onClose={() => setSelected(null)} />}
      <LtMobileTabs />
    </div>
  );
}
