import { useContext, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import { FavoritesContext } from '../context/FavoritesContext';
import VideoPlayer from '../components/VideoPlayer/VideoPlayer';
import SidebarWithTabs from '../components/SidebarWithTabs/SidebarWithTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import ChannelCard from '../components/ChannelCard/ChannelCard';
import styles from './Home.module.css';

const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(hd|sd|4k|fhd|uhd)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

function findMatchingChannel(streamName, channels) {
  if (!streamName || !channels?.length) return null;
  const target = normalize(streamName);
  if (!target) return null;
  const exact = channels.find(
    (ch) => normalize(ch.name) === target || normalize(ch.slug) === target
  );
  if (exact) return exact;
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
  const navigate = useNavigate();
  const {
    currentChannel, loading, error, channels, setCurrentChannel,
    filteredChannels, searchQuery, isLive,
  } = useContext(ChannelContext);
  const { favorites, toggleFavorite, isFavorite } = useContext(FavoritesContext);
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
      setStreamFeedback({ type: 'warn', text: `No hay canal local para "${streamName}"` });
    }
  };

  const favoriteChannels = useMemo(
    () => channels.filter((c) => favorites.includes(c.id)),
    [channels, favorites]
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.home}>
      <div className={styles.mainContent}>
        <section className={styles.playerSection}>
          <div className={styles.playerCard}>
            <div className={styles.playerHeader}>
              {currentChannel ? (
                <>
                  <h2 className={styles.channelTitle}>{currentChannel.name}</h2>
                  <span className={`${styles.liveStatus} ${isLive(currentChannel.slug) ? styles.liveOn : styles.liveOff}`}>
                    <span className={styles.liveDot} />
                    {isLive(currentChannel.slug) ? 'EN VIVO' : 'OFFLINE'}
                  </span>
                </>
              ) : (
                <h2 className={styles.channelTitle}>Selecciona un canal</h2>
              )}
            </div>
            <div className={styles.videoContainer}>
              <VideoPlayer channel={currentChannel} />
            </div>
          </div>

          {/* Filas Netflix-style debajo del player */}
          <div className={styles.rowsArea}>
            {searchQuery ? (
              <ChannelRow
                title={`Resultados (${filteredChannels.length})`}
                channels={filteredChannels}
                currentChannel={currentChannel}
                onSelect={(c) => setCurrentChannel(c)}
                isFavorite={isFavorite}
                toggleFavorite={toggleFavorite}
              />
            ) : (
              <>
                {favoriteChannels.length > 0 && (
                  <ChannelRow
                    title="Tus favoritos"
                    accent
                    channels={favoriteChannels}
                    currentChannel={currentChannel}
                    onSelect={(c) => setCurrentChannel(c)}
                    isFavorite={isFavorite}
                    toggleFavorite={toggleFavorite}
                  />
                )}
                <ChannelRow
                  title="Todos los canales"
                  channels={filteredChannels}
                  currentChannel={currentChannel}
                  onSelect={(c) => setCurrentChannel(c)}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                />
              </>
            )}
          </div>
        </section>

        <SidebarWithTabs onStreamClick={handleStreamClick} />
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

function ChannelRow({ title, channels, currentChannel, onSelect, isFavorite, toggleFavorite, accent = false }) {
  if (!channels.length) {
    return (
      <div className={styles.row}>
        <h3 className={`${styles.rowTitle} ${accent ? styles.rowTitleAccent : ''}`}>{title}</h3>
        <p className={styles.rowEmpty}>Sin canales para mostrar.</p>
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <h3 className={`${styles.rowTitle} ${accent ? styles.rowTitleAccent : ''}`}>
        {title} <span className={styles.rowCount}>{channels.length}</span>
      </h3>
      <div className={styles.rowGrid}>
        {channels.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            isSelected={currentChannel?.id === ch.id}
            onSelect={() => onSelect(ch)}
            isFavorite={isFavorite(ch.id)}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </div>
    </div>
  );
}
