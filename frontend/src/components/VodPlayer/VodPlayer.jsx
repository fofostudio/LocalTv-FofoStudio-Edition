import { useEffect, useRef } from 'react';
import { IconClose } from '../icons/Icons';
import styles from './VodPlayer.module.css';

/**
 * Reproductor VOD full-screen. Toca una fuente {url, kind} que entrega
 * /resolve (solo fuentes autorizadas). Soporta HLS (hls.js / nativo), mp4
 * nativo y pistas de subtítulos. Guarda/retoma posición vía onProgress/startAt.
 */
export default function VodPlayer({ source, title, subtitles = [], startAt = 0, onClose, onProgress }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source?.url) return;

    const cleanup = () => {
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch (_) {} hlsRef.current = null; }
      try { video.removeAttribute('src'); video.load(); } catch (_) {}
    };

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
    const isHls = source.kind === 'hls' || /\.m3u8(\?|$)/i.test(source.url);

    if (!isHls || source.kind === 'mp4') {
      video.src = source.url;
    } else if (nativeHls) {
      video.src = source.url;
    } else if (window.Hls?.isSupported?.()) {
      const hls = new window.Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else {
      video.src = source.url; // último intento
    }

    const onLoaded = () => {
      if (startAt > 0 && startAt < (video.duration || Infinity)) {
        try { video.currentTime = startAt; } catch (_) {}
      }
      video.play().catch(() => {});
    };
    const onTime = () => { progressRef.current = video.currentTime; };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('timeupdate', onTime);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('timeupdate', onTime);
      if (onProgress && progressRef.current > 0) {
        onProgress(progressRef.current, video.duration || 0);
      }
      cleanup();
    };
  }, [source?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.overlay}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        {source?.demo && <span className={styles.demo}>fuente de demostración (CC)</span>}
        <button className={styles.close} onClick={onClose} aria-label="Cerrar"><IconClose size={18} color="#fff" /></button>
      </div>
      <video ref={videoRef} className={styles.video} controls autoPlay playsInline crossOrigin="anonymous">
        {subtitles.map((s, i) => (
          <track key={i} kind="subtitles" src={s.url} srcLang={s.lang} label={s.label} default={i === 0} />
        ))}
      </video>
    </div>
  );
}
