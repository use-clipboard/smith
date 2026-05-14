'use client';

import { useState, useRef, useEffect } from 'react';
import { StickyNote, ChevronDown, Eye, EyeOff, Trash2, Plus, Minimize2, Maximize2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useStickyNotes, type StickyNote as StickyNoteData } from './StickyNotesProvider';

/**
 * Header button.
 *
 * Primary action depends on the current note set:
 *   - 0 notes      → click adds a new sticky note
 *   - 1+ notes     → click toggles Show / Hide all
 *
 * Chevron menu always offers: New, Show/Hide, list of currently minimised
 * notes (with one-click restore), and Delete all.
 */
export default function StickyNotesHeaderButton() {
  const { notes, visible, setVisible, addNote, deleteAll, setMinimised, showAll } = useStickyNotes();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const minimisedNotes = notes.filter(n => n.is_minimised);
  const hasNotes = notes.length > 0;
  // "Nothing showing" if the global flag is off OR every note is individually
  // minimised. In that state the primary button becomes Show — clicking it
  // restores everything (visible=true + un-minimise all).
  const nothingShowing = !visible || (notes.length > 0 && minimisedNotes.length === notes.length);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  function handleDeleteAll() {
    setMenuOpen(false);
    if (notes.length === 0) return;
    if (!confirm(`Delete all ${notes.length} sticky note${notes.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    deleteAll();
  }

  function handlePrimaryClick() {
    if (!hasNotes) {
      addNote();
      return;
    }
    if (nothingShowing) {
      // Bring everything back: global on + un-minimise per-note
      showAll();
    } else {
      // Hide globally; per-note state is preserved so Show restores it
      setVisible(false);
    }
  }

  // Tooltip + icon reflect whether anything is currently visible
  const primaryTooltip = !hasNotes
    ? 'Add a sticky note'
    : nothingShowing
      ? 'Show sticky notes'
      : 'Hide sticky notes';
  const PrimaryIcon = !hasNotes
    ? StickyNote
    : nothingShowing
      ? Eye
      : EyeOff;

  return (
    <div className="relative flex items-stretch" ref={wrapperRef}>
      <Tooltip label={primaryTooltip}>
        <button
          onClick={handlePrimaryClick}
          aria-label={primaryTooltip}
          className="relative w-8 h-8 flex items-center justify-center rounded-l-lg transition-all text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]"
        >
          <PrimaryIcon size={16} />
          {notes.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-[var(--accent)] text-white text-[9px] font-bold px-0.5 leading-none">
              {notes.length > 9 ? '9+' : notes.length}
            </span>
          )}
        </button>
      </Tooltip>

      <Tooltip label="Sticky note options">
        <button
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Sticky note options"
          aria-expanded={menuOpen}
          className={`w-5 h-8 flex items-center justify-center rounded-r-lg transition-all border-l border-[var(--border)] ${
            menuOpen
              ? 'bg-[var(--bg-nav-hover)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          <ChevronDown size={11} />
        </button>
      </Tooltip>

      {menuOpen && (
        <div className="absolute right-0 top-10 w-64 glass-solid rounded-lg border border-[var(--border)] shadow-xl overflow-hidden z-50">
          <button
            onClick={() => { setMenuOpen(false); addNote(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)]"
          >
            <Plus size={13} className="text-[var(--accent)]" />
            New sticky note
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              if (nothingShowing) showAll(); else setVisible(false);
            }}
            disabled={notes.length === 0}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {nothingShowing
              ? <><Eye size={13} className="text-[var(--text-muted)]" /> Show all</>
              : <><EyeOff size={13} className="text-[var(--text-muted)]" /> Hide all</>}
          </button>

          {/* Minimised notes — one-click restore */}
          {minimisedNotes.length > 0 && (
            <>
              <div className="border-t border-[var(--border)]" />
              <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                <Minimize2 size={10} />
                Minimised ({minimisedNotes.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
                {minimisedNotes.map(n => (
                  <button
                    key={n.id}
                    onClick={() => { setMenuOpen(false); setMinimised(n.id, false); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)]"
                    title={`Restore: ${notePreview(n)}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: COLOR_DOTS[n.color] ?? '#fde68a' }}
                    />
                    <span className="flex-1 truncate text-[var(--text-secondary)]">{notePreview(n)}</span>
                    <Maximize2 size={11} className="shrink-0 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-[var(--border)]" />
          <button
            onClick={handleDeleteAll}
            disabled={notes.length === 0}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={13} />
            Delete all
          </button>
        </div>
      )}
    </div>
  );
}

const COLOR_DOTS: Record<string, string> = {
  yellow: '#fde68a',
  pink:   '#fbcfe8',
  blue:   '#bae6fd',
  green:  '#a7f3d0',
  purple: '#ddd6fe',
  gray:   '#e5e7eb',
};

/** Pull the first non-empty line of plain text from a Tiptap doc for menu preview. */
function notePreview(note: StickyNoteData): string {
  const fallback = 'Untitled note';
  const doc = note.content as { content?: unknown[] } | null;
  if (!doc || !Array.isArray(doc.content)) return fallback;
  const lines: string[] = [];
  walk(doc.content, lines);
  const first = lines.find(l => l.trim().length > 0);
  if (!first) return fallback;
  return first.length > 60 ? first.slice(0, 60) + '…' : first;
}

function walk(nodes: unknown[], out: string[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') {
      const last = out[out.length - 1] ?? '';
      out[out.length === 0 ? 0 : out.length - 1] = last + n.text;
    } else if (n.type === 'paragraph' || n.type === 'taskItem' || n.type === 'listItem') {
      out.push('');
      if (Array.isArray(n.content)) walk(n.content, out);
    } else if (Array.isArray(n.content)) {
      walk(n.content, out);
    }
  }
}
