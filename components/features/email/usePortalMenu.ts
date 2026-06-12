'use client';

import { useRef, useState } from 'react';

/**
 * Positions a dropdown menu as a fixed, body-portalled element so it escapes
 * any `overflow`/clipping ancestor (the tab / filter bars use overflow-x-auto,
 * which clips normal absolute dropdowns). Returns a trigger ref + the computed
 * fixed coords; the caller renders the menu via createPortal at `pos`.
 */
export function usePortalMenu(width = 224, align: 'left' | 'right' = 'left') {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const left = align === 'right'
        ? Math.max(8, r.right - width)
        : Math.min(r.left, window.innerWidth - width - 8);
      setPos({ top: r.bottom + 4, left });
    }
    setOpen(true);
  }

  return { triggerRef, open, setOpen, toggle, pos, width };
}
