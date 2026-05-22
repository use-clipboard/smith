'use client';

/**
 * RowActionsMenu — the dropdown menu that appears for transaction row actions.
 *
 * Used by both the hover-revealed "⋯" button AND the row's right-click
 * context menu. Portals to body so it escapes any stacking-context traps in
 * the table it sits inside.
 *
 * Items render with optional icons + keyboard-shortcut hints (right-aligned)
 * + a `danger` flag for destructive operations (Delete) which renders in
 * rose tones.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface ActionMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

export type AnchorPosition =
  | { type: 'cursor'; x: number; y: number }
  | { type: 'rect'; rect: DOMRect };

interface Props {
  open: boolean;
  anchor: AnchorPosition | null;
  items: ActionMenuItem[];
  onClose: () => void;
  /** Optional header label at the top of the menu (e.g. ref no). */
  title?: string;
}

const MENU_WIDTH = 220;
const MENU_ESTIMATED_HEIGHT = 280; // for flipping above when no room below

export default function RowActionsMenu({ open, anchor, items, onClose, title }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Compute final position so the menu sits on screen even when triggered
  // near the edges. For 'cursor' anchors we drop the menu's top-left at the
  // cursor; for 'rect' (⋯ button) we drop it below+left of the button.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = 0, left = 0;
    if (anchor.type === 'cursor') {
      top = anchor.y;
      left = anchor.x;
    } else {
      // Drop below button, right-aligned to button right edge so menu doesn't
      // shoot off into the page.
      top = anchor.rect.bottom + 4;
      left = anchor.rect.right - MENU_WIDTH;
    }
    // Clamp to viewport
    if (left + MENU_WIDTH > vw - 8) left = vw - MENU_WIDTH - 8;
    if (left < 8) left = 8;
    if (top + MENU_ESTIMATED_HEIGHT > vh - 8) {
      // Flip up
      if (anchor.type === 'cursor') top = Math.max(8, anchor.y - MENU_ESTIMATED_HEIGHT);
      else top = Math.max(8, anchor.rect.top - MENU_ESTIMATED_HEIGHT - 4);
    }
    setPos({ top, left });
  }, [open, anchor]);

  // Close on outside click, Escape, or scroll
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onScroll() { onClose(); }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, onClose]);

  if (!open || !portalReady || !pos) return null;

  const visibleItems = items.filter(i => !i.hidden);
  if (visibleItems.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
      className="z-[1500] rounded-md border border-slate-200 bg-white shadow-xl overflow-hidden text-sm"
    >
      {title && (
        <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50 text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wide truncate">
          {title}
        </div>
      )}
      <ul className="py-1">
        {visibleItems.map((it, idx) => {
          const Icon = it.icon;
          // Insert a divider before the first danger item for visual separation
          const showDivider = it.danger && visibleItems.slice(0, idx).some(p => !p.danger);
          return (
            <li key={it.id}>
              {showDivider && <div className="my-1 border-t border-slate-100" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  it.danger
                    ? 'text-rose-700 hover:bg-rose-50'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {Icon && <Icon size={13} className="shrink-0" />}
                <span className="flex-1 truncate">{it.label}</span>
                {it.shortcut && (
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {it.shortcut}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}
