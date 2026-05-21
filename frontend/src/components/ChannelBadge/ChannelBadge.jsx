import { memo, useState } from 'react';
import { getLogoFor } from '../../utils/channelLogos';
import { channelCode, channelHue } from '../../utils/channelDisplay';

/**
 * Insignia de canal: usa el logo original (getLogoFor) cuando existe y cae
 * a un cuadro de color con el código del canal si no hay logo o falla la carga.
 */
function ChannelBadge({ ch, size = 28, radius = 6 }) {
  const [failed, setFailed] = useState(false);
  const logo = getLogoFor(ch);

  if (logo && !failed) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: '#f4f5f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <img
          src={logo}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '82%', height: '82%', objectFit: 'contain', display: 'block' }}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: channelHue(ch),
        color: '#fff',
        fontWeight: 800,
        letterSpacing: 0.4,
        fontSize: size * 0.32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {channelCode(ch)}
    </span>
  );
}

export default memo(ChannelBadge);
