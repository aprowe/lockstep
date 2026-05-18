import React from 'react';
import { LockstepMark } from './LockstepMark';

interface LockstepLogoProps {
  /** Height of the lockup in pixels. The mark and wordmark scale together. */
  size?: number;
  className?: string;
  /** When true, hides the wordmark and shows only the mark. */
  markOnly?: boolean;
}

/**
 * Full Lockstep logo lockup: mark + wordmark.
 *
 * @example
 * // Title bar (24px)
 * <LockstepLogo size={24} />
 *
 * // App header (32px)
 * <LockstepLogo size={32} />
 *
 * // Splash screen (large)
 * <LockstepLogo size={64} />
 */
export function LockstepLogo({ size = 28, className, markOnly }: LockstepLogoProps) {
  // Wordmark sized to feel balanced against the mark.
  // Mark is square; wordmark height ≈ mark height × 0.78 looks right.
  const fontSize = Math.round(size * 0.78);
  const gap = Math.max(6, Math.round(size * 0.32));

  if (markOnly) {
    return <LockstepMark size={size} className={className} />;
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${gap}px`,
        lineHeight: 1,
      }}
    >
      <LockstepMark size={size} />
      <span
        style={{
          fontFamily: "var(--font-display, 'Space Grotesk'), system-ui, sans-serif",
          fontSize: `${fontSize}px`,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          // Optical alignment — wordmark sits very slightly above visual center
          // because the mark is symmetrical but text has descenders.
          marginBottom: '0.02em',
        }}
      >
        Lockstep
      </span>
    </span>
  );
}
