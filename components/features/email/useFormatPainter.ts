'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

/**
 * Format painter for the compose body — pick up the formatting at the caret,
 * then paint it onto the next selection the user makes.
 *
 * Scope is deliberately the same five formats the toolbar itself offers (bold,
 * italic, underline, strikethrough, colour). Copying font family/size too would
 * mean pulling in styling the user has no way to set or clear by hand, which is
 * how pasted-in Word formatting becomes unfixable.
 */

export interface PaintedFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Resolved rgb() string from getComputedStyle. */
  color: string;
}

/** Read the effective formatting at the current selection. */
function captureAt(root: HTMLElement): PaintedFormat | null {
  const sel = root.ownerDocument.defaultView?.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const anchor = sel.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  const el = (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement) as HTMLElement | null;
  if (!el) return null;
  const cs = root.ownerDocument.defaultView!.getComputedStyle(el);
  const decoration = `${cs.textDecorationLine} ${cs.textDecoration}`;
  return {
    // Computed font-weight is always numeric, including for `bold`/`bolder`.
    bold:      parseInt(cs.fontWeight, 10) >= 600,
    italic:    cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    underline: decoration.includes('underline'),
    strike:    decoration.includes('line-through'),
    color:     cs.color,
  };
}

/** Force the selection to match `fmt`, toggling only what actually differs. */
function paintOnto(doc: Document, fmt: PaintedFormat): void {
  const set = (command: string, want: boolean) => {
    // queryCommandState reports false for a mixed selection, so painting "not
    // bold" over half-bold text correctly reads as a difference and clears it.
    if (doc.queryCommandState(command) !== want) doc.execCommand(command, false);
  };
  set('bold', fmt.bold);
  set('italic', fmt.italic);
  set('underline', fmt.underline);
  set('strikeThrough', fmt.strike);
  doc.execCommand('foreColor', false, fmt.color);
}

export interface FormatPainter {
  /** True while a format is loaded and waiting to be painted. */
  armed: boolean;
  /** Toolbar click — arm from the caret, or disarm if already armed. */
  toggle: () => void;
  /** Cancel without painting (Escape, or losing the editor). */
  disarm: () => void;
  /**
   * Call on mouseup/keyup in the editor. Paints if armed and the user has
   * selected something. Returns true if a paint happened, so the caller can
   * snapshot it into the undo stack.
   */
  applyToSelection: () => boolean;
}

export function useFormatPainter(rootRef: RefObject<HTMLElement | null>): FormatPainter {
  const format = useRef<PaintedFormat | null>(null);
  const [armed, setArmed] = useState(false);

  const disarm = useCallback(() => { format.current = null; setArmed(false); }, []);

  const toggle = useCallback(() => {
    if (armed) { disarm(); return; }
    const root = rootRef.current;
    if (!root) return;
    const captured = captureAt(root);
    // No caret in the body yet — there's no formatting to pick up, so staying
    // disarmed is better than arming with a meaningless default.
    if (!captured) return;
    format.current = captured;
    setArmed(true);
  }, [armed, disarm, rootRef]);

  const applyToSelection = useCallback((): boolean => {
    const root = rootRef.current;
    const fmt = format.current;
    if (!root || !fmt) return false;
    const doc = root.ownerDocument;
    const sel = doc.defaultView?.getSelection?.();
    // A collapsed selection is the click that lands the caret, not a target —
    // stay armed and wait for the user to actually drag over something.
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    if (!root.contains(sel.anchorNode)) return false;
    // Emit inline styles rather than <font>/<b> tags: styles survive Gmail's
    // sanitiser on the receiving end far more reliably.
    doc.execCommand('styleWithCSS', false, 'true');
    paintOnto(doc, fmt);
    doc.execCommand('styleWithCSS', false, 'false');
    disarm();
    return true;
  }, [disarm, rootRef]);

  return { armed, toggle, disarm, applyToSelection };
}
