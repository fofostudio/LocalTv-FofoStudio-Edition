import { useEffect, useRef, useState } from 'react';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import PosterCard from '../components/PosterCard/PosterCard';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconSearch, IconPlay, IconClose, IconStar } from '../components/icons/Icons';
import { anilist } from '../services/anilistApi';
import { vod } from '../services/vodApi';
import { useVodLibrary } from '../hooks/useVodLibrary';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Discover.module.css';

function AnimeModal({ item, onClose }) {
  const lib = useVodLibrary();
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState(null);
  const inList = lib.inList('anime', item.id);

  const tryPlay = async () => {
    setResolving(true); setMsg(null);
    try {
      const r = await vod.resolve({ media_type: 'anime', tmdb_id: item.id });
      setMsg(r.sources?.length
        ? { ok: true, text: `${r.sources.length} fuente(s) disponible(s).` }
        : { ok: false, text: 'No hay ninguna fuente conectada para reproducir.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setResolving(false); }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar"><IconClose size={16} color="#fff" /></button>
        {item.backdrop_url && <img className={styles.modalBackdrop} src={item.backdrop_url} alt="" />}
        <div className={styles.modalBody}>
          <h2 className={styles.modalTitle}>{item.title}</h2>
          <div className={styles.modalMeta}>
            {item.first_air_date && <span>{item.first_air_date}</span>}
            {item.vote_average && <span className={styles.modalRating}>★ {item.vote_average.toFixed(1)}</span>}
            {item.episodes && <span>{item.episodes} eps</span>}
            <span className={styles.modalKind}>Anime</span>
          </div>
          {item.genres?.length > 0 && <div className={styles.modalGenres}>{item.genres.map((g) => g.name).join(' · ')}</div>}
          <p className={styles.modalOverview}>{item.overview || 'Sin sinopsis disponible.'}</p>
          <div className={styles.modalActions}>
            <button className={styles.playBtn} onClick={tryPlay} disabled={resolving}>
              <IconPlay size={14} color="currentColor" /> {resolving ? 'Buscando fuente…' : 'Reproducir'}
            </button>
            <button className={styles.listBtn} onClick={() => lib.toggle({ ...item, media_type: 'anime' })}>
              <IconStar size={14} color="currentColor" fill={inList ? 'currentColor' : 'none'} /> {inList ? 'En mi lista' : 'Mi lista'}
            </button>
          </div>
          {msg && <p className={`${styles.playMsg} ${msg.ok ? styles.playOk : styles.playWarn}`}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}

export default function Anime() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    clearTimeout(debounceRef.current);
    const run = async () => {
      try {
        const data = query.trim() ? await anilist.search(query) : await anilist.trending();
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    debounceRef.current = setTimeout(run, query.trim() ? 400 : 0);
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className={shell.shell}>
      <LtSidebar />
      <div className={shell.content}>
        <div className={shell.mobileTop}><LocalTvMark size={26} radius={7} /><LocalTvWordmark size={15} /></div>
        <div className={shell.header}>
          <div className={shell.headTop}><h2 className={shell.title}>Anime</h2></div>
          <div className={shell.sub}>Descubrí anime · datos de AniList</div>
          <div className={shell.filterRow}>
            <div className={shell.search}>
              <IconSearch size={13} color="var(--lt-mute)" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar anime..." aria-label="Buscar" />
            </div>
          </div>
        </div>
        <div className={shell.body}>
          {loading ? <LoadingSpinner />
            : error ? <div className={shell.empty}><p>Error: {error}</p></div>
            : !items.length ? <div className={shell.empty}><p>Sin resultados.</p></div>
            : (
              <>
                <div className={styles.sectionLabel}>{query.trim() ? 'Resultados' : 'Tendencias'}</div>
                <div className={styles.grid}>
                  {items.map((it) => <PosterCard key={it.id} item={it} onOpen={(item) => setSelected(item)} />)}
                </div>
              </>
            )}
        </div>
      </div>
      {selected && <AnimeModal item={selected} onClose={() => setSelected(null)} />}
      <LtMobileTabs />
    </div>
  );
}
