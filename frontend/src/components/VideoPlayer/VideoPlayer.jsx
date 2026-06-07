/**
 * Reproductor HLS multi-motor: <video> + cascada de motores y recuperación.
 *
 * Motores (se prueban en orden, escalando tier a tier):
 *   tier 0  hls.js fresh — config standard
 *   tier 1  hls.js + soft recovery in-place (recoverMediaError / startLoad)
 *   tier 2  hls.js + cache-bust ?_t=<ts> + buffers chicos
 *   tier 3  hls.js + cache-bust + WORKER DESACTIVADO (otro code path de demux)
 *   tier 4  hls.js + cache-bust + capLevelToPlayerSize + startLevel=0 (menor bitrate)
 *   tier 5  SHAKA-PLAYER (lazy desde CDN) — parser/demuxer independiente de
 *           hls.js; reproduce HLS donde hls.js falla y es muy compatible con
 *           Smart TVs / WebViews.
 *   tier 6  <video src> NATIVO directo, sin librería (Safari/iOS/algunas TV
 *           digieren HLS nativo donde todo lo demás falla).
 *   tier 7+ AUTO-SKIP silencioso al próximo canal live.
 *
 * En navegadores con HLS nativo (Safari/iOS/varias TV) usamos el motor nativo
 * de entrada y solo escalamos a hls.js/shaka si falla.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { streamPlaylistUrl, lanStreamUrl, resetHlsProxy, isCapacitor, getProxyDiagnostics } from '../../services/platform';
import { setPlayerEngine } from '../../hooks/usePlayerEngine';
import { isLite } from '../../utils/device';
import CastButton from '../CastButton/CastButton';
import styles from './VideoPlayer.module.css';

const MAX_AUTO_SKIPS = 3;

const SHAKA_URL = 'https://cdn.jsdelivr.net/npm/shaka-player@4.11.2/dist/shaka-player.compiled.js';

/**
 * Orden de motores según el dispositivo. Cada paso es {e:'hls'|'shaka'|'native', t?}.
 *  - Safari/iOS/TV con HLS nativo  → nativo primero (lo digieren mejor que MSE).
 *  - TV / modo ligero              → nativo y shaka antes que hls.js (MSE es
 *                                    pesado/inestable en muchos navegadores de TV).
 *  - PC (Chrome/Edge/Firefox)      → hls.js primero (lo más fiable en desktop),
 *                                    luego shaka y nativo como respaldo.
 */
function enginePlan(lite, nativeCapable, capacitor) {
  // Android WebView (Capacitor): NO tiene HLS nativo, así que el <video> nativo
  // no sirve (no lo incluimos). El motor real es hls.js (empaquetado) y shaka
  // (también empaquetado) como respaldo. Probamos el worker de hls.js activado
  // y desactivado: en varias WebViews el worker falla y sin worker anda.
  if (capacitor) {
    // Worker DESACTIVADO primero (t3): el worker de hls.js falla en varias
    // WebViews de Android y hace ciclar los tiers. Sin worker es más lento pero
    // mucho más compatible → arranca a la primera. Luego con worker, luego shaka.
    return [{ e: 'hls', t: 3 }, { e: 'hls', t: 0 }, { e: 'hls', t: 4 }, { e: 'shaka' }];
  }
  if (nativeCapable) return [{ e: 'native' }, { e: 'shaka' }, { e: 'hls', t: 0 }, { e: 'hls', t: 2 }, { e: 'hls', t: 3 }];
  if (lite) return [{ e: 'native' }, { e: 'shaka' }, { e: 'hls', t: 0 }, { e: 'hls', t: 2 }, { e: 'hls', t: 4 }];
  return [{ e: 'hls', t: 0 }, { e: 'hls', t: 1 }, { e: 'hls', t: 2 }, { e: 'hls', t: 3 }, { e: 'hls', t: 4 }, { e: 'shaka' }, { e: 'native' }];
}

// Carga perezosa de un <script> CDN (una sola vez por URL).
const _scriptPromises = new Map();
function loadScript(src) {
  if (_scriptPromises.has(src)) return _scriptPromises.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
  _scriptPromises.set(src, p);
  return p;
}

// shaka-player EMPAQUETADO (lazy chunk) en vez de sólo-CDN. Igual que hls.js,
// el CDN no cargaba en Android/redes lentas y dejaba el respaldo inútil. Local
// primero, CDN como último recurso.
let _shakaPromise = null;
function loadShaka() {
  if (_shakaPromise) return _shakaPromise;
  _shakaPromise = (async () => {
    try {
      const mod = await import('shaka-player/dist/shaka-player.compiled.js');
      return mod?.default || window.shaka;
    } catch (_) {
      await loadScript(SHAKA_URL);
      return window.shaka;
    }
  })();
  return _shakaPromise;
}

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
    // Buffers acotados: en vivo no sirve bufferear minutos (default 600s ⇒
    // memoria + lag al recuperar). 30s da margen contra cortes sin inflar RAM.
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    // Reintentos más generosos: el upstream (tvtvhd vía proxy) tiene blips
    // transitorios; abandonar a la 2da rompía la transmisión en vivo.
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 700,
    manifestLoadingMaxRetryTimeout: 8000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 700,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 600,
    fragLoadingMaxRetryTimeout: 8000,
    // Tratar el stream como live infinito y resincronizar si el player se
    // queda atrás del live edge (evita freezes prolongados).
    liveDurationInfinity: true,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    enableSoftwareAES: true,
    nudgeMaxRetry: 8,
  };
  if (tier <= 1) return base;
  if (tier === 2) {
    return { ...base, maxBufferLength: 10, maxMaxBufferLength: 30, backBufferLength: 10 };
  }
  if (tier === 3) {
    return { ...base, enableWorker: false };
  }
  if (tier === 4) {
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
  const { nextLiveChannel, setCurrentChannel, setCurrentChannelSilent } = useContext(ChannelContext);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const shakaRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState(0);
  const [diag, setDiag] = useState(null);

  const skipCountRef = useRef(0);

  // Diagnóstico del proxy nativo en móvil: se dispara cuando hay error O cuando
  // ya escaló de tier (tier>0 = el primer motor falló). Prueba toda la cadena
  // plugin→base→/health→playlist→segmento para ver EXACTAMENTE dónde rompe.
  useEffect(() => {
    if (!isCapacitor() || !channel?.slug || (!error && tier === 0)) { setDiag(null); return; }
    let alive = true;
    getProxyDiagnostics(channel.slug).then((d) => { if (alive) setDiag(d); }).catch(() => {});
    return () => { alive = false; };
  }, [error, tier, channel?.slug]);

  const diagLine = diag && (
    diag.plugin === false
      ? '⚠ proxy nativo NO registrado'
      : `base:${diag.base ? 'ok' : '✗'} health:${diag.health ?? '—'} pl:${diag.pl ?? '—'}${diag.plHls === false ? '(no-hls)' : ''} seg:${diag.seg ?? '—'}${diag.error ? ' ' + diag.error : ''}`
  );

  // Plan de motores según dispositivo (estable durante la sesión).
  const nativeCapable = useMemo(() => {
    try { return !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'); }
    catch { return false; }
  }, []);
  const plan = useMemo(() => enginePlan(isLite(), nativeCapable, isCapacitor()), [nativeCapable]);
  const maxTier = plan.length - 1;

  // ----- URL pública LAN para Chromecast -----
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

  // ----- Auto-skip cuando se acaban los motores -----
  useEffect(() => {
    if (tier <= maxTier) return;
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
    console.warn(`[player] auto-skip #${skipCountRef.current}: ${channel.slug} → ${next.slug}`);
    // Failover silencioso: NO scrollear al tope (el usuario está mirando).
    setCurrentChannelSilent(next);
  }, [tier, maxTier, channel?.slug, nextLiveChannel, setCurrentChannelSilent]);

  // ----- Carga del stream (corre cuando cambia el canal o el tier) -----
  useEffect(() => {
    const cleanup = () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
        hlsRef.current = null;
      }
      if (shakaRef.current) {
        try { shakaRef.current.destroy(); } catch (_) { /* ignore */ }
        shakaRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch (_) {}
        try { video.removeAttribute('src'); video.load(); } catch (_) {}
      }
    };
    cleanup();

    if (!channel?.slug) return;
    if (tier > maxTier) return; // el effect de auto-skip se encarga
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
        if (isCapacitor()) console.info(`[player] proxyUrl=${proxyUrl} engine=${plan[tier]?.e} t=${plan[tier]?.t ?? ''}`);
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

      // En cualquier reintento pedimos tokens frescos aguas arriba.
      const bustedUrl = tier >= 1
        ? `${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`
        : proxyUrl;

      const step = plan[tier] || { e: 'native' };

      // ----- Motor NATIVO -----
      if (step.e === 'native') {
        setPlayerEngine('nativo');
        video.src = bustedUrl;
        video.play().catch(() => { /* autoplay bloqueado */ });
        return;
      }

      // ----- Motor SHAKA-PLAYER -----
      if (step.e === 'shaka') {
        setPlayerEngine('shaka');
        try {
          const shaka = await loadShaka();
          if (cancelled) return;
          if (!shaka?.Player) { escalate('shaka-missing'); return; }
          if (shaka.Player.isBrowserSupported && !shaka.Player.isBrowserSupported()) {
            escalate('shaka-unsupported'); return;
          }
          try { shaka.polyfill.installAll(); } catch (_) {}
          const player = new shaka.Player();
          shakaRef.current = player;
          await player.attach(video);
          if (cancelled) return;
          player.addEventListener('error', (ev) => {
            if (cancelled) return;
            console.warn('[shaka] error', ev?.detail);
            escalate(`shaka:${ev?.detail?.code || 'err'}`);
          });
          await player.load(bustedUrl);
          if (cancelled) return;
          video.play().catch(() => { /* autoplay bloqueado */ });
        } catch (e) {
          if (!cancelled) escalate(`shaka-init:${e?.message || e}`);
        }
        return;
      }

      // ----- Motor hls.js -----
      const Hls = window.Hls;
      if (!Hls?.isSupported?.()) {
        escalate('hls-unsupported');
        return;
      }

      const hlsTier = step.t || 0;
      setPlayerEngine('hls.js');
      const hls = new Hls(hlsConfigForTier(hlsTier));
      hlsRef.current = hls;
      hls.loadSource(bustedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hlsTier === 4 && hls.levels?.length) {
          try { hls.currentLevel = 0; } catch (_) {}
        }
        video.play().catch(() => { /* autoplay bloqueado */ });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled) return;
        if (!data.fatal) return;
        fatalCount += 1;
        console.warn(`[hls] fatal #${fatalCount} tier=${tier} hlsTier=${hlsTier} type=${data.type} detail=${data.details}`);

        if (fatalCount === 1 && hlsTier <= 1) {
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
    // OJO: NO incluir healthLoading acá. Antes estaba en las deps y como cambia
    // (true→false) cada vez que termina un refresh de "en vivo", reejecutaba el
    // effect → cleanup() destruía hls y recargaba el stream → corte/parpadeo en
    // un canal que ya estaba andando. El effect no usa healthLoading.
  }, [channel?.slug, tier]);

  // ----- Listeners del <video> -----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlaying = () => {
      setLoading(false);
      setError(null);
      skipCountRef.current = 0;
    };
    const onWaiting = () => setLoading(true);
    const onError = () => {
      const code = v.error?.code;
      if (!code) return;
      if (tier <= maxTier) {
        console.warn(`[video.error] ${channel?.slug} tier=${tier} code=${code} → escalate`);
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

  const tryNextLive = () => {
    skipCountRef.current = 0;
    const next = nextLiveChannel(channel?.slug);
    if (next) setCurrentChannel(next);
  };

  const retry = () => {
    skipCountRef.current = 0;
    // Por si el proxy nativo (Android) reinició en otro puerto tras un resume:
    // invalida el baseUrl cacheado para forzar un start() fresco. No-op en web.
    resetHlsProxy();
    setError(null);
    setTier(0);
  };

  // Sólo casteamos con una URL LAN real alcanzable por el Chromecast. El
  // localhost del emisor NO sirve (el dispositivo de cast no lo alcanza), así
  // que si no hay IP LAN dejamos null → CastButton queda deshabilitado en vez
  // de castear una URL muerta.
  const finalCastUrl = castUrl || null;

  const overlayText = (() => {
    if (tier === 0) return 'Cargando…';
    if (tier > maxTier) {
      const n = skipCountRef.current + 1;
      return `Saltando al próximo canal (${n}/${MAX_AUTO_SKIPS + 1})…`;
    }
    const step = plan[tier];
    if (step?.e === 'shaka') return 'Probando motor alternativo (shaka)…';
    if (step?.e === 'native') return 'Probando reproductor nativo…';
    return `Reintentando (método ${tier + 1}/${maxTier + 1})…`;
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
          {diagLine && (
            <p style={{ fontSize: '10px', opacity: 0.6, marginTop: 6, fontFamily: 'monospace', textAlign: 'center', padding: '0 12px' }}>
              {diagLine}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className={styles.errorPanel}>
          <div className={styles.errorIcon}>
            {error.kind === 'unavailable' ? '⚠' : '✕'}
          </div>
          <h3 className={styles.errorTitle}>{error.title}</h3>
          <p className={styles.errorMsg}>{error.message}</p>
          {diagLine && (
            <p style={{ fontSize: '11px', opacity: 0.65, margin: '4px 0 8px', fontFamily: 'monospace' }}>
              {diagLine}
            </p>
          )}
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
