import styles from './LoadingSpinner.module.css';

export default function LoadingSpinner() {
  return (
    <div className={styles.container}>
      <div className={styles.spinnerWrap}>
        <div className={styles.spinner} />
        <div className={styles.spinnerInner} />
      </div>
      <p className={styles.text}>Cargando canales...</p>
      <p className={styles.subtitle}>FofoStudio · LocalTv</p>
    </div>
  );
}
