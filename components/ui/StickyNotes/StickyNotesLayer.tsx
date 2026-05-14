'use client';

import { useEffect } from 'react';
import { useStickyNotes } from './StickyNotesProvider';
import StickyNote from './StickyNote';

/**
 * Floating layer that mounts every sticky note as an absolute-positioned
 * card on top of the app. The container is fixed/inset-0 so notes are
 * positioned relative to the viewport, not page scroll.
 *
 * Auto-tiling: on mount and whenever the window resizes, any note that's
 * landed completely off-screen is nudged back into a cascading position.
 * Off-screen-left/right/below all qualify; we only check fully outside.
 */
export default function StickyNotesLayer() {
  const { notes, visible, patchNote } = useStickyNotes();

  // Only render notes that aren't individually minimised
  const renderedNotes = notes.filter(n => !n.is_minimised);

  // Auto-tile fallback — only adjust notes that are truly unreachable.
  // Skip minimised ones (their position doesn't matter while hidden).
  useEffect(() => {
    function tileIfNeeded() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      let cascadeIdx = 0;
      renderedNotes.forEach(n => {
        const offRight  = n.position_x > W - 60;          // less than 60px of header visible
        const offBottom = n.position_y > H - 40;
        const offLeft   = n.position_x + n.width < 60;
        const offTop    = n.position_y < 0;
        if (offRight || offBottom || offLeft || offTop) {
          const offset = (cascadeIdx++ % 8) * 24;
          const nx = Math.max(80, Math.min(W - n.width - 20, W - n.width - 40 - offset));
          const ny = Math.max(80, Math.min(H - n.height - 20, 100 + offset));
          patchNote(n.id, { position_x: nx, position_y: ny });
        }
      });
    }
    tileIfNeeded();
    window.addEventListener('resize', tileIfNeeded);
    return () => window.removeEventListener('resize', tileIfNeeded);
    // We intentionally only re-run when the set of rendered note ids changes,
    // not on every drag — patchNote updates positions live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedNotes.map(n => n.id).join(',')]);

  if (!visible || renderedNotes.length === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40"
      aria-label="Personal sticky notes"
    >
      {renderedNotes.map(n => <StickyNote key={n.id} note={n} />)}
    </div>
  );
}
