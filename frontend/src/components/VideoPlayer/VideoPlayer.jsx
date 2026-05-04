/**
 * Reproductor HLS nativo: <video controls> + hls.js.
 *
 * Por qué cambiamos Clappr por esto:
 *   - Controles del sistema operativo (touch nativo en mobile, atajos en
 *     desktop, accesibilidad).
 *   - Picture-in-Picture y AirPlay automáticos sin botón custom.
 *   - ~30 KB de hls.js vs ~150 KB de Clappr.
 *   - Safari (iOS / macOS) reproduce HLS nativo sin lib extra.
 *
 * El Cast SDK (Chromecast) sigue siendo independiente y se monta encima
 * via CastButton.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { streamPlaylistUrl, lanStreamUrl } from '../../services/platform';
import CastButton from '../CastButton/CastButton';
import styles from './VideoPlayer.module.css';

const BASE_URL = import.meta.env.VITE_API_URL || '';

function describeError(detail) {
  // hls.js error.details + casos del demuxer (mediaError) los más comunes
  const d = String(detail || '').toLowerCase();
  if (d.includes('manifestloaderror') || d.includes('manifestparsingerror')) {
    return {
      title: 'Canal no disponible ahora',
      message: 'El servidor no devolvió un manifest válido. Probá otro canal.',
      kind: 'unavailable',
    };
  }
  if (d.includes('fragloaderror') || d.includes('fragparsingerror')) {
    return {
      title: 'Stream interrumpido',
      message: 'Se cortó la descarga de fragmentos.',
      kind: 'network',
    };
  }
  if (d.includes('levelloaderror') || d.includes('levelparsingerror')) {
    return {
      title: 'Nivel de calidad no disponible',
      message: 'El stream no se pudo cargar.',
      kind: 'network',
    };
  }
  // demuxer-error: could not parse — el contenido no es un m3u8 válido
  // (típico cuando el upstream cae y devuelve HTML / página vacía).
  if (d.includes('demuxer') || d.includes('parse') || d.includes('bufferappenderror')) {
    return {
      title: 'Stream corrupto o no disponible',
      message: 'El servidor entregó un manifest inválido. Probá otro canal.',
      kind: 'unavailable',
    };
  }
  return {
    title: 'Error reproduciendo el canal',
    message: detail ? `(${detail})` : 'Probá otro canal.',
    kind: 'generic',
  };
}

export default function VideoPlayer({ channel }) {
  const { nextLiveChannel, setCurrentChannel, isLive, healthLoading } = useContext(ChannelContext);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [forcePlay, setForcePlay] = useState(false);

  // ----- URL pública LAN para Chromecast (resuelta async) -----
  const [castUrl, setCastUrl] = useState(null);
  useEffect(() => {
    if (!channel?.slug) { setCastUrl(null); return; }
    let cancelled = false;
    lanStreamUrl(channel.slug).then((u) => { if (!cancelled) setCastUrl(u); });
    return () => { cancelled = true; };
  }, [channel?.slug]);

  // ----- Carga del stream cuando cambia el canal -----
  useEffect(() => {
    const cleanup = () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
        hlsRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch (_) {}
        try { video.removeAttribute('src'); video.load(); } catch (_) {}
      }
    };
    cleanup();
    setError(null);

    if (!channel?.slug) return;
    setLoading(true);

    let cancelled = false;
    (async () => {
      let proxyUrl;
      try {
        proxyUrl = await streamPlaylistUrl(channel.slug);
      } catch (e) {
        if (!cancelled) {
          setError({ title: 'No se pudo iniciar el proxy HLS', message: e.message, kind: 'generic' });
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;

      // Safari (macOS/iOS) soporta HLS nativo. En el resto, usamos hls.js.
      const isNativeHls = video.canPlayType('application/vnd.apple.mpegurl');
      if (isNativeHls) {
        video.src = proxyUrl;
        video.play().catch(() => { /* autoplay puede ser bloqueado */ });
        return;
      }

      const Hls = window.Hls;
      if (!Hls?.isSupported?.()) {
        setError({
          title: 'Player no compatible',
          message: 'Este navegador no soporta HLS. Usá Chrome, Edge, Firefox o Safari.',
          kind: 'generic',
        });
        setLoading(false);
        return;
      }

      const hls = new Hls({
        // enableWorker: hls.js usa un Web Worker para hacer el transmuxing
        // MPEG-TS → fMP4 sin bloquear el main thread. CRÍTICO en Android
        // WebView: sin esto, todos los streams TS dan demuxer-error porque
        // Chrome no soporta MPEG-TS nativo en MediaSource.
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        // Reintentos generosos para absorber baches transitorios del proxy
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 800,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 800,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 600,
        // En WebView Android, software AES garantiza que cifrado no falle
        enableSoftwareAES: true,
        // No abortar fragments que tarden poquito más
        nudgeMaxRetry: 5,
      });
      hlsRef.current = hls;
      hls.loadSource(proxyUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => { /* autoplay bloqueado, el user le da play */ });
      });

      // Recovery automático: cuando hls.js dice "fatal", primero
      // intentamos recoverMediaError() / startLoad() según el tipo. Si
      // después de 2 errores en una ventana corta sigue fallando,
      // mostramos el panel de error y damos opción de saltar al próximo
      // canal live.
      let fatalCount = 0;
      let fatalWindowStart = 0;
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled) return;
        const now = Date.now();
        // Reset de la ventana después de 8s sin errores
        if (now - fatalWindowStart > 8000) { fatalWindowStart = now; fatalCount = 0; }

        if (!data.fatal) return;
        fatalCount += 1;
        console.warn(`[hls] fatal ${fatalCount}: ${data.type} / ${data.details}`);

        // Primer fatal: intentar recovery
        if (fatalCount <= 1) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); return; } catch (_) {}
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try { hls.startLoad(); return; } catch (_) {}
          }
        }

        // Segundo fatal o no recuperable → mostrar panel
        setError(describeError(data.details));
        setLoading(false);
      });
    })();

    return () => { cancelled = true; cleanup(); };
  }, [channel?.slug, forcePlay, healthLoading]);

  // Reset forcePlay cuando cambia el canal
  useEffect(() => { setForcePlay(false); }, [channel?.slug]);

  // ----- Listeners del <video> para sincronizar loading + errores -----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlaying = () => { setLoading(false); setError(null); };
    const onWaiting = () => setLoading(true);
    const onError = () => {
      const code = v.error?.code;
      if (!code) return;
      // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED — típico de canal caído
      const kind = code === 4 ? 'unavailable' : 'network';
      setError({
        title: code === 4 ? 'Canal no disponible' : 'Error de reproducción',
        message: v.error?.message || `Código ${code}`,
        kind,
      });
      setLoading(false);
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('error', onError);
    return () => {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('error', onError);
    };
  }, [channel?.slug]);

  const tryNextLive = () => {
    const next = nextLiveChannel(channel?.slug);
    if (next) setCurrentChannel(next);
  };

  const finalCastUrl = useMemo(
    () => castUrl || `${window.location.origin}${BASE_URL}/api/streams/${channel?.slug || ''}/playlist.m3u8`,
    [castUrl, channel?.slug],
  );

  return (
    <div className={styles.playerWrapper}>
      <video
        ref={videoRef}
        className={styles.player}
        controls
        playsInline
        autoPlay
        // x-webkit-airplay habilita el botón AirPlay nativo en iOS/macOS Safari
        x-webkit-airplay="allow"
        poster={channel?.logo_url || undefined}
      />

      {channel && (
        <div className={styles.controls}>
          <CastButton
            streamUrl={finalCastUrl}
            channelName={channel.name}
            logoUrl={channel.logo_url}
            loading={loading}
          />
        </div>
      )}

      {!channel && (
        <div className={styles.placeholder}>
          <p>Selecciona un canal para ver el stream</p>
        </div>
      )}

      {loading && channel && !error && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <p>Cargando…</p>
        </div>
      )}

      {error && (
        <div className={styles.errorPanel}>
          <div className={styles.errorIcon}>
            {error.kind === 'unavailable' ? '⚠' : '✕'}
          </div>
          <h3 className={styles.errorTitle}>{error.title}</h3>
          <p className={styles.errorMsg}>{error.message}</p>
          <div className={styles.errorActions}>
            <button className={styles.errorBtnPrimary} onClick={tryNextLive}>
              ▶ Probar otro canal disponible
            </button>
            {error.canForce && (
              <button
                className={styles.errorBtnGhost}
                onClick={() => { setError(null); setForcePlay(true); }}
              >
                Intentar igual
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
