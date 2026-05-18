import React from 'react';

interface LockstepMarkProps {
  size?: number;
  className?: string;
  /** When true, drops the dashed lock line for legibility at small sizes (under 24px). */
  compact?: boolean;
}

/**
 * Lockstep mark. Inherits color from CSS `color` property via currentColor.
 *
 * @example
 * <div style={{ color: '#EDEDF0' }}>
 *   <LockstepMark size={20} />
 * </div>
 */
export function LockstepMark({ size = 24, className, compact }: LockstepMarkProps) {
  const useCompact = compact ?? size < 24;

  if (useCompact) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        className={className}
        aria-label="Lockstep"
      >
        <line x1="2" y1="5" x2="14" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
        <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
        <rect x="6" y="3" width="4" height="4" transform="rotate(45 8 5)" />
        <rect x="6" y="9" width="4" height="4" transform="rotate(45 8 11)" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      className={className}
      aria-label="Lockstep"
    >
      <line x1="6" y1="18" x2="58" y2="18" strokeWidth="3" strokeLinecap="square" />
      <line x1="6" y1="46" x2="58" y2="46" strokeWidth="3" strokeLinecap="square" />
      <rect x="22" y="8" width="20" height="20" transform="rotate(45 32 18)" fill="currentColor" />
      <rect x="22" y="36" width="20" height="20" transform="rotate(45 32 46)" fill="currentColor" />
      <line x1="32" y1="26" x2="32" y2="38" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}
