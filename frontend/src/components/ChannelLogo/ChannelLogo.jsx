import { memo, useEffect, useState } from 'react';
import { getLogoFor } from '../../utils/channelLogos';
import { channelCode, channelHue } from '../../utils/channelDisplay';
import { isLite } from '../../utils/device';
import styles from './ChannelLogo.module.css';

// Cache de tono por URL de logo para no re-muestrear el canvas cada render.
const toneCache = new Map(); // src -> 'dark' | 'light'

/**
 * Logo de canal mostrado sin caja: usa el PNG/SVG original con fondo
 * transparente. Detecta si el logo es predominantemente oscuro o claro
 * (muestreo de luminancia en canvas) para ponerle un respaldo adaptativo:
 *   - logo oscuro  -> chip claro translúcido (si no, se perdería en el panel)
 *   - logo claro   -> sin fondo (transparente)
 * Si no hay logo o falla, cae al cuadro de color con el código del canal.
 */
function ChannelLogo({ ch, size = 40, radius = 12 }) {
  const logo = getLogoFor(ch);
  const lite = isLite();
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState(() => (logo ? toneCache.get(logo) || null : null));

  useEffect(() => {
    // En modo ligero (TV) no muestreamos el canvas: es caro. Usamos un
    // respaldo claro fijo para que cualquier logo se vea sí o sí.
    if (!logo || lite) return;
    if (toneCache.has(logo)) { setTone(toneCache.get(logo)); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let t = 'light';
      try {
        const c = document.createElement('canvas');
        const w = 24, h = 24;
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let lum = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 40) continue; // ignorar transparencia
          lum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
        const avg = n ? lum / n : 255;
        t = avg < 130 ? 'dark' : 'light';
      } catch {
        t = 'light';
      }
      toneCache.set(logo, t);
      if (!cancelled) setTone(t);
    };
    img.onerror = () => { if (!cancelled) setFailed(true); };
    img.src = logo;
    return () => { cancelled = true; };
  }, [logo, lite]);

  if (!logo || failed) {
    return (
      <span
        className={styles.fallback}
        style={{ width: size, height: size, borderRadius: radius, background: channelHue(ch), fontSize: size * 0.32 }}
      >
        {channelCode(ch)}
      </span>
    );
  }

  return (
    <span
      className={styles.wrap}
      data-tone={lite ? 'dark' : (tone || 'pending')}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={logo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={styles.img}
      />
    </span>
  );
}

export default memo(ChannelLogo);
