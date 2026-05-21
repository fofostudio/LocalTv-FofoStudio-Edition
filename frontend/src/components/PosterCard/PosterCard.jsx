import { memo, useState } from 'react';
import { tmdbImg } from '../../services/vodApi';
import styles from './PosterCard.module.css';

function PosterCard({ item, onOpen }) {
  const [failed, setFailed] = useState(false);
  const title = item.title || item.name || 'Sin título';
  const date = item.release_date || item.first_air_date || '';
  const year = date ? date.slice(0, 4) : '';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const poster = tmdbImg(item.poster_path, 'w342');
  const kind = item.media_type === 'tv' || item.name ? 'tv' : 'movie';

  return (
    <button type="button" className={styles.card} onClick={() => onOpen?.(item, kind)}>
      <div className={styles.posterWrap}>
        {poster && !failed ? (
          <img src={poster} alt="" loading="lazy" className={styles.poster} onError={() => setFailed(true)} />
        ) : (
          <div className={styles.posterFallback}>{title}</div>
        )}
        {rating && <span className={styles.rating}>★ {rating}</span>}
        <span className={styles.kind}>{kind === 'tv' ? 'Serie' : 'Película'}</span>
      </div>
      <div className={styles.meta}>
        <div className={styles.title}>{title}</div>
        {year && <div className={styles.year}>{year}</div>}
      </div>
    </button>
  );
}

export default memo(PosterCard);
