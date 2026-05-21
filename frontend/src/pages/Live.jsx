import { useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChannelContext } from '../context/ChannelContext';
import { useDiaryEvents } from '../hooks/useDiaryEvents';
import LtSidebar from '../components/LtSidebar/LtSidebar';
import LtMobileTabs from '../components/LtMobileTabs/LtMobileTabs';
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner';
import ChannelLogo from '../components/ChannelLogo/ChannelLogo';
import { LocalTvMark, LocalTvWordmark } from '../components/Brand/Brand';
import { IconPlay, IconLive } from '../components/icons/Icons';
import { channelHue } from '../utils/channelDisplay';
import shell from '../components/LtScreen/ltShell.module.css';
import styles from './Live.module.css';

export default function Live() {
  const { setCurrentChannel } = useContext(ChannelContext);
  const { events, loading } = useDiaryEvents();
  const navigate = useNavigate();

  const liveEvents = useMemo(() => events.filter((e) => e.status === 'live'), [events]);
  const big = liveEvents[0];
  const rest = liveEvents.slice(1);

  const channelOf = (ev) => ev.streams.find((s) => s.channel)?.channel || null;

  const play = (ev) => {
    const ch = channelOf(ev);
    if (ch) {
      setCurrentChannel(ch);
      navigate('/');
    }
  };

  const cardHue = (ev) => {
    const ch = channelOf(ev);
    return ch ? channelHue(ch) : '#1E7BFF';
  };

  return (
    <div className={shell.shell}>
      <LtSidebar />
      <div className={shell.content}>
        <div className={shell.mobileTop}>
          <LocalTvMark size={26} radius={7} />
          <LocalTvWordmark size={15} />
        </div>

        <div className={shell.header}>
          <div className={shell.headTop}>
            <h2 className={shell.title}>En vivo</h2>
            <span className={shell.titleBadge}>
              <span className={shell.titleBadgeDot} />
              {liveEvents.length} TRANSMISIONES
            </span>
          </div>
          <div className={shell.sub}>Eventos transmitiéndose ahora mismo · agenda en tiempo real</div>
        </div>

        <div className={shell.body}>
          {loading ? (
            <LoadingSpinner />
          ) : !liveEvents.length ? (
            <div className={shell.empty}>
              <IconLive size={32} color="rgba(255,255,255,0.25)" />
              <p>No hay eventos en vivo ahora mismo.</p>
            </div>
          ) : (
            <div className={styles.wrap}>
              {big && (() => {
                const ch = channelOf(big);
                return (
                  <button
                    type="button"
                    className={styles.featured}
                    style={{ background: `linear-gradient(135deg, #0846C2 0%, #1B6FD0 45%, ${cardHue(big)} 115%)` }}
                    onClick={() => play(big)}
                    disabled={!ch}
                  >
                    <div className={styles.featTop}>
                      <span className={styles.liveTag}><span className={styles.liveTagDot} /> EN VIVO</span>
                      {ch && (
                        <span className={styles.featCh}>
                          <ChannelLogo ch={ch} size={26} radius={8} />
                          {ch.name}
                        </span>
                      )}
                    </div>
                    <div className={styles.featBottom}>
                      <div className={styles.featComp}>{big.competition}</div>
                      <div className={styles.featTitle}>{big.title}</div>
                      <div className={styles.featMeta}>
                        <span className={styles.featMin}>{big.relTime}</span>
                        <span className={styles.featPlay}><IconPlay size={12} /> {ch ? 'Ver ahora' : 'Sin canal'}</span>
                      </div>
                    </div>
                  </button>
                );
              })()}

              {rest.length > 0 && (
                <div className={styles.cards}>
                  {rest.map((ev) => {
                    const ch = channelOf(ev);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className={styles.card}
                        onClick={() => play(ev)}
                        disabled={!ch}
                      >
                        <div className={styles.thumb} style={{ background: cardHue(ev) }}>
                          {ch ? (
                            <ChannelLogo ch={ch} size={54} radius={14} />
                          ) : (
                            <span className={styles.thumbComp}>{ev.competition}</span>
                          )}
                          <span className={styles.thumbLive}><span className={styles.liveTagDot} /> LIVE</span>
                        </div>
                        <div className={styles.cardBody}>
                          <div className={styles.cardTitle}>{ev.title}</div>
                          <div className={styles.cardMeta}>
                            <span className={styles.cardMin}>{ev.relTime}</span>
                            <span className={styles.cardCh}>{ev.competition}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <LtMobileTabs />
    </div>
  );
}
