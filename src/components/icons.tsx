import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

// ── Playback ──────────────────────────────────────────────────────────────────

export function IconPlay({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="5" y1="4" x2="5" y2="20" strokeWidth="1.5" strokeOpacity="0.45" />
      <polygon points="8,4 8,20 21,12" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

export function IconNextFrame({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="7" y1="5" x2="7" y2="19" strokeWidth="2" />
      <line x1="10" y1="12" x2="19" y2="12" strokeWidth="2" />
      <polyline points="14,8 19,12 14,16" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

export function IconPrevFrame({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="17" y1="5" x2="17" y2="19" strokeWidth="2" />
      <line x1="14" y1="12" x2="5" y2="12" strokeWidth="2" />
      <polyline points="10,8 5,12 10,16" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

// ── Markers ───────────────────────────────────────────────────────────────────

export function IconCreateMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="17" x2="21" y2="17" strokeWidth="1.5" strokeOpacity="0.35" />
      <line x1="12" y1="5" x2="12" y2="11" strokeWidth="1.5" />
      <line x1="9" y1="8" x2="15" y2="8" strokeWidth="1.5" />
      <circle cx="12" cy="17" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconNextMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="17" x2="21" y2="17" strokeWidth="1.5" strokeOpacity="0.35" />
      <circle cx="19" cy="17" r="2.5" fill="currentColor" stroke="none" />
      <line x1="3" y1="11" x2="13" y2="11" strokeWidth="2" />
      <polyline points="9,7 14,11 9,15" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

export function IconPrevMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="17" x2="21" y2="17" strokeWidth="1.5" strokeOpacity="0.35" />
      <circle cx="5" cy="17" r="2.5" fill="currentColor" stroke="none" />
      <line x1="21" y1="11" x2="11" y2="11" strokeWidth="2" />
      <polyline points="15,7 10,11 15,15" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

// ── Regions ───────────────────────────────────────────────────────────────────

/** [ ] with fill hint — bracket caps face inward */
export function IconCreateRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="8" y="6" width="8" height="12" fill="currentColor" fillOpacity="0.09" stroke="none" />
      {/* left bracket [ — bar on left, caps go right */}
      <path d="M7,5 L10,5 M7,5 L7,19 M7,19 L10,19" strokeWidth="2" strokeLinejoin="miter" />
      {/* right bracket ] — bar on right, caps go left */}
      <path d="M17,5 L14,5 M17,5 L17,19 M17,19 L14,19" strokeWidth="2" strokeLinejoin="miter" />
      <line x1="9" y1="12" x2="15" y2="12" strokeWidth="1.5" strokeDasharray="2,2" strokeOpacity="0.6" />
    </svg>
  );
}

/** [ with down arrow — set region start at playhead */
export function IconSetRegionStart({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="19" x2="21" y2="19" strokeWidth="1.5" strokeOpacity="0.35" />
      {/* left bracket [ open-bottom (merges with baseline) */}
      <path d="M8,4 L11,4 M8,4 L8,19" strokeWidth="2" strokeLinejoin="miter" />
      {/* down arrow — place/set */}
      <line x1="16" y1="4" x2="16" y2="15" strokeWidth="2" />
      <polyline points="13,11 16,15 19,11" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

/** ] with down arrow — set region end at playhead */
export function IconSetRegionEnd({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="19" x2="21" y2="19" strokeWidth="1.5" strokeOpacity="0.35" />
      {/* right bracket ] open-bottom */}
      <path d="M16,4 L13,4 M16,4 L16,19" strokeWidth="2" strokeLinejoin="miter" />
      {/* down arrow — place/set */}
      <line x1="8" y1="4" x2="8" y2="15" strokeWidth="2" />
      <polyline points="5,11 8,15 11,11" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

/** arrow → [ — jump to region start */
export function IconGoToRegionStart({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      {/* full left bracket [ */}
      <path d="M7,4 L10,4 M7,4 L7,20 M7,20 L10,20" strokeWidth="2" strokeLinejoin="miter" />
      <line x1="21" y1="12" x2="11" y2="12" strokeWidth="2" />
      <polyline points="15,8 10,12 15,16" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

/** [ → ] — jump to region end */
export function IconGoToRegionEnd({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      {/* full right bracket ] */}
      <path d="M17,4 L14,4 M17,4 L17,20 M17,20 L14,20" strokeWidth="2" strokeLinejoin="miter" />
      <line x1="3" y1="12" x2="13" y2="12" strokeWidth="2" />
      <polyline points="9,8 14,12 9,16" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

/** ← [ — go to previous region */
export function IconPrevRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="17" x2="21" y2="17" strokeWidth="1.5" strokeOpacity="0.35" />
      <path d="M7,6 L10,6 M7,6 L7,17" strokeWidth="2" strokeLinejoin="miter" />
      <line x1="21" y1="11" x2="11" y2="11" strokeWidth="2" />
      <polyline points="15,7 10,11 15,15" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}

/** ] → — go to next region */
export function IconNextRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="17" x2="21" y2="17" strokeWidth="1.5" strokeOpacity="0.35" />
      <path d="M17,6 L14,6 M17,6 L17,17" strokeWidth="2" strokeLinejoin="miter" />
      <line x1="3" y1="11" x2="13" y2="11" strokeWidth="2" />
      <polyline points="9,7 14,11 9,15" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  );
}
