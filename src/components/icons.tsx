import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

// ── Playback ──────────────────────────────────────────────────────────────────

export function IconPlay({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeLinejoin="round" {...props}>
      <polygon points="7,5 7,19 19.5,12" strokeWidth="1.5" />
    </svg>
  );
}

export function IconPause({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.4" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.4" />
    </svg>
  );
}

export function IconNextFrame({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="7" y1="6" x2="7" y2="18" />
      <polyline points="11,7 17,12 11,17" />
      <line x1="10" y1="12" x2="16.5" y2="12" strokeOpacity="0.45" strokeWidth="1.5" />
    </svg>
  );
}

export function IconPrevFrame({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="17" y1="6" x2="17" y2="18" />
      <polyline points="13,7 7,12 13,17" />
      <line x1="14" y1="12" x2="7.5" y2="12" strokeOpacity="0.45" strokeWidth="1.5" />
    </svg>
  );
}

// ── Markers ───────────────────────────────────────────────────────────────────

export function IconCreateMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="6" x2="21" y2="6" strokeWidth="1.5" strokeOpacity="0.35" />
      <polygon points="12,17 7.5,7.5 16.5,7.5" fill="currentColor" />
      <line x1="18.5" y1="14" x2="22" y2="14" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20.25" y1="12.25" x2="20.25" y2="15.75" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPrevMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="6" x2="21" y2="6" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <polygon points="6,15 2.5,7.5 9.5,7.5" fill="currentColor" />
      <polyline points="17,9 14,12 17,15" />
    </svg>
  );
}

export function IconNextMarker({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="6" x2="21" y2="6" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <polygon points="18,15 14.5,7.5 21.5,7.5" fill="currentColor" />
      <polyline points="7,9 10,12 7,15" />
    </svg>
  );
}

// ── Regions ───────────────────────────────────────────────────────────────────

export function IconCreateRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" fillOpacity="0.14" stroke="none" />
      <path d="M6,7 L6,17 M6,6 L9,6 M6,18 L9,18" />
      <path d="M18,7 L18,17 M18,6 L15,6 M18,18 L15,18" />
      <line x1="10" y1="12" x2="14" y2="12" strokeWidth="1.5" />
      <line x1="12" y1="10" x2="12" y2="14" strokeWidth="1.5" />
    </svg>
  );
}

export function IconSetRegionStart({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <path d="M7,5 L7,20 M7,5 L11,5" />
      <line x1="16" y1="5" x2="16" y2="14" />
      <polyline points="12.5,11 16,14.5 19.5,11" />
    </svg>
  );
}

export function IconSetRegionEnd({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <path d="M17,5 L17,20 M17,5 L13,5" />
      <line x1="8" y1="5" x2="8" y2="14" />
      <polyline points="4.5,11 8,14.5 11.5,11" />
    </svg>
  );
}

export function IconGoToRegionStart({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7,5 L7,19 M7,5 L11,5 M7,19 L11,19" />
      <polyline points="15,9 12,12 15,15" />
    </svg>
  );
}

export function IconGoToRegionEnd({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17,5 L17,19 M17,5 L13,5 M17,19 L13,19" />
      <polyline points="9,9 12,12 9,15" />
    </svg>
  );
}

export function IconPrevRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <rect x="2" y="7" width="8" height="10" rx="1" fill="currentColor" fillOpacity="0.16" stroke="none" />
      <path d="M2,7 L2,17 M2,7 L4,7 M2,17 L4,17" />
      <path d="M10,7 L10,17 M10,7 L8,7 M10,17 L8,17" />
      <polyline points="17,9 14,12 17,15" />
    </svg>
  );
}

export function IconNextRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <rect x="14" y="7" width="8" height="10" rx="1" fill="currentColor" fillOpacity="0.16" stroke="none" />
      <path d="M14,7 L14,17 M14,7 L16,7 M14,17 L16,17" />
      <path d="M22,7 L22,17 M22,7 L20,7 M22,17 L20,17" />
      <polyline points="7,9 10,12 7,15" />
    </svg>
  );
}

export function IconZoomToRegion({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="7" y="6" width="10" height="12" rx="1.5" fill="currentColor" fillOpacity="0.12" stroke="none" />
      <path d="M4,5 L4,19 M20,5 L20,19" />
      <polyline points="11,9 8,12 11,15" />
      <polyline points="13,9 16,12 13,15" />
    </svg>
  );
}

// ── Scenes ────────────────────────────────────────────────────────────────────

export function IconCreateScene({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" />
      <path d="M12,5 L16,12 L12,19 L8,12 Z" fill="currentColor" />
      <line x1="18.5" y1="7" x2="22" y2="7" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20.25" y1="5.25" x2="20.25" y2="8.75" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPrevScene({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <path d="M6,6 L10,12 L6,18 L2,12 Z" fill="currentColor" />
      <polyline points="17,9 14,12 17,15" />
    </svg>
  );
}

export function IconNextScene({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="20" x2="21" y2="20" strokeWidth="1.5" strokeOpacity="0.35" strokeLinecap="butt" />
      <path d="M18,6 L22,12 L18,18 L14,12 Z" fill="currentColor" />
      <polyline points="7,9 10,12 7,15" />
    </svg>
  );
}

// ── Playback loop modes ──────────────────────────────────────────────────────
//
// Three modes for what playback does at the end of a clip / video. Used by
// the split-toggle in the bottom toolbar's center cluster.

/** Stop: pause at the boundary. Stop-square + tiny "end" tick. */
export function IconLoopStop({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}

/** Loop: arrow circling back from end to start. */
export function IconLoopRepeat({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5,9 a5,5 0 0 1 5,-5 L17,4" />
      <polyline points="14,1 17,4 14,7" />
      <path d="M19,15 a5,5 0 0 1 -5,5 L7,20" />
      <polyline points="10,23 7,20 10,17" />
    </svg>
  );
}

/** Continue: arrow rolling forward past the boundary. */
export function IconLoopContinue({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="12" x2="18" y2="12" />
      <polyline points="14,7 19,12 14,17" />
    </svg>
  );
}

// ── Locks ─────────────────────────────────────────────────────────────────────

export function IconLockClosed({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="1.5" fill="currentColor" fillOpacity="0.14" />
      <path d="M8,11 L8,7 a4,4 0 0 1 8,0 L16,11" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLockOpen({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="1.5" fill="currentColor" fillOpacity="0.10" />
      <path d="M8,11 L8,7 a4,4 0 0 1 7.5,-2" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── App chrome ────────────────────────────────────────────────────────────────

export function IconSettings({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="2.7" fill="currentColor" fillOpacity="0.2" />
      <path d="M12 3 L12 5.5 M12 18.5 L12 21 M3 12 L5.5 12 M18.5 12 L21 12 M5.6 5.6 L7.4 7.4 M16.6 16.6 L18.4 18.4 M5.6 18.4 L7.4 16.6 M16.6 7.4 L18.4 5.6" />
    </svg>
  );
}

export function IconDropVideo({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="11" rx="1.5" fill="currentColor" fillOpacity="0.12" strokeDasharray="3 3" />
      <line x1="3" y1="20" x2="21" y2="20" strokeOpacity="0.45" />
      <line x1="12" y1="6" x2="12" y2="12" />
      <polyline points="9,9 12,12 15,9" />
    </svg>
  );
}

export function IconDeselect({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8" strokeOpacity="0.85" />
      <line x1="8" y1="8" x2="16" y2="16" />
      <line x1="16" y1="8" x2="8" y2="16" />
    </svg>
  );
}

export function IconTrash({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5,7 L19,7" />
      <path d="M10,7 L10,5 a1,1 0 0 1 1,-1 L13,4 a1,1 0 0 1 1,1 L14,7" />
      <path d="M6.5,7 L7.5,19.5 a1.5,1.5 0 0 0 1.5,1.5 L15,21 a1.5,1.5 0 0 0 1.5,-1.5 L17.5,7" fill="currentColor" fillOpacity="0.1" />
      <line x1="10" y1="11" x2="10" y2="17" strokeWidth="1.5" strokeOpacity="0.55" />
      <line x1="14" y1="11" x2="14" y2="17" strokeWidth="1.5" strokeOpacity="0.55" />
    </svg>
  );
}

// ── Thin timeline toolbar (16×16 viewBox) ─────────────────────────────────────

export function IconWarpToggle({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M1.5 5 Q4 1.5 6.5 5 T11.5 5 T15 5" strokeWidth="1.5" />
      <path d="M1.5 11 Q4 7.5 6.5 11 T11.5 11 T15 11" strokeWidth="1.5" strokeOpacity="0.5" />
    </svg>
  );
}

export function IconAlwaysAnchors({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" {...props}>
      <line x1="8" y1="1.5" x2="8" y2="14.5" strokeWidth="1.2" strokeDasharray="1.5 1.5" strokeOpacity="0.55" />
      <polygon points="8,6.2 5.5,2.5 10.5,2.5" fill="currentColor" />
    </svg>
  );
}

export function IconAlwaysRegions({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" {...props}>
      <line x1="3" y1="1.5" x2="3" y2="14.5" strokeWidth="1.2" strokeDasharray="1.5 1.5" strokeOpacity="0.55" />
      <line x1="13" y1="1.5" x2="13" y2="14.5" strokeWidth="1.2" strokeDasharray="1.5 1.5" strokeOpacity="0.55" />
      <rect x="3" y="6" width="10" height="4" rx="0.8" fill="currentColor" fillOpacity="0.2" strokeWidth="1.5" />
    </svg>
  );
}

export function IconAlwaysScenes({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" {...props}>
      <line x1="8" y1="1.5" x2="8" y2="14.5" strokeWidth="1.2" strokeDasharray="1.5 1.5" strokeOpacity="0.55" />
      <path d="M8 4.5 L11 8 L8 11.5 L5 8 Z" fill="currentColor" />
    </svg>
  );
}

export function IconThumbStrip({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" {...props}>
      <rect x="1" y="3.5" width="14" height="9" rx="0.8" strokeWidth="1.2" />
      <line x1="1" y1="6" x2="15" y2="6" strokeWidth="0.9" />
      <line x1="1" y1="10" x2="15" y2="10" strokeWidth="0.9" />
      <line x1="5" y1="3.5" x2="5" y2="12.5" strokeWidth="0.9" strokeOpacity="0.6" />
      <line x1="11" y1="3.5" x2="11" y2="12.5" strokeWidth="0.9" strokeOpacity="0.6" />
    </svg>
  );
}

export function IconQueueDebug({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" strokeWidth="1.2" />
      <line x1="4" y1="5.5" x2="11" y2="5.5" strokeWidth="1" />
      <line x1="4" y1="8" x2="9" y2="8" strokeWidth="1" />
      <line x1="4" y1="10.5" x2="7" y2="10.5" strokeWidth="1" />
      <circle cx="11" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconFollowDrag({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" {...props}>
      <line x1="8" y1="1.5" x2="8" y2="6" strokeWidth="1.2" />
      <line x1="8" y1="10" x2="8" y2="14.5" strokeWidth="1.2" />
      <line x1="1.5" y1="8" x2="6" y2="8" strokeWidth="1.2" />
      <line x1="10" y1="8" x2="14.5" y2="8" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
