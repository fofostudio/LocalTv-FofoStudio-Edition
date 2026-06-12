import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChannelContext } from '../../context/ChannelContext';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
import { IconClose, IconFullscreen } from '../icons/Icons';
import ChannelZapper from '../ChannelZapper/ChannelZapper';
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
  const { currentChannel, vod, immersive, enterImmersive, nativePip, setNativePip } = useContext(ChannelContext);
  const location = useLocation();
  const isHome = location.pathname === '/';

  // Avisar a Android si hay un video activo (para entrar en PiP al salir de la app).
  useEffect(() => {
    const active = !!currentChannel && !vod;
    try { window.AndroidPip?.setPlaying?.(active); } catch (_) { /* web: no existe */ }
  }, [currentChannel, vod]);

  // Evento desde nativo: entró/salió de PiP del sistema → el video llena la ventana.
  useEffect(() => {
    const onPip = (e) => setNativePip(!!e.detail?.pip);
    window.addEventListener('ltpip', onPip);
    return () => window.removeEventListener('ltpip', onPip);
  }, [setNativePip]);

  const [rect, setRect] = useState(null);
  const [closed, setClosed] = useState(false);
  const rafRef = useRef(0);
  // Posición arrastrada del PiP flotante (null = esquina por defecto).
  const [pipPos, setPipPos] = useState(null);
  const dragRef = useRef(null);

  // Al volver a Home o cambiar de canal, reabrir el flotante si estaba cerrado.
  useEffect(() => { setClosed(false); }, [isHome, currentChannel?.id]);

  // Arrastre del PiP flotante (mouse + touch via Pointer Events). Se agarra del
  // cuerpo del mini-player (no de los botones). Mantiene el PiP dentro de la
  // pantalla.
  const onPipPointerDown = (e) => {
    if (e.target.closest('button')) return; // los botones hacen lo suyo
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - r.left, dy: e.clientY - r.top,
      w: r.width, h: r.height, moved: false,
    };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  const onPipPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    const pad = 6;
    const x = Math.min(Math.max(pad, e.clientX - d.dx), window.innerWidth - d.w - pad);
    const y = Math.min(Math.max(pad, e.clientY - d.dy), window.innerHeight - d.h - pad);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setPipPos({ x, y }));
  };
  const onPipPointerUp = (e) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };

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
  // Mientras hay una película/serie (VOD) en marcha —fullscreen o en PiP— ocultamos
  // el PiP del canal en vivo para que no se solapen y no suenen dos a la vez.
  if (vod) return null;
  // Tanto en desktop como en móvil mantenemos el player flotante (PiP) al
  // navegar fuera de Home, salvo que el usuario lo cierre. En inmersivo siempre
  // se muestra (pantalla completa).
  // En PiP nativo o inmersivo el video llena la ventana.
  const fillMode = immersive || nativePip;
  if (!fillMode && !isHome && closed) return null;

  const docked = !fillMode && isHome && !!rect;
  const floating = !fillMode && !isHome;

  let className = styles.wrap;
  let style;
  if (fillMode) {
    className += ` ${styles.immersive}`;
  } else if (docked) {
    className += ` ${styles.docked}`;
    style = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  } else if (floating) {
    className += ` ${styles.floating}`;
    if (pipPos) style = { left: pipPos.x, top: pipPos.y, right: 'auto', bottom: 'auto' };
  } else {
    className += ` ${styles.pending}`; // Home, midiendo el slot
  }

  // Handlers de arrastre solo en el PiP flotante.
  const dragProps = floating ? {
    onPointerDown: onPipPointerDown,
    onPointerMove: onPipPointerMove,
    onPointerUp: onPipPointerUp,
  } : {};

  return (
    <>
      <div className={className} style={style} {...dragProps}>
        <div className={styles.video}>
          <VideoPlayer channel={currentChannel} />
        </div>

        {docked && (
          <div className={styles.dockOverlay}>
            <span className={styles.liveChip}><span className={styles.liveDot} /> EN VIVO</span>
            <span className={styles.name}>{currentChannel.name}</span>
            <button
              type="button"
              className={styles.expandBtn}
              onClick={enterImmersive}
              title="Pantalla completa + cambiar de canal"
              aria-label="Pantalla completa"
            >
              <IconFullscreen size={15} color="currentColor" />
            </button>
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
                onClick={enterImmersive}
                title="Pantalla completa + cambiar de canal"
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

      {/* Overlay de zapping (solo visible en modo inmersivo) */}
      <ChannelZapper />
    </>
  );
}
