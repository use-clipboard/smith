'use client';

import { type ReactNode, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
 * Always pair with `aria-label` on the wrapped interactive element so screen
 * readers reach the same text — the visual tooltip alone isn't accessible.
 *
 * ── HOW IT WORKS ───────────────────────────────────────────────────────────
 * The bubble is rendered into a React Portal at `document.body`, so it always
 * sits on top of every other stacking context (modals, side panels, tab bars,
 * etc.) and isn't clipped by any ancestor's `overflow: hidden`.
 *
 * Position is computed in JS from the trigger's bounding rect on hover. If
 * the requested side would push the bubble off-screen, it auto-flips to the
 * opposite side. Final coordinates are clamped to the viewport so the bubble
 * is always fully visible.
 *
 * The wrapper is `inline-flex` so it doesn't change the layout of single
 * children. Pointer events on the bubble are disabled so it never blocks
 * clicks.
 * ───────────────────────────────────────────────────────────────────────────
 */

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Props {
  label: ReactNode;
  /** Preferred side. Auto-flips to the opposite side if it would clip. */
  side?: Side;
  /** Optional extra Tailwind classes applied to the bubble. */
  bubbleClassName?: string;
  children: ReactNode;
  /** Optional extra Tailwind classes applied to the wrapper. */
  className?: string;
}

const GAP = 8; // px gap between trigger and bubble
const EDGE = 6; // min distance from viewport edge

function opposite(s: Side): Side {
  if (s === 'top') return 'bottom';
  if (s === 'bottom') return 'top';
  if (s === 'left') return 'right';
  return 'left';
}

function placeFor(side: Side, trig: DOMRect, bub: DOMRect): { top: number; left: number } {
  switch (side) {
    case 'top':
      return { top: trig.top - bub.height - GAP, left: trig.left + trig.width / 2 - bub.width / 2 };
    case 'bottom':
      return { top: trig.bottom + GAP, left: trig.left + trig.width / 2 - bub.width / 2 };
    case 'left':
      return { top: trig.top + trig.height / 2 - bub.height / 2, left: trig.left - bub.width - GAP };
    case 'right':
      return { top: trig.top + trig.height / 2 - bub.height / 2, left: trig.right + GAP };
  }
}

function clips(p: { top: number; left: number }, bub: DOMRect, vw: number, vh: number): boolean {
  return (
    p.top < EDGE ||
    p.top + bub.height > vh - EDGE ||
    p.left < EDGE ||
    p.left + bub.width > vw - EDGE
  );
}

export default function Tooltip({ label, side = 'bottom', bubbleClassName = '', children, className = '' }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute position after the bubble renders so we can measure its size.
  useLayoutEffect(() => {
    if (!hovered || !triggerRef.current || !bubbleRef.current) return;
    const trig = triggerRef.current.getBoundingClientRect();
    const bub = bubbleRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let p = placeFor(side, trig, bub);

    // Try the opposite side if the preferred side clips. Fall back to the
    // preferred side if both clip — clamping below will pin it on-screen.
    if (clips(p, bub, vw, vh)) {
      const flipped = placeFor(opposite(side), trig, bub);
      if (!clips(flipped, bub, vw, vh)) p = flipped;
    }

    // Clamp to viewport so the bubble is always fully visible.
    p.left = Math.max(EDGE, Math.min(p.left, vw - bub.width - EDGE));
    p.top = Math.max(EDGE, Math.min(p.top, vh - bub.height - EDGE));

    setPos(p);
  }, [hovered, side, label]);

  // Hide on scroll / resize — the trigger may have moved so the cached
  // position would be wrong. Re-hover refreshes it.
  useEffect(() => {
    if (!hovered) {
      setPos(null);
      return;
    }
    const dismiss = () => setHovered(false);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [hovered]);

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && typeof document !== 'undefined' && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          // Render off-screen for the first paint so we can measure its size,
          // then pop into place once positioned. Avoids a flash at (0,0).
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            pointerEvents: 'none',
            zIndex: 9999,
            maxWidth: 'min(90vw, 320px)',
          }}
          className={`px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium shadow-lg ${bubbleClassName}`}
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  );
}
