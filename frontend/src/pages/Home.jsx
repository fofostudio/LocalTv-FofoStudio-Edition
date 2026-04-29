import { useContext, useState, useEffect } from 'react';
import { ChannelContext } from '../context/ChannelContext';
import VideoPlayer from '../components/VideoPlayer/VideoPlayer';
import SidebarWithTabs from '../components/SidebarWithTabs/SidebarWithTabs';
import ChannelInfo from '../components/ChannelInfo/ChannelInfo';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import ChannelList from '../components/ChannelList/ChannelList';
import styles from './Home.module.css';

const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(hd|sd|4k|fhd|uhd)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

function findMatchingChannel(streamName, channels) {
  if (!streamName || !channels?.length) return null;
  const target = normalize(streamName);
  if (!target) return null;

  // 1. Coincidencia exacta tras normalizar
  const exact = channels.find(
    (ch) => normalize(ch.name) === target || normalize(ch.slug) === target
  );
  if (exact) return exact;

  // 2. Una contiene a la otra (en cualquier dirección)
  const contains = channels.find((ch) => {
    const n = normalize(ch.name);
    const s = normalize(ch.slug);
    return (
      (n && (n.includes(target) || target.includes(n))) ||
      (s && (s.includes(target) || target.includes(s)))
    );
  });
  return contains || null;
}

export default function Home() {
  const { currentChannel, loading, error, channels, setCurrentChannel } = useContext(ChannelContext);
  const [streamFeedback, setStreamFeedback] = useState(null);

  useEffect(() => {
    if (!streamFeedback) return;
    const t = setTimeout(() => setStreamFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [streamFeedback]);

  const handleStreamClick = (streamName) => {
    const matched = findMatchingChannel(streamName, channels);
    if (matched) {
      setCurrentChannel(matched);
      setStreamFeedback({ type: 'ok', text: `Cargando ${matched.name}` });
    } else {
      setStreamFeedback({
        type: 'warn',
        text: `No hay canal local para "${streamName}"`,
      });
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.home}>
      {/* Layout desktop: player 70% + sidebar 30% */}
      <div className={styles.mainContent}>
        <div className={styles.playerSection}>
          {currentChannel && (
            <h2 className={styles.channelTitle}>{currentChannel.name}</h2>
          )}
          <div className={styles.videoContainer}>
            <VideoPlayer channel={currentChannel} />
          </div>
          {currentChannel && (
            <p className={styles.liveStatus}>
              {currentChannel.is_active ? '🔴 EN VIVO' : '⚪ Offline'}
            </p>
          )}
        </div>
        <SidebarWithTabs onStreamClick={handleStreamClick} />
      </div>

      {/* Mobile: mostrar ChannelList debajo */}
      <div className={styles.mobileList}>
        <ChannelList />
      </div>

      {streamFeedback && (
        <div
          className={`${styles.toast} ${
            streamFeedback.type === 'ok' ? styles.toastOk : styles.toastWarn
          }`}
          role="status"
        >
          {streamFeedback.text}
        </div>
      )}
    </div>
  );
}
