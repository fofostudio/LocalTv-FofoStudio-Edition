/**
 * Reproductor HLS nativo: <video controls> + hls.js.
 *
 * Cascada de recuperación con 6 métodos distintos + auto-skip:
 *
 *   tier 0  hls.js fresh — config standard
 *   tier 1  hls.js + soft recovery in-place (recoverMediaError / startLoad)
 *   tier 2  hls.js + cache-bust ?_t=<ts> + buffers chicos (recovery rápido)
 *   tier 3  hls.js + cache-bust + WORKER DESACTIVADO
 *           (transmux MPEG-TS→fMP4 corre en main thread; distinto code path
 *           que el worker, a veces evita demuxer-error específico)
 *   tier 4  hls.js + cache-bust + capLevelToPlayerSize + startLevel=0
 *           (fuerza la variante de menor bitrate — codecs más comunes,
 *           menos chances de codec exótico que rompa el demuxer)
 *   tier 5  native <video src> directo, sin hls.js
 *           (Chrome ≥100 en WebView puede usar su stack de media nativo
 *           y digerir HLS donde hls.js falla)
 *   tier 6+ AUTO-SKIP silencioso al próximo canal live (sin mostrar panel
 *           de error). Solo si fallan 3 canales seguidos mostramos panel.
 *
 * Cada cambio de canal resetea el tier. Cuando el stream finalmente arranca
 * (evento `playing`), también reseteamos el contador de auto-skips.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { streamPlaylistUrl, lanStreamUrl } from '../../services/platform';
import CastButton from '../CastButton/CastButton';
import styles from './VideoPlayer.module.css';

const BASE_URL = import.meta.env.VITE_API_URL || '';
const MAX_TIER = 5;        // tiers 0..5 — pasar 5 dispara auto-skip
const MAX_AUTO_SKIPS = 3;  // tras 3 canales saltados sin éxito, mostramos panel

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
  if (d.includes('demuxer') || d.includes('parse') || d.includes('bufferappenderror')) {
    return {
      title: 'Stream corrupto o no disponible',
      message: 'El servidor entregó datos que ningún reproductor pudo decodificar.',
      kind: 'unavailable',
    };
  }
  return {
    title: 'Error reproduciendo el canal',
    message: detail ? `(${detail})` : 'Probá otro canal.',
    kind: 'generic',
  };
}

function hlsConfigForTier(tier) {
  const base = {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    manifestLoadingMaxRetry: 2,
    manifestLoadingRetryDelay: 800,
    levelLoadingMaxRetry: 3,
    levelLoadingRetryDelay: 800,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 600,
    enableSoftwareAES: true,
    nudgeMaxRetry: 5,
  };
  if (tier <= 1) return base;
  if (tier === 2) {
    // Buffers chicos: si está corrupto, lo descubrimos rápido y reciclamos
    return { ...base, maxBufferLength: 10, maxMaxBufferLength: 30, backBufferLength: 10 };
  }
  if (tier === 3) {
    // Worker OFF: distinto path de transmux (a veces demuxer del worker
    // y del main thread tienen bugs distintos)
    return { ...base, enableWorker: false };
  }
  if (tier === 4) {
    // Force lowest variant: menos chances de codec exótico
    return {
      ...base,
      enableWorker: false,
      capLevelToPlayerSize: true,
      startLevel: 0,
      autoStartLoad: true,
    };
  }
  return base;
}

export default function VideoPlayer({ channel }) {
  const { nextLiveChannel, setCurrentChannel, healthLoading } = useContext(ChannelContext);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState(0);

  // Contador de auto-skips. Se resetea cuando un canal arranca a reproducir
  // o cuando el usuario elige manualmente un canal.
  const skipCountRef = useRef(0);

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

  // ----- Auto-skip cuando se acaban los métodos -----
  useEffect(() => {
    if (tier <= MAX_TIER) return;
    if (!channel?.slug) return;

    if (skipCountRef.current >= MAX_AUTO_SKIPS) {
      console.warn(`[player] giving up after ${skipCountRef.current + 1} channels`);
      setError({
        title: 'No hay canales disponibles',
        message:
          `Probamos ${skipCountRef.current + 1} canales y ninguno respondió. ` +
          'Verificá tu conexión o intentá más tarde.',
        kind: 'unavailable',
      });
      setLoading(false);
      return;
    }

    const next = nextLiveChannel(channel.slug);
    if (!next) {
      setError({
        title: 'Sin otros canales live',
        message: 'No hay otros canales para probar ahora.',
        kind: 'unavailable',
      });
      setLoading(false);
      return;
    }

    skipCountRef.current += 1;
    console.warn(
      `[player] auto-skip #${skipCountRef.current}: ${channel.slug} → ${next.slug}`
    );
    setCurrentChannel(next);
  }, [tier, channel?.slug, nextLiveChannel, setCurrentChannel]);

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
    if (tier > MAX_TIER) return; // el effect de auto-skip se encarga
    setLoading(true);

    let cancelled = false;
    let fatalCount = 0;

    const escalate = (detail) => {
      if (cancelled) return;
      console.warn(`[player] escalate ${channel.slug} tier=${tier}→${tier + 1} detail=${detail}`);
      setTier((t) => t + 1);
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

      // tier ≥ 2 → cache-buster fuerza re-resolve aguas arriba con tokens frescos
      const bustedUrl = tier >= 2
        ? `${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`
        : proxyUrl;

      // tier 5 → native <video src> sin hls.js. También aplicamos en Safari nativo.
      const useNative = tier >= 5 || video.canPlayType('application/vnd.apple.mpegurl');
      if (useNative) {
        video.src = bustedUrl;
        video.play().catch(() => { /* autoplay puede bloqueado */ });
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

      const hls = new Hls(hlsConfigForTier(tier));
      hlsRef.current = hls;
      hls.loadSource(bustedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // En tier 4 forzamos el primer level (lowest bitrate)
        if (tier === 4 && hls.levels?.length) {
          try { hls.currentLevel = 0; } catch (_) {}
        }
        video.play().catch(() => { /* autoplay bloqueado */ });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled) return;
        if (!data.fatal) return;
        fatalCount += 1;
        console.warn(
          `[hls] fatal #${fatalCount} tier=${tier} type=${data.type} detail=${data.details}`
        );

        // Tier 0/1: primer fatal recuperable → soft recovery in-place.
        // Esto nos ahorra un rebuild completo cuando el bug es transitorio.
        if (fatalCount === 1 && tier <= 1) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); return; } catch (_) {}
          }
          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            !String(data.details || '').toLowerCase().includes('manifest')
          ) {
            try { hls.startLoad(); return; } catch (_) {}
          }
        }

        escalate(data.details);
      });
    })();

    return () => { cancelled = true; cleanup(); };
  }, [channel?.slug, tier, healthLoading]);

  // ----- Listeners del <video> para sincronizar loading + errores -----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlaying = () => {
      setLoading(false);
      setError(null);
      // El stream arrancó: reseteamos el contador de saltos automáticos
      skipCountRef.current = 0;
    };
    const onWaiting = () => setLoading(true);
    const onError = () => {
      const code = v.error?.code;
      if (!code) return;
      // Code 3 = MEDIA_ERR_DECODE (demuxer en native). Code 4 = unsupported.
      // Ambos son fatales del path nativo → escalamos al siguiente tier.
      if (tier <= MAX_TIER) {
        console.warn(
          `[video.error] ${channel?.slug} tier=${tier} code=${code} msg=${v.error?.message} → escalate`
        );
        setTier((t) => t + 1);
      }
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

  // Reset de skip count cuando el usuario elige un canal manualmente.
  // Detectamos "elección manual" por cambio de slug + tier === 0.
  // (Si el cambio fue por auto-skip, el efecto de auto-skip ya incrementó
  // skipCountRef antes de que tier se resetee a 0.)
  useEffect(() => {
    // Cuando un canal arranca a reproducir, onPlaying ya resetea.
    // Acá solo cuidamos un caso: si el user toca el botón "Reintentar"
    // explícitamente (lo cual setea tier = 0).
  }, [channel?.slug]);

  const tryNextLive = () => {
    skipCountRef.current = 0;
    const next = nextLiveChannel(channel?.slug);
    if (next) setCurrentChannel(next);
  };

  const retry = () => {
    skipCountRef.current = 0;
    setError(null);
    setTier(0);
  };

  const finalCastUrl = useMemo(
    () => castUrl || `${window.location.origin}${BASE_URL}/api/streams/${channel?.slug || ''}/playlist.m3u8`,
    [castUrl, channel?.slug],
  );

  // Texto de progreso para el overlay
  const overlayText = (() => {
    if (tier === 0) return 'Cargando…';
    if (tier > MAX_TIER) {
      const n = skipCountRef.current + 1;
      return `Saltando al próximo canal (${n}/${MAX_AUTO_SKIPS + 1})…`;
    }
    return `Reintentando (método ${tier + 1}/${MAX_TIER + 1})…`;
  })();

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
          <p>{overlayText}</p>
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
