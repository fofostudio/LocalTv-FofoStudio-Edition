import { useEffect, useRef } from 'react';
import { IconClose, IconFullscreen } from '../icons/Icons';
import styles from './VodPlayer.module.css';

/**
 * Reproductor VOD. Vive a nivel app (driven por ChannelContext) para que la
 * reproducción sobreviva al "atrás" y se pueda minimizar a PiP.
 * - "hls":  .m3u8 → hls.js o nativo
 * - "mp4":  directo en <video>
 * - "embed": iframe (embed de terceros)
 * - minimized: mini-player flotante (PiP); el mismo elemento se mantiene
 *   montado al alternar, así no se corta la reproducción.
 */
export default function VodPlayer({
  source, title, subtitles = [], startAt = 0,
  minimized = false, onClose, onMinimize, onExpand, onProgress,
}) {
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const hlsRef = useRef(null);
  const progressRef = useRef(0);
  const isEmbed = source?.kind === 'embed';

  // Modo video (hls / mp4)
  useEffect(() => {
    if (isEmbed) return;
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
      video.src = source.url;
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

  const wrapClass = `${styles.overlay} ${minimized ? styles.mini : ''}`;

  return (
    <div className={wrapClass}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        {!minimized && source?.label && <span className={styles.demo}>{source.label}</span>}
        <span className={styles.barActions}>
          {minimized ? (
            <button className={styles.close} onClick={onExpand} aria-label="Expandir" title="Expandir">
              <IconFullscreen size={16} color="#fff" />
            </button>
          ) : (
            <button className={styles.close} onClick={onMinimize} aria-label="Minimizar" title="Minimizar (seguir en PiP)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 10l5 5 5-5" />
              </svg>
            </button>
          )}
          <button className={styles.close} onClick={onClose} aria-label="Cerrar" title="Cerrar">
            <IconClose size={18} color="#fff" />
          </button>
        </span>
      </div>

      {isEmbed ? (
        <iframe
          ref={iframeRef}
          className={styles.video}
          src={source.url}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          style={{ border: 0, width: '100%', height: '100%' }}
        />
      ) : (
        <video
          ref={videoRef}
          className={styles.video}
          controls={!minimized}
          autoPlay
          playsInline
          crossOrigin="anonymous"
        >
          {subtitles.map((s, i) => (
            <track key={i} kind="subtitles" src={s.url} srcLang={s.lang} label={s.label} default={i === 0} />
          ))}
        </video>
      )}

      {/* En PiP, click sobre el video lo expande. */}
      {minimized && (
        <button className={styles.miniExpand} onClick={onExpand} aria-label="Expandir" />
      )}
    </div>
  );
}
