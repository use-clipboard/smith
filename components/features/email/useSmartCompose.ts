'use client';

import { useEffect, useRef } from 'react';

/**
 * useSmartCompose — Gmail-style inline autocomplete for a contentEditable.
 *
 * Two suggestion sources:
 *   1. `localComplete` — instant, synchronous, no API call (e.g. fill the
 *      recipient's name straight after a greeting). Tried first on every input.
 *   2. `predict` — an async model continuation, fired on a short typing pause
 *      when there's no local completion.
 *
 * The suggestion shows as faint, non-editable ghost text at the caret. Accept
 * with Tab OR Right-arrow (→); any other key, a click, blur, or IME composition
 * dismisses it. The ghost span carries data-sc-ghost so it can be stripped
 * before the body is ever sent/saved (stripGhostHtml) — it must never leak.
 */

const GHOST_ATTR = 'data-sc-ghost';

interface Options {
  /** Master on/off (user toggle). */
  enabled: boolean;
  /** Whether the editor is mounted/visible — re-binds listeners when it opens. */
  active: boolean;
  /** Async model continuation, or '' for none. */
  predict: (context: string) => Promise<string>;
  /** Instant local completion (no API), or '' for none. Tried first. */
  localComplete?: (context: string) => string;
}

/**
 * Whether a suggestion needs a leading space so it doesn't glue onto the
 * preceding text. True when the caret sits right after a word character or a
 * sentence-ending mark (no space yet) and the suggestion starts with a word —
 * e.g. "How" + "can…" → "How can…", "done." + "Next…" → "done. Next…".
 * Stays false when the previous char is already whitespace, or the suggestion
 * begins with punctuation that should hug the previous word (", . ' etc.).
 */
function needsLeadingSpace(prevChar: string, suggestion: string): boolean {
  if (!suggestion) return false;
  if (prevChar === '' || /\s/.test(prevChar)) return false;
  if (/\s/.test(suggestion[0])) return false;
  if (/[,.!?;:)'"%»]/.test(suggestion[0])) return false;
  return true;
}

/** Plain text within `root` from its start up to a collapsed caret. */
function precedingText(root: HTMLElement, range: Range): string {
  const r = range.cloneRange();
  r.selectNodeContents(root);
  r.setEnd(range.startContainer, range.startOffset);
  return r.toString();
}

export function useSmartCompose(editorRef: React.RefObject<HTMLElement>, opts: Options) {
  const enabledRef = useRef(opts.enabled);
  const predictRef = useRef(opts.predict);
  const localRef = useRef(opts.localComplete);
  enabledRef.current = opts.enabled;
  predictRef.current = opts.predict;
  localRef.current = opts.localComplete;

  useEffect(() => {
    const el = editorRef.current;
    if (!el || !opts.active) return;

    let ghost: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reqId = 0;
    let composing = false;

    function removeGhost() {
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null;
    }

    /** Plain text up to the caret, or null if the caret isn't a collapsed point
     *  inside the editor. */
    function caretContext(): string | null {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!el || !el.contains(range.startContainer)) return null;
      return precedingText(el, range);
    }

    /** Insert ghost text at the current caret without moving the caret into it. */
    function showGhost(suggestion: string) {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!el || !el.contains(r.startContainer)) return;
      // Add a leading space when the suggestion would otherwise run straight
      // into the preceding word or full stop.
      if (needsLeadingSpace(precedingText(el, r).slice(-1), suggestion)) {
        suggestion = ' ' + suggestion;
      }
      const span = document.createElement('span');
      span.setAttribute(GHOST_ATTR, 'true');
      span.setAttribute('contenteditable', 'false');
      // The real text lives in an attribute so the accept handler never picks
      // up the visual "→" hint chip below.
      span.setAttribute('data-sc-text', suggestion);
      span.style.color = 'var(--text-muted)';
      span.style.opacity = '0.6';
      span.style.pointerEvents = 'none';
      span.appendChild(document.createTextNode(suggestion));
      // Faint key-cap hint showing what to press to accept.
      const hint = document.createElement('span');
      hint.textContent = '→';
      hint.setAttribute('aria-hidden', 'true');
      Object.assign(hint.style, {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginLeft: '4px', padding: '0 3px', minWidth: '15px', height: '15px',
        border: '1px solid currentColor', borderRadius: '4px', fontSize: '10px',
        lineHeight: '1', opacity: '0.8', verticalAlign: 'middle',
      } as Partial<CSSStyleDeclaration>);
      span.appendChild(hint);
      r.insertNode(span);
      const caret = document.createRange();
      caret.setStartBefore(span);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      ghost = span;
    }

    async function runPredict(ctxAtSchedule: string) {
      if (!enabledRef.current) return;
      const myReq = ++reqId;
      let suggestion = '';
      try { suggestion = await predictRef.current(ctxAtSchedule); } catch { return; }
      if (myReq !== reqId || !suggestion || !enabledRef.current) return;
      // Only show it if the user hasn't typed/moved since we asked.
      if (caretContext() !== ctxAtSchedule) return;
      showGhost(suggestion);
    }

    function acceptGhost() {
      if (!ghost) return;
      // Read the stored text (not textContent — that includes the "→" hint).
      const text = ghost.getAttribute('data-sc-text') ?? '';
      const tn = document.createTextNode(text);
      ghost.parentNode?.replaceChild(tn, ghost);
      ghost = null;
      const sel = window.getSelection();
      if (sel) {
        const r = document.createRange();
        r.setStartAfter(tn);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      el?.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function onInput() {
      if (composing) return;
      removeGhost();
      if (timer) clearTimeout(timer);
      if (!enabledRef.current) return;
      const ctx = caretContext();
      if (ctx === null) return;
      // 1) Instant local completion (e.g. greeting → recipient name).
      const local = localRef.current?.(ctx) ?? '';
      if (local) { showGhost(local); return; }
      // 2) Async model prediction on a pause (needs a little context).
      if (ctx.trim().length < 12) return;
      timer = setTimeout(() => { void runPredict(ctx); }, 550);
    }

    function onKeyDown(e: KeyboardEvent) {
      // Accept with Tab OR Right-arrow. → never moves focus, so it's the
      // reliable accept key when Tab would otherwise jump to the next field.
      if ((e.key === 'Tab' || e.key === 'ArrowRight') && ghost) {
        e.preventDefault();
        e.stopPropagation();
        acceptGhost();
        return;
      }
      if (ghost && !['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) removeGhost();
      if (e.key === 'Escape' && timer) clearTimeout(timer);
    }
    function onBlur() { removeGhost(); if (timer) clearTimeout(timer); }
    function onMouseDown() { removeGhost(); }
    function onCompositionStart() { composing = true; removeGhost(); }
    function onCompositionEnd() { composing = false; }

    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown, true);
    el.addEventListener('blur', onBlur);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('compositionstart', onCompositionStart);
    el.addEventListener('compositionend', onCompositionEnd);

    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('compositionstart', onCompositionStart);
      el.removeEventListener('compositionend', onCompositionEnd);
      if (timer) clearTimeout(timer);
      removeGhost();
    };
  }, [editorRef, opts.active]);
}

/** Strip any leftover ghost-suggestion spans before the body is sent/saved/
 *  snapshotted, so a prediction can never leak into a real email. */
export function stripGhostHtml(html: string): string {
  return html.replace(/<span[^>]*data-sc-ghost[^>]*>[\s\S]*?<\/span>/gi, '');
}
