import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import { FavoritesContext } from '../context/FavoritesContext';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconSearch, IconStar, IconTv } from '../components/icons/Icons';
import { getLogoFor } from '../utils/channelLogos';
import { channelCode, channelHue, regionLabel } from '../utils/channelDisplay';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Channels.module.css';

function ChannelThumb({ ch }) {
  const [failed, setFailed] = useState(false);
  const logo = getLogoFor(ch);
  if (logo && !failed) {
    return (
      <div className={styles.thumb} style={{ background: '#f4f5f7' }}>
        <img src={logo} alt="" loading="lazy" className={styles.thumbImg} onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={styles.thumb} style={{ background: channelHue(ch) }}>
      <span className={styles.thumbCode}>{channelCode(ch)}</span>
    </div>
  );
}

export default function Channels({ favoritesOnly = false }) {
  const { channels, searchQuery, setSearchQuery, setCurrentChannel } = useContext(ChannelContext);
  const { isFavorite, toggleFavorite } = useContext(FavoritesContext);
  const navigate = useNavigate();
  const [onlyFav, setOnlyFav] = useState(favoritesOnly);

  const list = useMemo(() => {
    let l = channels;
    if (onlyFav) l = l.filter((c) => isFavorite(c.id));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      l = l.filter((c) => c.name.toLowerCase().includes(q));
    }
    return l;
  }, [channels, onlyFav, searchQuery, isFavorite]);

  const favCount = useMemo(() => channels.filter((c) => isFavorite(c.id)).length, [channels, isFavorite]);

  const open = (ch) => {
    setCurrentChannel(ch);
    navigate('/');
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
          <div className={shell.headTop}>
            <h2 className={shell.title}>{favoritesOnly ? 'Favoritos' : 'Canales'}</h2>
          </div>
          <div className={shell.sub}>Biblioteca completa · {channels.length} canales disponibles</div>

          <div className={shell.filterRow}>
            <button
              className={`${shell.pill} ${!onlyFav ? shell.pillActive : ''}`}
              onClick={() => setOnlyFav(false)}
            >Todos · {channels.length}</button>
            <button
              className={`${shell.pill} ${onlyFav ? shell.pillActive : ''}`}
              onClick={() => setOnlyFav(true)}
            >★ Favoritos · {favCount}</button>
            <div className={shell.search}>
              <IconSearch size={13} color="var(--lt-mute)" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar canal..."
                aria-label="Buscar canal"
              />
            </div>
          </div>
        </div>

        <div className={shell.body}>
          {!list.length ? (
            <div className={shell.empty}>
              <IconTv size={32} color="rgba(255,255,255,0.25)" />
              <p>{onlyFav ? 'Aún no marcaste canales favoritos.' : 'Sin canales para mostrar.'}</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {list.map((ch) => {
                const fav = isFavorite(ch.id);
                return (
                  <div key={ch.id} className={styles.card}>
                    <button type="button" className={styles.cardOpen} onClick={() => open(ch)}>
                      <ChannelThumb ch={ch} />
                      <div className={styles.cardBody}>
                        <div className={styles.cardName}>{ch.name}</div>
                        <div className={styles.cardFoot}>
                          <span className={styles.cardTag}>{regionLabel(ch.region)}</span>
                          <span className={`${styles.dot} ${styles.dotLive}`} />
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`${styles.star} ${fav ? styles.starOn : ''}`}
                      onClick={() => toggleFavorite(ch.id)}
                      title={fav ? 'Quitar de favoritos' : 'Marcar favorito'}
                    >
                      <IconStar size={13} color="#fff" fill={fav ? '#fff' : 'none'} />
                    </button>
                    <span className={styles.liveBadge}><span className={styles.liveBadgeDot} /> LIVE</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <LtMobileTabs />
    </div>
  );
}
