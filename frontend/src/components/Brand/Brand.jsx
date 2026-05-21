// LocalTv brand mark (orange square + bolt) and wordmark, ported from design.

export function LocalTvMark({ size = 30, radius = 8, bg = '#FF6B1A', color = '#fff' }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg width={size * 0.55} height={size * 0.65} viewBox="0 0 11 13" fill="none">
        <path d="M7 0L0 7.5h3.5L2.5 13 11 5.5H7L8.5 0H7z" fill={color} />
      </svg>
    </div>
  );
}

export function LocalTvWordmark({ size = 16, color = '#fff' }) {
  return (
    <span
      style={{
        fontFamily: 'Manrope, system-ui, sans-serif',
        fontWeight: 800,
        fontSize: size,
        letterSpacing: size * 0.01,
        color,
        lineHeight: 1,
      }}
    >
      Local<span style={{ color: '#FF6B1A' }}>Tv</span>
    </span>
  );
}
