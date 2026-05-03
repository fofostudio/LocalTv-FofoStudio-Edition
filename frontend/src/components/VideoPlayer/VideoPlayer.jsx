import { useContext, useEffect, useRef, useState } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import CastButton from '../CastButton/CastButton';
import styles from './VideoPlayer.module.css';

const BASE_URL = import.meta.env.VITE_API_URL || '';

function describeError(raw) {
  // hls.js wrapper events tienen este shape:
  // { raw: { type, details, response: { code, text }, ... } }
  const inner = raw?.raw || raw;
  const code = inner?.response?.code;
  const details = inner?.details;

  if (code === 502) {
    return {
      title: 'Canal no disponible ahora',
      message: 'El servidor de origen no tiene este canal activo en este momento.',
      kind: 'unavailable',
    };
  }
  if (details === 'manifestParsingError') {
    return {
      title: 'Stream corrupto',
      message: 'El manifest llegó vacío o malformado. Probá otro canal.',
      kind: 'unavailable',
    };
  }
  if (details === 'manifestLoadError') {
    return {
      title: 'No se pudo cargar el stream',
      message: 'Error de red al pedir el manifest.',
      kind: 'network',
    };
  }
  return {
    title: 'Error reproduciendo el canal',
    message: details ? `(${details})` : 'Probá otro canal.',
    kind: 'generic',
  };
}

export default function VideoPlayer({ channel }) {
  const { nextLiveChannel, setCurrentChannel } = useContext(ChannelContext);
  const playerRef = useRef(null);
  const clapprRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cleanup = () => {
      if (clapprRef.current) {
        try { clapprRef.current.destroy(); } catch (_) { /* ignore */ }
        clapprRef.current = null;
      }
      const div = document.getElementById('video-player');
      if (div) div.innerHTML = '';
    };
    cleanup();
    setError(null);

    if (!channel?.slug) return;

    if (!window.Clappr) {
      setError({ title: 'Player no disponible', message: 'Clappr no se cargó.', kind: 'generic' });
      return;
    }

    setLoading(true);

    const proxyUrl = `${BASE_URL}/api/streams/${channel.slug}/playlist.m3u8`;

    try {
      clapprRef.current = new window.Clappr.Player({
        source: proxyUrl,
        mimeType: 'application/x-mpegURL',
        parentId: '#video-player',
        width: '100%',
        height: '100%',
        autoPlay: true,
        mute: false,
        poster: channel.logo_url || '',
        events: {
          onReady: () => setLoading(false),
          onPlay:  () => { setLoading(false); setError(null); },
          onError: (e) => {
            console.error('Clappr error:', e);
            setError(describeError(e));
            setLoading(false);
          },
        },
        hlsjsConfig: {
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          manifestLoadingMaxRetry: 1,
          fragLoadingMaxRetry: 2,
        },
      });
    } catch (e) {
      console.error(e);
      setError({ title: 'Error al iniciar el player', message: e.message, kind: 'generic' });
      setLoading(false);
    }

    return cleanup;
  }, [channel?.slug, channel?.logo_url]);

  const tryNextLive = () => {
    const next = nextLiveChannel(channel?.slug);
    if (next) setCurrentChannel(next);
  };

  return (
    <div className={styles.playerWrapper}>
      <div id="video-player" ref={playerRef} className={styles.player} />
      {channel && (
        <div className={styles.controls}>
          <CastButton
            streamUrl={`${window.location.origin}${BASE_URL}/api/streams/${channel.slug}/playlist.m3u8`}
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
      {loading && channel && (
        <div className={styles.overlay}>
          <p>Cargando stream...</p>
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
          </div>
        </div>
      )}
    </div>
  );
}
