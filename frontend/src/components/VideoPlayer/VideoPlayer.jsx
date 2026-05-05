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
 * Cascada de recuperación multi-tier (clave para Android — ver
 * mobile/android-plugin/HlsProxyServer.kt):
 *
 *   tier 0  carga hls.js limpia
 *   tier 1  in-place: recoverMediaError() / startLoad()
 *   tier 2  rebuild duro con cache-buster ?_t=<ts> (fuerza re-resolve
 *           del manifest aguas arriba — los tokens de tvtvhd expiran
 *           cada minuto, por eso el demuxer-error reaparece)
 *   tier 3  fallback nativo: video.src = url. Chrome ≥ 100 en WebView
 *           sabe digerir algunos HLS por sí mismo, especialmente fMP4.
 *   tier 4  panel de error + auto-skip al próximo canal live.
 *
 * Cada tier resetea fatalCount, permitiendo soft-recovery local antes
 * de escalar.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { streamPlaylistUrl, lanStreamUrl } from '../../services/platform';
import CastButton from '../CastButton/CastButton';
import styles from './VideoPlayer.module.css';

const BASE_URL = import.meta.env.VITE_API_URL || '';
const MAX_TIER = 3; // 0..3 — al pasar de 3 mostramos el panel

function describeError(detail) {
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
  const { nextLiveChannel, setCurrentChannel, healthLoading } = useContext(ChannelContext);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Tier de recuperación — sube cuando un tier falla. Se resetea cuando
  // el usuario cambia de canal o cuando el stream arranca a reproducir.
  const [tier, setTier] = useState(0);

  // ----- URL pública LAN para Chromecast (resuelta async) -----
  const [castUrl, setCastUrl] = useState(null);
  useEffect(() => {
    if (!channel?.slug) { setCastUrl(null); return; }
    let cancelled = false;
    lanStreamUrl(channel.slug).then((u) => { if (!cancelled) setCastUrl(u); });
    return () => { cancelled = true; };
  }, [channel?.slug]);

  // Reset de tier + error al cambiar de canal
  useEffect(() => {
    setTier(0);
    setError(null);
  }, [channel?.slug]);

  // ----- Carga del stream (corre cuando cambia el canal o el tier) -----
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

    if (!channel?.slug) return;
    if (tier > MAX_TIER) {
      // Llegamos al final — error panel ya está mostrado o se muestra
      return;
    }
    setLoading(true);

    let cancelled = false;
    let fatalCount = 0;

    // escalate() — bumpea el tier (rebuild) o muestra panel si ya no hay
    // tier disponible. Se llama desde los handlers de error de hls.js
    // y del <video> nativo.
    const escalate = (detail) => {
      if (cancelled) return;
      console.warn(`[player] escalate tier=${tier} detail=${detail}`);
      if (tier < MAX_TIER) {
        setTier(tier + 1);
      } else {
        setError(describeError(detail));
        setLoading(false);
      }
    };

    (async () => {
      let proxyUrl;
      try {
        proxyUrl = await streamPlaylistUrl(channel.slug);
      } catch (e) {
        if (!cancelled) {
          setError({
            title: 'No se pudo iniciar el proxy HLS',
            message: e.message,
            kind: 'generic',
          });
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;

      // tier ≥ 2: cache-buster fuerza fetch nuevo (ignora 304/cache local
      // del WebView) y por consecuencia re-resolve aguas arriba con
      // tokens frescos.
      const bustedUrl = tier >= 2
        ? `${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`
        : proxyUrl;

      // tier 3: native <video src>. Saltamos hls.js completamente.
      const useNative = tier >= 3 || video.canPlayType('application/vnd.apple.mpegurl');
      if (useNative) {
        video.src = bustedUrl;
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
        enableSoftwareAES: true,
        nudgeMaxRetry: 5,
        // En rebuild con cache-bust queremos partir desde cero — sin
        // estado heredado del intento anterior.
        startFragPrefetch: false,
      });
      hlsRef.current = hls;
      hls.loadSource(bustedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => { /* autoplay bloqueado, el user le da play */ });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled) return;
        if (!data.fatal) return;
        fatalCount += 1;
        console.warn(
          `[hls] fatal #${fatalCount} tier=${tier} type=${data.type} detail=${data.details}`
        );

        // Tier 0/1 con primer fatal recuperable: probamos in-place primero.
        // Esto nos ahorra un rebuild completo cuando el bug es transitorio.
        if (fatalCount === 1 && tier <= 1) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); return; } catch (_) {}
          }
          // NETWORK_ERROR de un fragmento (no del manifest) suele
          // recuperarse con startLoad. Si es manifestLoadError mejor
          // escalar directo: el manifest ya falló a fondo.
          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            !String(data.details || '').toLowerCase().includes('manifest')
          ) {
            try { hls.startLoad(); return; } catch (_) {}
          }
        }

        // No recuperable in-place → escalamos al siguiente tier.
        escalate(data.details);
      });
    })();

    return () => { cancelled = true; cleanup(); };
  }, [channel?.slug, tier, healthLoading]);

  // ----- Listeners del <video> para sincronizar loading + errores -----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlaying = () => { setLoading(false); setError(null); };
    const onWaiting = () => setLoading(true);
    const onError = () => {
      const code = v.error?.code;
      if (!code) return;
      // En tier nativo, error del <video> también escala. Si ya estamos
      // en MAX_TIER, mostramos panel directo.
      if (tier < MAX_TIER) {
        console.warn(`[video.error] tier=${tier} code=${code} → escalate`);
        setTier(tier + 1);
        return;
      }
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
  }, [channel?.slug, tier]);

  const tryNextLive = () => {
    const next = nextLiveChannel(channel?.slug);
    if (next) setCurrentChannel(next);
  };

  const retry = () => {
    setError(null);
    setTier(0);
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
          <p>{tier === 0 ? 'Cargando…' : `Reintentando (método ${tier + 1})…`}</p>
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
            <button className={styles.errorBtnGhost} onClick={retry}>
              ↻ Reintentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
