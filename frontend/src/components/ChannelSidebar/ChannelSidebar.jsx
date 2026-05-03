import { useContext } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { FavoritesContext } from '../../context/FavoritesContext';
import ChannelCard from '../ChannelCard/ChannelCard';
import styles from './ChannelSidebar.module.css';

export default function ChannelSidebar() {
  const { channels, filteredChannels, currentChannel, setCurrentChannel } = useContext(ChannelContext);
  const { favorites, toggleFavorite, isFavorite } = useContext(FavoritesContext);

  const favoriteChannels = channels.filter((ch) => favorites.includes(ch.id));

  return (
    <div className={styles.sidebar}>
      {favoriteChannels.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>
            <span className={styles.icon}>★</span> Favoritos
            <span className={styles.count}>{favoriteChannels.length}</span>
          </h4>
          <div className={styles.list}>
            {favoriteChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                variant="list"
                isSelected={currentChannel?.id === channel.id}
                onSelect={() => setCurrentChannel(channel)}
                isFavorite={isFavorite(channel.id)}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          Todos los canales
          <span className={styles.count}>{filteredChannels.length}</span>
        </h4>
        <div className={styles.list}>
          {filteredChannels.length === 0 ? (
            <p className={styles.empty}>Sin resultados.</p>
          ) : filteredChannels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              variant="list"
              isSelected={currentChannel?.id === channel.id}
              onSelect={() => setCurrentChannel(channel)}
              isFavorite={isFavorite(channel.id)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
