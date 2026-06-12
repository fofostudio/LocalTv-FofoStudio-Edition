import { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import ChannelBadge from '../ChannelBadge/ChannelBadge';
import { regionLabel } from '../../utils/channelDisplay';
import { IconClose, IconTv } from '../icons/Icons';
import styles from './ChannelZapper.module.css';

/**
 * Overlay de cambio de canal SOBRE el reproductor activo (modo inmersivo).
 * Reusa el mismo <video> del PersistentPlayer (que pasa a pantalla completa),
 * así cambiar de canal NO corta la reproducción ni sale del player.
 *
 * Entradas:
 *  - TV / teclado (D-pad): ← canal previo · → siguiente · ↑/abrir lista ·
 *    ↑/↓ navegan la lista (foco) · Enter elige · Esc/Backspace cierra/sale.
 *  - Celular (touch): swipe ←/→ zapea · swipe ↑ abre la lista · tap muestra/oculta
 *    la barra · botones grandes.
 */
export default function ChannelZapper() {
  const {
    immersive, exitImmersive, zap, currentChannel,
    setCurrentChannel, filteredChannels, isLive,
  } = useContext(ChannelContext);

  const [barVisible, setBarVisible] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const hideTimer = useRef(0);
  const touch = useRef(null);
  const listRef = useRef(null);

  // Muestra la barra y la auto-oculta tras inactividad (estilo TV en vivo).
  const poke = useCallback(() => {
    setBarVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), 4200);
  }, []);

  useEffect(() => {
    if (immersive) { poke(); }
    return () => clearTimeout(hideTimer.current);
  }, [immersive, poke]);

  // Bloquea el scroll del fondo mientras el overlay está activo.
  useEffect(() => {
    if (!immersive) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [immersive]);

  // Teclado / control remoto.
  useEffect(() => {
    if (!immersive) return undefined;
    const onKey = (e) => {
      poke();
      switch (e.key) {
        case 'ArrowLeft':
          if (!listOpen) { zap(-1); e.preventDefault(); }
          break;
        case 'ArrowRight':
          if (!listOpen) { zap(1); e.preventDefault(); }
          break;
        case 'ArrowUp':
          if (!listOpen) { setListOpen(true); e.preventDefault(); }
          break;
        case 'Escape':
        case 'Backspace':
          if (listOpen) setListOpen(false); else exitImmersive();
          e.preventDefault();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [immersive, listOpen, zap, exitImmersive, poke]);

  // Al abrir la lista, enfoca el canal actual (para navegar con D-pad).
  useEffect(() => {
    if (!listOpen) return;
    const el = listRef.current?.querySelector('[data-current="1"]')
      || listRef.current?.querySelector('button');
    el?.focus();
  }, [listOpen]);

  if (!immersive || !currentChannel) return null;

  const pick = (ch) => { setCurrentChannel(ch); setListOpen(false); poke(); };

  // Gestos touch (celular).
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    // Tap sobre un botón: que lo maneje el botón, no togglear la barra ni zapear.
    if (e.target.closest('button')) { touch.current = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    const adx = Math.abs(dx); const ady = Math.abs(dy);
    if (adx < 16 && ady < 16) { setBarVisible((v) => !v); return; } // tap
    if (listOpen) return; // con la lista abierta, los gestos los maneja la lista
    if (adx > 50 && adx > ady) { zap(dx < 0 ? 1 : -1); poke(); return; } // ←/→
    if (dy < -50 && ady > adx) { setListOpen(true); } // swipe arriba → lista
  };

  return (
    <div
      className={styles.root}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseMove={poke}
    >
      {/* Barra superior: canal actual + acciones */}
      <div className={`${styles.topbar} ${barVisible || listOpen ? '' : styles.hidden}`}>
        <div className={styles.now}>
          <span className={styles.liveChip}><span className={styles.dot} /> EN VIVO</span>
          <span className={styles.nowName}>{currentChannel.name}</span>
          <span className={styles.nowTag}>{regionLabel(currentChannel.region)}</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.iconBtn} onClick={() => { zap(-1); poke(); }} title="Canal anterior (←)" aria-label="Canal anterior">‹</button>
          <button className={styles.iconBtn} onClick={() => { zap(1); poke(); }} title="Canal siguiente (→)" aria-label="Canal siguiente">›</button>
          <button className={styles.listBtn} onClick={() => setListOpen((o) => !o)} title="Lista de canales (↑)">
            <IconTv size={15} color="currentColor" /> Canales
          </button>
          <button className={styles.iconBtn} onClick={exitImmersive} title="Salir (Esc)" aria-label="Salir">
            <IconClose size={15} color="currentColor" />
          </button>
        </div>
      </div>

      {/* Ayuda inferior efímera */}
      {barVisible && !listOpen && (
        <div className={styles.hint}>‹ › cambian de canal · ↑ lista · Esc salir</div>
      )}

      {/* Drawer de canales (lista) */}
      <div className={`${styles.drawer} ${listOpen ? styles.drawerOpen : ''}`} ref={listRef}>
        <div className={styles.drawerHead}>
          <span className={styles.drawerTitle}>Canales</span>
          <button className={styles.iconBtn} onClick={() => setListOpen(false)} aria-label="Cerrar lista">
            <IconClose size={15} color="currentColor" />
          </button>
        </div>
        <div className={styles.drawerList}>
          {filteredChannels.map((ch) => {
            const active = ch.id === currentChannel.id;
            return (
              <button
                key={ch.id}
                data-current={active ? '1' : undefined}
                className={`${styles.chRow} ${active ? styles.chRowActive : ''}`}
                onClick={() => pick(ch)}
              >
                <ChannelBadge ch={ch} size={30} radius={7} />
                <span className={styles.chText}>
                  <span className={styles.chName}>{ch.name}</span>
                  <span className={styles.chTag}>{regionLabel(ch.region)}</span>
                </span>
                {isLive(ch.slug) && <span className={styles.liveMini} />}
              </button>
            );
          })}
          {!filteredChannels.length && <p className={styles.empty}>Sin canales.</p>}
        </div>
      </div>
      {listOpen && <div className={styles.scrim} onClick={() => setListOpen(false)} />}
    </div>
  );
}
