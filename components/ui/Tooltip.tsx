'use client';

import { type ReactNode } from 'react';

/**
 * Tooltip — the standard hover label across SMITH.
 *
 * ── HOW TO USE ─────────────────────────────────────────────────────────────
 *   <Tooltip label="Show / hide columns">
 *     <button …>…</button>
 *   </Tooltip>
 *
 * Use this in place of the native `title=""` attribute on every hoverable
 * element (icon buttons, action chips, status indicators, etc.). Native
 * tooltips render in the browser's beige-coloured chrome and are inconsistent
 * across platforms — this component renders a unified dark-pill tooltip
 * matching the rest of the app's visual language.
 *
 * For accessibility, also pass `aria-label` on the wrapped interactive element
 * — the visual tooltip alone isn't reachable by screen readers.
 *
 * The wrapper is `inline-flex` so it doesn't change the layout of single
 * children. Stacking is handled by `position: absolute` + a high z-index;
 * pointer events on the bubble are disabled so it never blocks clicks.
 * ───────────────────────────────────────────────────────────────────────────
 */

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Props {
  label: ReactNode;
  /** Which side of the trigger the tooltip appears on. Defaults to bottom. */
  side?: Side;
  /** Optional extra Tailwind classes applied to the bubble. */
  bubbleClassName?: string;
  children: ReactNode;
  /** Optional extra Tailwind classes applied to the wrapper. */
  className?: string;
}

const SIDE_CLASSES: Record<Side, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
};

export default function Tooltip({ label, side = 'bottom', bubbleClassName = '', children, className = '' }: Props) {
  return (
    <span className={`relative inline-flex group/tip ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${SIDE_CLASSES[side]} px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity z-50 shadow-lg ${bubbleClassName}`}
      >
        {label}
      </span>
    </span>
  );
}
