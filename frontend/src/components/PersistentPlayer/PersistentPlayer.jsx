import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChannelContext } from '../../context/ChannelContext';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
import { IconClose, IconFullscreen } from '../icons/Icons';
import styles from './PersistentPlayer.module.css';

export const PLAYER_SLOT_ID = 'lt-player-slot';
const MOBILE_Q = '(max-width: 860px)';

/**
 * Player único montado a nivel app. Mientras exista un canal seleccionado el
 * <video> nunca se desmonta, así la reproducción no se corta al navegar.
 *
 * - En Home (/): se posiciona (position:fixed) exactamente sobre el slot
 *   #lt-player-slot que reserva el espacio en el layout.
 * - En otras páginas (desktop): queda como mini-player flotante abajo a la
 *   derecha y sigue reproduciendo.
 * - En móvil: solo se muestra en Home; al navegar fuera se desmonta (no
 *   floating en pantallas chicas).
 */
export default function PersistentPlayer() {
  const { currentChannel } = useContext(ChannelContext);
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';

  const [rect, setRect] = useState(null);
  const [closed, setClosed] = useState(false);
  const rafRef = useRef(0);

  // Al volver a Home o cambiar de canal, reabrir el flotante si estaba cerrado.
  useEffect(() => { setClosed(false); }, [isHome, currentChannel?.id]);

  const measure = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const slot = document.getElementById(PLAYER_SLOT_ID);
      if (!slot) { setRect(null); return; }
      const r = slot.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    });
  }, []);

  useEffect(() => {
    if (!isHome) { setRect(null); return; }
    measure();
    const slot = document.getElementById(PLAYER_SLOT_ID);
    const ro = slot ? new ResizeObserver(measure) : null;
    if (ro && slot) ro.observe(slot);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const t = setTimeout(measure, 60);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearTimeout(t);
    };
  }, [isHome, measure, location.pathname]);

  if (!currentChannel) return null;
  // Tanto en desktop como en móvil mantenemos el player flotante (PiP) al
  // navegar fuera de Home, salvo que el usuario lo cierre.
  if (!isHome && closed) return null;

  const docked = isHome && !!rect;
  const floating = !isHome;

  let className = styles.wrap;
  let style;
  if (docked) {
    className += ` ${styles.docked}`;
    style = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  } else if (floating) {
    className += ` ${styles.floating}`;
  } else {
    className += ` ${styles.pending}`; // Home, midiendo el slot
  }

  return (
    <div className={className} style={style}>
      <div className={styles.video}>
        <VideoPlayer channel={currentChannel} />
      </div>

      {docked && (
        <div className={styles.dockOverlay}>
          <span className={styles.liveChip}><span className={styles.liveDot} /> EN VIVO</span>
          <span className={styles.name}>{currentChannel.name}</span>
        </div>
      )}

      {floating && (
        <div className={styles.floatBar}>
          <span className={styles.floatName}>
            <span className={styles.liveDot} /> {currentChannel.name}
          </span>
          <span className={styles.floatActions}>
            <button
              type="button"
              className={styles.floatBtn}
              onClick={() => navigate('/')}
              title="Volver al reproductor"
            >
              <IconFullscreen size={14} color="currentColor" />
            </button>
            <button
              type="button"
              className={styles.floatBtn}
              onClick={() => setClosed(true)}
              title="Cerrar"
            >
              <IconClose size={14} color="currentColor" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
