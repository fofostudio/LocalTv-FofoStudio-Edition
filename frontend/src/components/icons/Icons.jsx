// Icon set ported from the LocalTv design bundle.
// stroke-based, 20x20 viewBox, currentColor by default.

function Icon({ children, size = 20, color, stroke = 1.7, fill = 'none', style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={fill}
      stroke={color || 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconHome = (p) => <Icon {...p}><path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1h-3v-5H9v5H4a1 1 0 01-1-1V9.5z" /></Icon>;
export const IconLive = (p) => <Icon {...p}><circle cx="10" cy="10" r="2" /><path d="M6.5 13.5a5 5 0 010-7M13.5 6.5a5 5 0 010 7M3.5 16.5a9 9 0 010-13M16.5 3.5a9 9 0 010 13" /></Icon>;
export const IconTv = (p) => <Icon {...p}><rect x="2" y="5" width="16" height="11" rx="2" /><path d="M7 2l3 3 3-3" /></Icon>;
export const IconUser = (p) => <Icon {...p}><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17a6.5 6.5 0 0113 0" /></Icon>;
export const IconSearch = (p) => <Icon {...p}><circle cx="9" cy="9" r="5.5" /><path d="M13 13l4 4" /></Icon>;
export const IconCalendar = (p) => <Icon {...p}><rect x="3" y="4.5" width="14" height="13" rx="2" /><path d="M7 3v3M13 3v3M3 9h14" /></Icon>;
export const IconStar = (p) => <Icon {...p}><path d="M10 2.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.9 5.2 17.4l.9-5.4L2.2 8.2l5.4-.8L10 2.5z" /></Icon>;
export const IconHistory = (p) => <Icon {...p}><path d="M3 10a7 7 0 117 7" /><path d="M3 5v5h5" /><path d="M10 7v3l2 2" /></Icon>;
export const IconSettings = (p) => <Icon {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 2v1.8M10 16.2V18M16 10h1.8M2.2 10H4M14.2 5.8L15.5 4.5M4.5 15.5l1.3-1.3M14.2 14.2l1.3 1.3M4.5 4.5l1.3 1.3" /></Icon>;
export const IconCast = (p) => <Icon {...p}><path d="M3 7V5a1 1 0 011-1h12a1 1 0 011 1v10a1 1 0 01-1 1h-5" /><path d="M3 11a5 5 0 015 5M3 14a2 2 0 012 2" /><circle cx="3.5" cy="16.5" r="0.5" fill="currentColor" /></Icon>;
export const IconStats = (p) => <Icon {...p}><path d="M3 17V8M8 17V4M13 17v-6M18 17v-9" /></Icon>;
export const IconPlay = (p) => <Icon {...p} fill="currentColor" stroke="none"><path d="M5 3v14l12-7z" /></Icon>;
export const IconBack = (p) => <Icon {...p}><path d="M12 4l-6 6 6 6" /></Icon>;
export const IconClose = (p) => <Icon {...p}><path d="M5 5l10 10M15 5L5 15" /></Icon>;
export const IconHeart = (p) => <Icon {...p}><path d="M10 17S3 12.5 3 7.5A3.5 3.5 0 0110 5a3.5 3.5 0 017 2.5C17 12.5 10 17 10 17z" /></Icon>;
export const IconShare = (p) => <Icon {...p}><path d="M10 3v10M10 3l-3 3M10 3l3 3M4 11v5a1 1 0 001 1h10a1 1 0 001-1v-5" /></Icon>;
export const IconGrid = (p) => <Icon {...p}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></Icon>;
export const IconBell = (p) => <Icon {...p}><path d="M5 8a5 5 0 0110 0c0 4 2 5 2 5H3s2-1 2-5z" /><path d="M8.5 16a2 2 0 003 0" /></Icon>;
export const IconFullscreen = (p) => <Icon {...p}><path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4" /></Icon>;
export const IconMore = (p) => <Icon {...p} fill="currentColor" stroke="none"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></Icon>;
export const IconCheck = (p) => <Icon {...p}><path d="M4 10l4 4 8-8" /></Icon>;
export const IconBolt = (p) => <Icon {...p} fill="currentColor" stroke="none"><path d="M11 1L3 11h5l-1 8 8-10h-5l1-8z" /></Icon>;
export const IconRefresh = (p) => <Icon {...p}><path d="M16 6a7 7 0 101.5 4.5" /><path d="M17 3v4h-4" /></Icon>;
