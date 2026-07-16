'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

/**
 * Undo/redo for the compose body.
 *
 * The body is an uncontrolled contentEditable, so the browser gives us a native
 * undo stack for free — but only for changes it can see. Three things in this
 * editor mutate the DOM behind its back and silently wipe that stack:
 *
 *   - the AI actions (rewrite / help-me-write / suggest-reply) assign innerHTML
 *   - autocorrect rewrites text nodes via textContent
 *   - Smart Compose accepts a suggestion via replaceChild
 *
 * The first is the one that matters: without our own history, Ctrl+Z after an AI
 * rewrite could never give the user their original prose back. So we keep an
 * explicit stack of HTML snapshots and drive undo/redo from that instead of the
 * native one, which covers every mutation path uniformly.
 */

const LIMIT = 100;          // snapshots kept; beyond this the oldest is dropped
const IDLE_MS = 400;        // typing pause that closes a snapshot

interface Entry {
  html: string;
  /** Caret position as a character offset into the editor's text content. */
  caret: number | null;
}

/**
 * Measure the caret as a plain-text offset from the start of the editor. Offsets
 * survive an innerHTML swap where node references don't, which is what makes
 * them usable as a restore target.
 */
function readCaret(root: HTMLElement): number | null {
  const sel = root.ownerDocument.defaultView?.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Walk the text nodes to convert an offset back into a live caret position. */
function writeCaret(root: HTMLElement, offset: number): void {
  const doc = root.ownerDocument;
  const sel = doc.defaultView?.getSelection?.();
  if (!sel) return;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = doc.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  // The snapshot is shorter than the offset (or holds no text at all) — the end
  // of the content is the closest honest answer.
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export interface EditorHistory {
  /** Snapshot the current DOM immediately. Call before any deliberate mutation. */
  commit: () => void;
  /** Snapshot once the user stops typing. Safe to call on every keystroke. */
  scheduleCommit: () => void;
  /** Throw away all history and start again from `html` (a fresh compose). */
  reset: (html: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory(rootRef: RefObject<HTMLElement | null>): EditorHistory {
  const stack = useRef<Entry[]>([]);
  const index = useRef(-1);
  const timer = useRef<number | null>(null);
  // Set while we're the ones writing to the DOM, so the resulting input event
  // doesn't schedule a snapshot of the state we just restored.
  const applying = useRef(false);
  // True when the DOM has moved on from stack[index] but the idle timer hasn't
  // fired yet — mid-word, in other words. Undo is still available in that state.
  const dirty = useRef(false);
  const [, bump] = useState(0);

  const commit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    dirty.current = false;
    const entry: Entry = { html: root.innerHTML, caret: readCaret(root) };
    const current = stack.current[index.current];
    // Nothing changed — just refresh where the caret was, so a later undo comes
    // back to where the user actually is rather than where they last edited.
    if (current && current.html === entry.html) { current.caret = entry.caret; return; }
    // Committing after an undo discards the redo branch, as everywhere else.
    stack.current = stack.current.slice(0, index.current + 1);
    stack.current.push(entry);
    if (stack.current.length > LIMIT) stack.current.shift();
    index.current = stack.current.length - 1;
    bump(v => v + 1);
  }, [rootRef]);

  const scheduleCommit = useCallback(() => {
    if (applying.current) return;
    dirty.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; commit(); }, IDLE_MS);
    bump(v => v + 1);
  }, [commit]);

  const reset = useCallback((html: string) => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    stack.current = [{ html, caret: null }];
    index.current = 0;
    dirty.current = false;
    bump(v => v + 1);
  }, []);

  const apply = useCallback((entry: Entry) => {
    const root = rootRef.current;
    if (!root) return;
    applying.current = true;
    root.innerHTML = entry.html;
    root.focus();
    if (entry.caret !== null) writeCaret(root, entry.caret);
    // Release on the next frame: the input/selection events raised by the swap
    // above are dispatched asynchronously and must not re-enter as user edits.
    requestAnimationFrame(() => { applying.current = false; });
    bump(v => v + 1);
  }, [rootRef]);

  const undo = useCallback(() => {
    // Close any half-typed run first, otherwise the first Ctrl+Z would jump back
    // past what the user just typed instead of undoing it.
    if (dirty.current) commit();
    if (index.current <= 0) return;
    index.current -= 1;
    apply(stack.current[index.current]);
  }, [apply, commit]);

  const redo = useCallback(() => {
    if (index.current >= stack.current.length - 1) return;
    index.current += 1;
    apply(stack.current[index.current]);
  }, [apply]);

  return {
    commit, scheduleCommit, reset, undo, redo,
    canUndo: index.current > 0 || dirty.current,
    canRedo: index.current < stack.current.length - 1,
  };
}
