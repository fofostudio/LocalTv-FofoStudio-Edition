// Navegación por control remoto (D-pad) para Smart TV.
//
// Los navegadores de TV traen "spatial navigation" nativa para elementos
// enfocables (botones, links), pero el foco suele quedar fuera de viewport o
// pegado al borde. Esto asegura que el elemento enfocado SIEMPRE se vea,
// centrándolo suavemente. Sólo se activa en modo lite (TV).

import { isLite } from './device';

let _installed = false;

export function initTvNav() {
  if (_installed || typeof document === 'undefined') return;
  if (!isLite()) return;
  _installed = true;

  let raf = 0;
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (!el || typeof el.scrollIntoView !== 'function') return;
      // Coalescemos a un rAF: el D-pad puede disparar varios focus seguidos.
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch {
          // TVs viejas: firma booleana
          try { el.scrollIntoView(false); } catch { /* ignore */ }
        }
      });
    },
    true,
  );
}
