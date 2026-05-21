import { useMemo, useState } from 'react';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import PosterCard from '../components/PosterCard/PosterCard';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconClose, IconPlay, IconStar } from '../components/icons/Icons';
import { useVodLibrary } from '../hooks/useVodLibrary';
import { vod } from '../services/vodApi';
import VodPlayer from '../components/VodPlayer/VodPlayer';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Discover.module.css';

function LibModal({ item, lib, onClose }) {
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [playing, setPlaying] = useState(null);
  const saved = lib.getProgress(item.media_type, item.id);
  const tryPlay = async () => {
    setResolving(true); setMsg(null);
    try {
      const r = await vod.resolve({ media_type: item.media_type, tmdb_id: item.id });
      if (r.sources?.length) setPlaying(r.sources[0]);
      else setMsg({ ok: false, text: 'No hay ninguna fuente conectada para reproducir.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setResolving(false); }
  };
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar"><IconClose size={16} color="#fff" /></button>
        <div className={styles.modalBody} style={{ marginTop: 0 }}>
          <h2 className={styles.modalTitle}>{item.title}</h2>
          <div className={styles.modalMeta}>
            {item.first_air_date && <span>{String(item.first_air_date).slice(0, 4)}</span>}
            <span className={styles.modalKind}>{item.media_type === 'anime' ? 'Anime' : item.media_type === 'tv' ? 'Serie' : 'Película'}</span>
          </div>
          <div className={styles.modalActions}>
            <button className={styles.playBtn} onClick={tryPlay} disabled={resolving}>
              <IconPlay size={14} color="currentColor" /> {resolving ? 'Buscando fuente…' : 'Reproducir'}
            </button>
            <button className={styles.listBtn} onClick={() => { lib.toggle(item); onClose(); }}>
              <IconStar size={14} color="currentColor" fill="currentColor" /> Quitar de mi lista
            </button>
          </div>
          {msg && <p className={`${styles.playMsg} ${msg.ok ? styles.playOk : styles.playWarn}`}>{msg.text}</p>}
        </div>
      </div>
      {playing && (
        <VodPlayer
          source={playing}
          title={item.title}
          startAt={saved?.position || 0}
          onProgress={(pos, dur) => lib.setProgress(item.media_type, item.id, pos, dur)}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}

export default function Library() {
  const lib = useVodLibrary();
  const [selected, setSelected] = useState(null);

  const continueItems = useMemo(() => {
    return Object.entries(lib.progress)
      .map(([k, v]) => ({ key: k, ...v }))
      .filter((x) => x.position > 0 && (!x.duration || x.position < x.duration * 0.95))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [lib.progress]);

  return (
    <div className={shell.shell}>
      <LtSidebar />
      <div className={shell.content}>
        <div className={shell.mobileTop}><LocalTvMark size={26} radius={7} /><LocalTvWordmark size={15} /></div>
        <div className={shell.header}>
          <div className={shell.headTop}><h2 className={shell.title}>Mi Lista</h2></div>
          <div className={shell.sub}>Tu watchlist y lo que estás viendo · solo en este equipo</div>
        </div>
        <div className={shell.body}>
          {continueItems.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Seguir viendo</div>
              <p className={shell.sub} style={{ marginBottom: 14 }}>{continueItems.length} en progreso</p>
            </>
          )}
          {!lib.list.length ? (
            <div className={shell.empty}><p>Tu lista está vacía. Agregá títulos desde Películas, Series o Anime.</p></div>
          ) : (
            <>
              <div className={styles.sectionLabel}>Mi lista · {lib.list.length}</div>
              <div className={styles.grid}>
                {lib.list.map((it) => (
                  <PosterCard key={`${it.media_type}-${it.id}`} item={it} onOpen={(item) => setSelected(item)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {selected && <LibModal item={selected} lib={lib} onClose={() => setSelected(null)} />}
      <LtMobileTabs />
    </div>
  );
}
