import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import VideoPlayer from '../components/VideoPlayer/VideoPlayer';
import SidebarWithTabs from '../components/SidebarWithTabs/SidebarWithTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import styles from './Home.module.css';

export default function ChannelPage() {
  const { channelId } = useParams();
  const { channels, setCurrentChannel, loading: contextLoading } = useContext(ChannelContext);
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState(null);

  const handleStreamClick = (streamName) => {
    const matched = channels.find(
      (ch) =>
        streamName.toLowerCase().includes(ch.name.toLowerCase()) ||
        ch.name.toLowerCase().includes(streamName.toLowerCase())
    );
    if (matched) setCurrentChannel(matched);
  };

  useEffect(() => {
    if (contextLoading) return;
    const found = channels.find((ch) => ch.id === parseInt(channelId, 10));
    if (found) {
      setChannel(found);
      setCurrentChannel(found);
      setError(null);
    } else {
      setError(`Canal ${channelId} no encontrado`);
    }
  }, [channelId, channels, contextLoading, setCurrentChannel]);

  if (contextLoading) return <LoadingSpinner />;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (!channel) return <LoadingSpinner />;

  return (
    <div className={styles.home}>
      <div className={styles.mainContent}>
        <section className={styles.playerSection}>
          <div className={styles.playerCard}>
            <div className={styles.playerHeader}>
              <h2 className={styles.channelTitle}>{channel.name}</h2>
              <span className={`${styles.liveStatus} ${channel.is_active ? styles.liveOn : styles.liveOff}`}>
                <span className={styles.liveDot} />
                {channel.is_active ? 'EN VIVO' : 'OFFLINE'}
              </span>
            </div>
            <div className={styles.videoContainer}>
              <VideoPlayer channel={channel} />
            </div>
          </div>
        </section>
        <SidebarWithTabs onStreamClick={handleStreamClick} />
      </div>
    </div>
  );
}
