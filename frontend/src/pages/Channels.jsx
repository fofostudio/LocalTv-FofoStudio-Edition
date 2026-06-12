import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import { FavoritesContext } from '../context/FavoritesContext';
import { usePreferences } from '../hooks/usePreferences';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconSearch, IconStar, IconTv } from '../components/icons/Icons';
import { getLogoFor } from '../utils/channelLogos';
import { channelCode, channelHue, regionLabel } from '../utils/channelDisplay';
import { isLite } from '../utils/device';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Channels.module.css';

const CATEGORY_ICONS = {
  deportes: '⚽',
  noticias: '📰',
  entretenimiento: '🎬',
  peliculas: '🎞',
  musica: '🎵',
  infantil: '🧸',
  documentales: '📖',
  educativo: '🎓',
  general: '📡',
  series: '📺',
  reality: '📹',
};

function categoryIcon(slug) {
  return CATEGORY_ICONS[slug] || '📺';
}

function ChannelThumb({ ch }) {
  const [failed, setFailed] = useState(false);
  const logo = getLogoFor(ch);
  if (logo && !failed && !isLite()) {
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

function ChannelCard({ ch, onOpen, isFavorite, onToggleFavorite }) {
  const fav = isFavorite(ch.id);
  return (
    <div className={styles.card}>
      <button type="button" className={styles.cardOpen} onClick={() => onOpen(ch)}>
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
        onClick={() => onToggleFavorite(ch.id)}
        title={fav ? 'Quitar de favoritos' : 'Marcar favorito'}
      >
        <IconStar size={13} color="#fff" fill={fav ? '#fff' : 'none'} />
      </button>
      <span className={styles.liveBadge}><span className={styles.liveBadgeDot} /> LIVE</span>
    </div>
  );
}

export default function Channels({ favoritesOnly = false }) {
  const { channels, categories, searchQuery, setSearchQuery, setCurrentChannel, isLive, loading } = useContext(ChannelContext);
  const { favoriteCategories, sourceEnabled } = usePreferences();
  const { isFavorite, toggleFavorite } = useContext(FavoritesContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [onlyFav, setOnlyFav] = useState(favoritesOnly);
  const [activeCatSlug, setActiveCatSlug] = useState(searchParams.get('cat') || 'all');

  useEffect(() => {
    const cat = searchParams.get('cat');
    if (cat) setActiveCatSlug(cat);
  }, [searchParams]);

  // Canales visibles según las fuentes activas (Ajustes). El conteo de toda la
  // UI (subtítulo, pill "Todos", favoritos) se basa en esto, no en el total crudo.
  const visibleChannels = useMemo(
    () => channels.filter((c) => sourceEnabled(c.region === 'Magma' ? 'magma' : 'abiertos')),
    [channels, sourceEnabled],
  );
  const favCount = useMemo(() => visibleChannels.filter((c) => isFavorite(c.id)).length, [visibleChannels, isFavorite]);

  // Build category map: slug -> category info
  const catMap = useMemo(() => {
    const m = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  // Group channels by category
  const grouped = useMemo(() => {
    // Filtrar por fuentes activas (Ajustes): Magma vs abiertos.
    let l = channels.filter((c) => sourceEnabled(c.region === 'Magma' ? 'magma' : 'abiertos'));
    if (onlyFav) l = l.filter((c) => isFavorite(c.id));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      l = l.filter((c) => c.name.toLowerCase().includes(q));
    }

    // Sort: live first, then by name
    const sorted = [...l].sort((a, b) => {
      const al = isLive(a.slug) ? 0 : 1;
      const bl = isLive(b.slug) ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });

    // Group by category
    const groups = {};
    for (const ch of sorted) {
      const cat = catMap[ch.category_id];
      const catSlug = cat ? cat.slug : 'general';
      const catName = cat ? cat.name : 'General';
      if (!groups[catSlug]) groups[catSlug] = { name: catName, channels: [] };
      groups[catSlug].channels.push(ch);
    }

    return groups;
  }, [channels, onlyFav, searchQuery, isFavorite, catMap, isLive, sourceEnabled]);

  // Filter groups if a specific category is selected. En "Todos", las categorías
  // favoritas (Ajustes) se muestran primero.
  const displayedGroups = useMemo(() => {
    if (activeCatSlug !== 'all') {
      return grouped[activeCatSlug] ? { [activeCatSlug]: grouped[activeCatSlug] } : {};
    }
    const favSet = new Set(favoriteCategories);
    const keys = Object.keys(grouped).sort((a, b) => (favSet.has(a) ? 0 : 1) - (favSet.has(b) ? 0 : 1));
    const out = {};
    keys.forEach((k) => { out[k] = grouped[k]; });
    return out;
  }, [grouped, activeCatSlug, favoriteCategories]);

  const open = (ch) => {
    setCurrentChannel(ch);
    navigate('/');
  };

  const catList = useMemo(() => {
    const favSet = new Set(favoriteCategories);
    const slugs = Object.keys(grouped).sort((a, b) => {
      const fa = favSet.has(a) ? 0 : 1; const fb = favSet.has(b) ? 0 : 1;
      return fa - fb || a.localeCompare(b);
    });
    return slugs.map((slug) => ({
      slug,
      name: grouped[slug].name,
      count: grouped[slug].channels.length,
      fav: favSet.has(slug),
    }));
  }, [grouped, favoriteCategories]);

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
            <h2 className={shell.title}>Canales</h2>
          </div>
          <div className={shell.sub}>Biblioteca completa · {visibleChannels.length} canales disponibles</div>

          <div className={shell.filterRow}>
            <button
              className={`${shell.pill} ${activeCatSlug === 'all' && !onlyFav ? shell.pillActive : ''}`}
              onClick={() => { setActiveCatSlug('all'); setOnlyFav(false); }}
            >Todos · {visibleChannels.length}</button>
            <button
              className={`${shell.pill} ${onlyFav ? shell.pillActive : ''}`}
              onClick={() => { setOnlyFav(true); setActiveCatSlug('all'); }}
            >★ Favoritos · {favCount}</button>
            {catList.map((cat) => (
              <button
                key={cat.slug}
                className={`${shell.pill} ${activeCatSlug === cat.slug ? shell.pillActive : ''}`}
                onClick={() => { setActiveCatSlug(cat.slug); setOnlyFav(false); }}
              >{cat.fav ? '★ ' : ''}{categoryIcon(cat.slug)} {cat.name} · {cat.count}</button>
            ))}
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
          {loading && !channels.length ? (
            <div className={styles.catSection}>
              <h3 className={styles.catTitle}>
                <span className={`${styles.catIcon} lt-skeleton`} style={{ width: 18, height: 18 }} />
                <span className="lt-skeleton" style={{ width: 120, height: 14, borderRadius: 6 }} />
              </h3>
              <div className={styles.grid}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={styles.card} style={{ pointerEvents: 'none' }}>
                    <div className="lt-skeleton" style={{ width: '100%', aspectRatio: '16 / 10', borderRadius: 12 }} />
                    <div style={{ padding: '10px 4px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="lt-skeleton" style={{ width: '70%', height: 11, borderRadius: 5 }} />
                      <span className="lt-skeleton" style={{ width: '40%', height: 9, borderRadius: 5 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : Object.keys(displayedGroups).length === 0 ? (
            <div className={shell.empty}>
              <IconTv size={32} color="rgba(255,255,255,0.25)" />
              <p>{onlyFav ? 'Aún no marcaste canales favoritos.' : 'Sin canales para mostrar.'}</p>
            </div>
          ) : (
            Object.entries(displayedGroups).map(([slug, group]) => (
              <div key={slug} className={`${styles.catSection} lt-in`}>
                <h3 className={styles.catTitle}>
                  <span className={styles.catIcon}>{categoryIcon(slug)}</span>
                  {group.name}
                  <span className={styles.catCount}>{group.channels.length}</span>
                </h3>
                <div className={styles.grid}>
                  {group.channels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      ch={ch}
                      onOpen={open}
                      isFavorite={isFavorite}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <LtMobileTabs />
    </div>
  );
}
