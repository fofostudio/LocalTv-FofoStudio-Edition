import { useContext, useMemo, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { getLogoFor } from '../../utils/channelLogos';
import styles from './ChannelCard.module.css';

const GRADIENTS = [
  'linear-gradient(135deg, #e50914 0%, #b00610 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #0e7490 100%)',
  'linear-gradient(135deg, #f5a524 0%, #b45309 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #5b21b6 100%)',
  'linear-gradient(135deg, #22c55e 0%, #166534 100%)',
  'linear-gradient(135deg, #ec4899 0%, #9d174d 100%)',
  'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #9f1239 100%)',
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

export default function ChannelCard({
  channel,
  isSelected,
  onSelect,
  isFavorite,
  onToggleFavorite,
  variant = 'tile',
}) {
  const { isLive, healthLoading } = useContext(ChannelContext);
  const live = isLive(channel.slug);
  const isInactive = channel.is_active === false;       // desactivado por admin
  const isOffline  = !healthLoading && !live && !isInactive; // upstream caído

  // Logo: prioridad channel.logo_url > map curado > fallback
  const logo = useMemo(() => getLogoFor(channel), [channel]);
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = logo && !logoFailed;

  const gradient = useMemo(
    () => GRADIENTS[hashString(channel.slug || channel.name) % GRADIENTS.length],
    [channel.slug, channel.name]
  );

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    onToggleFavorite?.(channel.id);
  };

  const dimClass = (isInactive || isOffline) ? styles.dim : '';

  // ---------- LIST variant ----------
  if (variant === 'list') {
    return (
      <div
        className={`${styles.list} ${isSelected ? styles.listSelected : ''} ${dimClass}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        aria-pressed={isSelected}
        title={channel.name}
      >
        <div className={styles.listLogo} style={{ background: showLogo ? '#0e0e16' : gradient }}>
          {showLogo
            ? <img src={logo} alt="" loading="lazy" onError={() => setLogoFailed(true)} />
            : <span className={styles.listInitials}>{initials(channel.name)}</span>}
        </div>
        <div className={styles.listText}>
          <div className={styles.listName}>{channel.name}</div>
          <div className={styles.listMeta}>
            {isInactive ? (
              <><span className={`${styles.dot} ${styles.dotInactive}`} /> INACTIVO</>
            ) : (
              <><span className={`${styles.dot} ${live ? styles.dotLive : styles.dotOff}`} />
                {healthLoading ? '...' : live ? 'EN VIVO' : 'OFFLINE'}</>
            )}
          </div>
        </div>
        {onToggleFavorite && (
          <button
            className={`${styles.favBtn} ${isFavorite ? styles.favActive : ''}`}
            onClick={handleFavoriteClick}
            aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          >★</button>
        )}
      </div>
    );
  }

  // ---------- TILE variant ----------
  let badgeText = null;
  let badgeClass = '';
  if (isInactive)      { badgeText = 'INACTIVO'; badgeClass = styles.inactiveBadge; }
  else if (live)       { badgeText = 'LIVE';     badgeClass = styles.liveBadge; }
  else if (isOffline)  { badgeText = 'OFFLINE';  badgeClass = styles.offlineBadge; }

  return (
    <div
      className={`${styles.tile} ${isSelected ? styles.tileSelected : ''} ${dimClass}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={isSelected}
      title={isInactive ? `${channel.name} (inactivo)` : isOffline ? `${channel.name} (no disponible ahora)` : channel.name}
      style={{ '--card-bg': showLogo ? '#0e0e16' : gradient }}
    >
      <div className={styles.tileMedia}>
        {showLogo
          ? <img className={styles.tileLogo} src={logo} alt={channel.name} loading="lazy"
                 onError={() => setLogoFailed(true)} />
          : <span className={styles.tileInitials}>{initials(channel.name)}</span>}
        <div className={styles.tileGloss} />
        {badgeText && (
          <span className={badgeClass}>
            {live && <span className={styles.liveBadgeDot} />}
            {badgeText}
          </span>
        )}
        {onToggleFavorite && (
          <button
            className={`${styles.favBtn} ${styles.tileFav} ${isFavorite ? styles.favActive : ''}`}
            onClick={handleFavoriteClick}
            aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          >★</button>
        )}
      </div>
      <div className={styles.tileFooter}>
        <span className={styles.tileName}>{channel.name}</span>
      </div>
    </div>
  );
}
