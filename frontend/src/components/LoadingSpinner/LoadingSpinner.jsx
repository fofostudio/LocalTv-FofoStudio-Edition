import { LocalTvMark, LocalTvWordmark } from '../Brand/Brand';
import styles from './LoadingSpinner.module.css';

export default function LoadingSpinner({ text = 'Cargando canales…' }) {
  return (
    <div className={styles.container}>
      <div className={styles.logoWrap}>
        <span className={styles.ring} />
        <span className={styles.logoPulse}>
          <LocalTvMark size={44} radius={13} />
        </span>
      </div>
      <LocalTvWordmark size={18} />
      <p className={styles.text}>{text}</p>
      <div className={styles.bar}><span /></div>
      <p className={styles.subtitle}>FofoStudio Edition</p>
    </div>
  );
}
