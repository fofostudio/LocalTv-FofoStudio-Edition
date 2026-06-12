import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import PosterCard from '../components/PosterCard/PosterCard';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconSearch, IconPlay, IconClose, IconStar } from '../components/icons/Icons';
import { vod, tmdbImg } from '../services/vodApi';
import { useVodLibrary } from '../hooks/useVodLibrary';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Discover.module.css';

function DetailModal({ item, kind, onClose, onSelect }) {
  const lib = useVodLibrary();
  const { playVod } = useContext(ChannelContext);
  const [data, setData] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [playMsg, setPlayMsg] = useState(null);
  const [availableSources, setAvailableSources] = useState(null);
  const inList = lib.inList(kind, item.id);
  const saved = lib.getProgress(kind, item.id);

  // Lanza el VOD global (sobrevive al "atrás" → PiP) y cierra el modal.
  const startPlay = (src, { trailer = false } = {}) => {
    playVod({
      source: src,
      title,
      startAt: trailer ? 0 : (saved?.position || 0),
      mediaType: trailer ? null : kind,
      id: item.id,
    });
    onClose?.();
  };

  const [loadingDetail, setLoadingDetail] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingDetail(true);
    vod.detail(kind, item.id)
      .then((dt) => { if (!cancelled) setData(dt ? { ...item, ...dt } : null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [item.id, kind]);

  const playEpisode = async (ep) => {
    setResolving(true);
    setPlayMsg(null);
    setAvailableSources(null);
    try {
      const r = await vod.resolve({ media_type: kind, source_url: ep.url, title: `${title} · ${ep.label}` });
      if (r.sources?.length === 1) startPlay(r.sources[0]);
      else if (r.sources?.length > 1) setAvailableSources(r.sources);
      else setPlayMsg({ ok: false, text: `El episodio ${ep.label} no tiene fuente disponible todavía.` });
    } catch (e) {
      setPlayMsg({ ok: false, text: e.message });
    } finally {
      setResolving(false);
    }
  };

  const tryPlay = async () => {
    // En series, "Reproducir" lanza el primer episodio disponible.
    if (kind === 'tv' && d.episodes?.length) {
      playEpisode(d.episodes[0]);
      return;
    }
    setResolving(true);
    setPlayMsg(null);
    setAvailableSources(null);
    try {
      const r = await vod.resolve({
        media_type: kind,
        tmdb_id: item.id,
        source_url: item.cine_url,
        title: d?.title || d?.name || item.title || item.name,
        year: (d?.release_date || d?.first_air_date || item.release_date || item.first_air_date || '').slice(0, 4),
      });
      if (r.sources?.length === 1) {
        startPlay(r.sources[0]);
      } else if (r.sources?.length > 1) {
        setAvailableSources(r.sources);
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
  const rating = d.vote_average ? Number(d.vote_average).toFixed(1) : null;
  const poster = d._posterUrl || tmdbImg(d.poster_path, 'w342') || item._posterUrl;
  const heroBg = tmdbImg(d.backdrop_path, 'w780') || poster;
  const genreNames = (d.genres || []).map((g) => g.name || g).filter(Boolean);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">
          <IconClose size={16} color="#fff" />
        </button>

        <div className={styles.modalHero}>
          {heroBg && <div className={styles.modalHeroBg} style={{ backgroundImage: `url(${heroBg})` }} />}
          <div className={styles.modalHeroInner}>
            {poster && <img className={styles.modalPoster} src={poster} alt="" loading="lazy" />}
            <div className={styles.modalHeadInfo}>
              <h2 className={styles.modalTitle}>{title}</h2>
              <div className={styles.modalMeta}>
                <span className={`${styles.modalKind} ${kind === 'tv' ? styles.modalKindTv : styles.modalKindMovie}`}>{kind === 'tv' ? 'Serie' : 'Película'}</span>
                {year && <span>{year}</span>}
                {rating && <span className={styles.modalRating}>★ {rating}</span>}
              </div>
              {genreNames.length > 0 && (
                <div className={styles.modalGenres}>
                  {genreNames.map((g) => <span key={g} className={styles.genreChip}>{g}</span>)}
                </div>
              )}
              <div className={styles.modalActions}>
                <button className={styles.playBtn} onClick={tryPlay} disabled={resolving}>
                  <IconPlay size={14} color="currentColor" /> {resolving ? 'Buscando fuente…' : 'Reproducir'}
                </button>
                {d.trailer && (
                  <button className={styles.listBtn} onClick={() => startPlay({ url: d.trailer, kind: 'embed', label: 'Tráiler' }, { trailer: true })}>
                    <IconPlay size={14} color="currentColor" /> Tráiler
                  </button>
                )}
                <button className={styles.listBtn} onClick={() => lib.toggle({ ...d, media_type: kind })}>
                  <IconStar size={14} color="currentColor" fill={inList ? 'currentColor' : 'none'} /> {inList ? 'En mi lista' : 'Mi lista'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.sectionTitle}>Sinopsis</div>
          {loadingDetail && !d.overview ? (
            <div className={styles.skeleton}><span /><span /><span /></div>
          ) : (
            <p className={styles.modalOverview}>{d.overview || 'Sin sinopsis disponible para este título.'}</p>
          )}
          {playMsg && (
            <p className={`${styles.playMsg} ${playMsg.ok ? styles.playOk : styles.playWarn}`}>{playMsg.text}</p>
          )}
          {availableSources && (
            <div className={styles.serverPicker}>
              <div className={styles.serverLabel}>Elige un servidor ({availableSources.length}):</div>
              <div className={styles.serverGrid}>
                {availableSources.map((src, i) => (
                  <button key={i} className={styles.serverBtn} onClick={() => startPlay(src)}>
                    <span className={styles.serverName}>{src.label || src.provider || 'Fuente'}</span>
                    <span className={styles.serverType}>{src.kind === 'embed' ? 'Embed' : src.kind === 'hls' ? 'HD' : src.kind}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'tv' && d.episodes?.length > 0 && (
            <>
              <div className={styles.sectionTitle}>Episodios ({d.episodes.length})</div>
              <div className={styles.episodeList}>
                {d.episodes.map((ep, i) => (
                  <button key={i} className={styles.episodeBtn} onClick={() => playEpisode(ep)} disabled={resolving}>
                    <span className={styles.episodeNum}>{ep.label}</span>
                    <span className={styles.episodeTitle}>{ep.title || 'Episodio'}</span>
                    <IconPlay size={12} color="currentColor" />
                  </button>
                ))}
              </div>
            </>
          )}

          {d.cast?.length > 0 && (
            <>
              <div className={styles.sectionTitle}>Reparto</div>
              <p className={styles.modalOverview}>{d.cast.join(', ')}</p>
            </>
          )}

          {d.similar?.length > 0 && (
            <>
              <div className={styles.sectionTitle}>Títulos similares</div>
              <div className={styles.similarRow}>
                {d.similar.map((s) => (
                  <PosterCard key={s.id} item={s} onOpen={(it, k) => onSelect?.(it, k)} />
                ))}
              </div>
            </>
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [genres, setGenres] = useState([]);
  const [section, setSection] = useState('estrenos');  // estrenos | todas | <genre-slug>
  const debounceRef = useRef(0);

  useEffect(() => { setKind(defaultKind); }, [defaultKind]);
  useEffect(() => { vod.genres().then(setGenres).catch(() => {}); }, []);

  const fetchPage = async (p) => {
    let data;
    if (query.trim()) data = await vod.search(query, p);
    else if (section === 'estrenos') data = await vod.estrenos(kind, p);
    else if (section === 'clasicas') data = await vod.clasicas(kind, p);
    else if (section === 'todas') data = await vod.trending(kind, p);
    else data = await vod.byGenre(section, kind, p);
    let results = data.results || [];
    if (query.trim()) {
      results = results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
    }
    return results;
  };

  // Reset + primera página al cambiar tipo/búsqueda.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setHasMore(true);
    clearTimeout(debounceRef.current);

    const run = async () => {
      try {
        const results = await fetchPage(1);
        if (!cancelled) { setItems(results); setHasMore(results.length > 0); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    debounceRef.current = setTimeout(run, query.trim() ? 400 : 0);
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, [kind, query, section]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const more = await fetchPage(next);
      setItems((prev) => {
        const seen = new Set(prev.map((x) => `${x.media_type || kind}-${x.id}`));
        const fresh = more.filter((x) => !seen.has(`${x.media_type || kind}-${x.id}`));
        return [...prev, ...fresh];
      });
      setPage(next);
      setHasMore(more.length > 0);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const heading = useMemo(() => {
    if (query.trim()) return 'Resultados';
    if (section === 'estrenos') return '🔥 Estrenos';
    if (section === 'clasicas') return '🎞️ Clásicas';
    if (section === 'todas') return 'Catálogo';
    const g = genres.find((x) => x.slug === section);
    return g ? g.name : 'Estrenos';
  }, [query, section, genres]);

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
          <div className={shell.sub}>Descubre contenido · {vod.hasToken() ? 'datos de TMDB' : 'catálogo CineCalidad · latino'}</div>

          <div className={shell.filterRow}>
            <button className={`${shell.pill} ${kind === 'movie' ? shell.pillActive : ''}`} onClick={() => setKind('movie')}>Películas</button>
            <button className={`${shell.pill} ${kind === 'tv' ? shell.pillActive : ''}`} onClick={() => setKind('tv')}>Series</button>
            <Link to="/anime" className={shell.pill}>Anime</Link>
            <div className={shell.search}>
              <IconSearch size={13} color="var(--lt-mute)" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar título..." aria-label="Buscar" />
            </div>
          </div>

          {genres.length > 0 && !query.trim() && (
            <div className={shell.filterRow} style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
              <button className={`${shell.pill} ${section === 'estrenos' ? shell.pillActive : ''}`} onClick={() => setSection('estrenos')}>🔥 Estrenos</button>
              <button className={`${shell.pill} ${section === 'clasicas' ? shell.pillActive : ''}`} onClick={() => setSection('clasicas')}>🎞️ Clásicas</button>
              <button className={`${shell.pill} ${section === 'todas' ? shell.pillActive : ''}`} onClick={() => setSection('todas')}>Todas</button>
              {genres.map((g) => (
                <button key={g.slug} className={`${shell.pill} ${section === g.slug ? shell.pillActive : ''}`} onClick={() => setSection(g.slug)}>
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={shell.body}>
          {loading ? (
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
              {hasMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                  <button className={shell.pill} onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Cargando…' : 'Cargar más'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selected && (
        <DetailModal
          item={selected.item}
          kind={selected.kind}
          onClose={() => setSelected(null)}
          onSelect={(it, k) => setSelected({ item: it, kind: k })}
        />
      )}
      <LtMobileTabs />
    </div>
  );
}
