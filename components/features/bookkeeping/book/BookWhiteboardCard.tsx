'use client';

/**
 * BookWhiteboardCard — per-book shared whiteboard.
 *
 * Replaces the old static "Getting Started" panel. Same slot on the Home tab,
 * but instead of help content (which Ask Smith handles), users get a
 * free-form team whiteboard for each book: sticky notes + handwritten marker
 * text, draggable, synced live to every user with access to the book.
 *
 * Mechanics:
 *   • Stickies (yellow/pink/blue/green) — added via the "+ Sticky" button →
 *     modal. Each renders with a magnet at the top middle; drag the magnet
 *     to reposition. Owner can edit/delete inline (delete asks first).
 *   • Markers (black/blue/red) — added via the "✎ Add text" button. The pen
 *     colour swatches only appear once Add text is active; pick a colour
 *     then click anywhere on the board to start writing. Marker text is
 *     written in a handwritten font (Caveat) and the block is draggable.
 *   • Delete — owner hovers the note, clicks the ✕, and confirms in a
 *     small lightbox. (The old corner-eraser tool was removed.)
 *   • Overflow — notes near the board edge spill over onto neighbouring
 *     cards on purpose. That sells the "pinned to a real board" feel
 *     rather than trapping them inside a rectangle.
 *   • Realtime — Supabase channel scoped to the book id, so two users on
 *     the same book see each other's notes and moves live.
 *
 * Positions are stored as percentages of the board's visible area so the
 * layout stays sensible across viewport sizes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Pencil, Loader2, StickyNote as StickyNoteIcon, PenTool, AlertTriangle,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { createClient } from '@/lib/supabase';

type StickyColor = 'yellow' | 'pink' | 'blue' | 'green';
type MarkerColor = 'black' | 'blue' | 'red';

interface WhiteboardNote {
  id: string;
  book_id: string;
  kind: 'sticky' | 'marker';
  content: string;
  color: string;          // validated against the right palette per kind
  pos_x: number;          // 0-100 (% of board width)
  pos_y: number;          // 0-100 (% of board height)
  rotation: number;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

const STICKY_COLORS: { value: StickyColor; bg: string; border: string; label: string }[] = [
  { value: 'yellow', bg: '#fef9c3', border: '#fde047', label: 'Yellow' },
  { value: 'pink',   bg: '#fce7f3', border: '#f9a8d4', label: 'Pink'   },
  { value: 'blue',   bg: '#dbeafe', border: '#93c5fd', label: 'Blue'   },
  { value: 'green',  bg: '#dcfce7', border: '#86efac', label: 'Green'  },
];
const MAGNET_GRADIENTS: Record<StickyColor, string> = {
  yellow: 'radial-gradient(ellipse at 35% 30%, #fbbf24, #d97706 55%, #92400e)',
  pink:   'radial-gradient(ellipse at 35% 30%, #f472b6, #db2777 55%, #9d174d)',
  blue:   'radial-gradient(ellipse at 35% 30%, #60a5fa, #2563eb 55%, #1e3a8a)',
  green:  'radial-gradient(ellipse at 35% 30%, #4ade80, #16a34a 55%, #14532d)',
};

const MARKER_COLORS: { value: MarkerColor; ink: string; label: string }[] = [
  { value: 'black', ink: '#1f2937', label: 'Black' },
  { value: 'blue',  ink: '#1d4ed8', label: 'Blue'  },
  { value: 'red',   ink: '#b91c1c', label: 'Red'   },
];

/** Stable tiny rotation derived from the note id — keeps stickies feeling
 *  pinned-up rather than pixel-grid-perfect. */
function noteRotation(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return ((h % 90) - 45) / 10;
}

interface Props {
  bookId: string;
  /** Name of the book — used in the panel title ("<book> Whiteboard"). */
  bookName: string;
  currentUserId: string;
  currentUserName: string | null;
  /** Wrapper class controlled by the parent — used by BookHomeTab to make
   *  the card share a height with the stacked Quick Actions + Key Info. */
  className?: string;
}

// 'add_marker' is the only non-normal mode now — the eraser tool was removed
// in favour of inline X buttons + a confirm-before-delete lightbox.
type Mode = 'normal' | 'add_marker';
interface NewMarkerDraft { posX: number; posY: number; color: MarkerColor; }
interface PendingDelete { id: string; kind: 'sticky' | 'marker'; preview: string; }

export default function BookWhiteboardCard({ bookId, bookName, currentUserId, currentUserName, className }: Props) {
  const [notes, setNotes] = useState<WhiteboardNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('normal');
  const [stickyModalOpen, setStickyModalOpen] = useState(false);
  const [markerColor, setMarkerColor] = useState<MarkerColor>('black');
  const [newMarkerDraft, setNewMarkerDraft] = useState<NewMarkerDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);

  // ── Load existing notes ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/whiteboard`);
      if (r.ok) {
        const d = await r.json();
        setNotes((d.notes ?? []) as WhiteboardNote[]);
      }
    } finally {
      setLoading(false);
    }
  }, [bookId]);
  useEffect(() => { void load(); }, [load]);

  // ── Realtime subscription ───────────────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`book-whiteboard:${bookId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'bookkeeping_whiteboard_notes',
        filter: `book_id=eq.${bookId}`,
      }, payload => {
        setNotes(prev => {
          const n = payload.new as WhiteboardNote;
          if (prev.some(p => p.id === n.id)) return prev;
          return [n, ...prev];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'bookkeeping_whiteboard_notes',
        filter: `book_id=eq.${bookId}`,
      }, payload => {
        const n = payload.new as WhiteboardNote;
        setNotes(prev => prev.map(p => p.id === n.id ? n : p));
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public',
        table: 'bookkeeping_whiteboard_notes',
      }, payload => {
        const old = payload.old as { id: string };
        setNotes(prev => prev.filter(p => p.id !== old.id));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [bookId]);

  // ── Escape exits modes ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMode('normal');
        setNewMarkerDraft(null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────
  /** Get percent-of-board coords from a mouse event. */
  function eventToPercent(e: { clientX: number; clientY: number }) {
    const board = boardRef.current;
    if (!board) return { x: 50, y: 50 };
    const rect = board.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height) * 100));
    return { x, y };
  }

  function patchNote(id: string, body: Partial<WhiteboardNote>) {
    // Optimistic update; the realtime channel will reconcile if anything drifts.
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...body } : n));
    void fetch(`/api/bookkeeping/books/${bookId}/whiteboard/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Request a deletion — opens the confirm lightbox. The actual DELETE only
   *  fires after the user confirms in `confirmDelete`. */
  function requestDelete(note: WhiteboardNote) {
    const preview = note.kind === 'sticky'
      ? `sticky note "${note.content.slice(0, 60) || '(empty)'}"`
      : `marker note "${note.content.slice(0, 60) || '(empty)'}"`;
    setPendingDelete({ id: note.id, kind: note.kind, preview });
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setNotes(prev => prev.filter(n => n.id !== id));
    await fetch(`/api/bookkeeping/books/${bookId}/whiteboard/${id}`, { method: 'DELETE' });
  }

  // ── Drag handler used by both stickies (magnet) and markers (text) ──────
  function startDrag(noteId: string, e: React.MouseEvent) {
    if (mode !== 'normal') return; // ignore drag in eraser / add-marker modes
    e.preventDefault();
    e.stopPropagation();

    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const startNote = notes.find(n => n.id === noteId);
    if (!startNote) return;

    // Offset between the cursor and the note's centre in % of board, so the
    // note stays anchored to the cursor (no jump on grab).
    const startMouseX = ((e.clientX - rect.left) / rect.width)  * 100;
    const startMouseY = ((e.clientY - rect.top)  / rect.height) * 100;
    const offsetX = startNote.pos_x - startMouseX;
    const offsetY = startNote.pos_y - startMouseY;

    let lastX = startNote.pos_x;
    let lastY = startNote.pos_y;

    // Markers are anchored on their centre (translate(-50%, -50%)) so a naive
    // 0–100 clamp lets half the text escape past every edge. Stickies hang
    // off intentionally for the 3D feel, so we only tighten the clamp for
    // markers — using the rendered element's size as the safety margin.
    const isMarker = startNote.kind === 'marker';

    function onMove(ev: MouseEvent) {
      const r = board!.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width)  * 100;
      const my = ((ev.clientY - r.top)  / r.height) * 100;
      let nextX = mx + offsetX;
      let nextY = my + offsetY;

      if (isMarker) {
        const el = document.querySelector(`[data-note-id="${noteId}"]`) as HTMLElement | null;
        if (el) {
          const er = el.getBoundingClientRect();
          // 4px breathing room on every edge so the marker's right (and left,
          // top, bottom) edge can't visually kiss the panel border — that's
          // what was letting the right edge slip past after wrapping.
          const padPx = 4;
          const halfWPct = ((er.width  / 2) + padPx) / r.width  * 100;
          const halfHPct = ((er.height / 2) + padPx) / r.height * 100;
          nextX = Math.max(halfWPct, Math.min(100 - halfWPct, nextX));
          nextY = Math.max(halfHPct, Math.min(100 - halfHPct, nextY));
        } else {
          nextX = Math.max(0, Math.min(100, nextX));
          nextY = Math.max(0, Math.min(100, nextY));
        }
      } else {
        nextX = Math.max(0, Math.min(100, nextX));
        nextY = Math.max(0, Math.min(100, nextY));
      }

      lastX = nextX;
      lastY = nextY;
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, pos_x: lastX, pos_y: lastY } : n));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist final position only.
      patchNote(noteId, { pos_x: lastX, pos_y: lastY });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Click on the board (for add-marker mode + eraser-mode background click) ──
  function onBoardClick(e: React.MouseEvent) {
    if (mode === 'add_marker') {
      const { x, y } = eventToPercent(e);
      setNewMarkerDraft({ posX: x, posY: y, color: markerColor });
      setMode('normal'); // exit add-marker mode after placing
    }
    // Eraser-mode clicks on the empty board are no-ops; clicks on notes
    // bubble to the note's handler.
  }

  // ── Create marker after the draft text is entered ───────────────────────
  async function commitMarker(content: string) {
    if (!newMarkerDraft) return;
    const trimmed = content.trim();
    if (!trimmed) { setNewMarkerDraft(null); return; }

    // Clamp the initial drop position to the board, using the in-progress
    // textarea's rendered size as the safety margin. Without this, clicking
    // near the right (or any) edge would post a marker that lives half off
    // the board, and the drag-clamp would only correct it after the first
    // drag.
    let posX = newMarkerDraft.posX;
    let posY = newMarkerDraft.posY;
    const draftEl = document.querySelector('[data-marker-draft="true"]') as HTMLElement | null;
    const board = boardRef.current;
    if (draftEl && board) {
      const dr = draftEl.getBoundingClientRect();
      const br = board.getBoundingClientRect();
      const padPx = 4;
      const halfWPct = ((dr.width  / 2) + padPx) / br.width  * 100;
      const halfHPct = ((dr.height / 2) + padPx) / br.height * 100;
      posX = Math.max(halfWPct, Math.min(100 - halfWPct, posX));
      posY = Math.max(halfHPct, Math.min(100 - halfHPct, posY));
    }

    const res = await fetch(`/api/bookkeeping/books/${bookId}/whiteboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'marker',
        content: trimmed,
        color: newMarkerDraft.color,
        pos_x: posX,
        pos_y: posY,
        rotation: 0,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setNotes(prev => prev.some(p => p.id === d.note.id) ? prev : [d.note as WhiteboardNote, ...prev]);
    }
    setNewMarkerDraft(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const cursorStyle =
    mode === 'add_marker' ? 'cursor-crosshair' :
    'cursor-default';

  return (
    // overflow-visible (not hidden) so stickies pinned near the edge can spill
    // over onto neighbouring cards — that's what gives them the pinned-to-board
    // 3D feel rather than being trapped inside a rectangle. The card claims
    // its own stacking context (z-20) so those overflow-spilling notes render
    // above sibling cards (e.g. Recent Transactions and its sticky thead).
    <div className={`relative z-20 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col overflow-visible ${className ?? 'h-full'}`}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-100 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <StickyNoteIcon size={14} />
        </div>
        <h3 className="text-sm font-semibold text-slate-900 truncate">
          <span className="truncate">{bookName}</span> Whiteboard
        </h3>
        <span className="text-[10px] text-slate-400 shrink-0">
          {loading ? <Loader2 size={10} className="inline-block animate-spin" /> : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Marker colour picker — only shown once "Add text" mode is on,
              mirroring how the sticky modal asks for colour after the button
              click. Default colour is black. */}
          {mode === 'add_marker' && (
            <div className="flex items-center gap-1 mr-1 px-1.5 py-0.5 rounded-full bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 mr-0.5">Pen:</span>
              {MARKER_COLORS.map(m => (
                <Tooltip key={m.value} label={`${m.label} marker`}>
                  <button
                    type="button"
                    onClick={() => setMarkerColor(m.value)}
                    aria-label={`Set marker colour to ${m.label}`}
                    className={`w-4 h-4 rounded-full border transition-all ${markerColor === m.value ? 'border-slate-700 ring-2 ring-slate-300' : 'border-slate-300 hover:border-slate-500'}`}
                    style={{ background: m.ink }}
                  />
                </Tooltip>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => { setStickyModalOpen(true); setMode('normal'); }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          >
            <Plus size={11} /> Sticky
          </button>
          <button
            type="button"
            onClick={() => { setMode(m => m === 'add_marker' ? 'normal' : 'add_marker'); setNewMarkerDraft(null); }}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors ${
              mode === 'add_marker'
                ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <PenTool size={11} /> Add text
          </button>
        </div>
      </div>

      {/* Mode hint strip */}
      {mode === 'add_marker' && (
        <div className="px-3 py-1 text-[10px] font-medium border-b shrink-0 bg-indigo-50 text-indigo-800 border-indigo-200">
          Pick a pen colour, then click anywhere on the board to drop a marker. Press Esc to cancel.
        </div>
      )}

      {/* Board surface — overflow:visible so notes pinned near the edges spill
          over onto neighbouring panels for that 3D pinned-to-board feel. The
          bottom corners are rounded so the surface matches the card shell. */}
      <div
        ref={boardRef}
        onClick={onBoardClick}
        className={`relative flex-1 min-h-0 rounded-b-xl ${cursorStyle}`}
        style={{
          // Cleaner, whiter board — a near-pure white with a barely-there
          // cross-hatch to suggest a physical surface without the grey tint.
          backgroundColor: '#ffffff',
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent, transparent 28px, rgba(148,163,184,0.03) 28px, rgba(148,163,184,0.03) 29px)',
          overflow: 'visible',
        }}
      >
        {/* Existing notes (sticky + marker) */}
        {notes.map(n => n.kind === 'sticky'
          ? (
            <StickyView
              key={n.id}
              note={n}
              mode={mode}
              isOwn={n.author_id === currentUserId}
              onStartDrag={e => startDrag(n.id, e)}
              onPatch={patch => patchNote(n.id, patch)}
              onRequestDelete={() => requestDelete(n)}
            />
          ) : (
            <MarkerView
              key={n.id}
              note={n}
              mode={mode}
              isOwn={n.author_id === currentUserId}
              onStartDrag={e => startDrag(n.id, e)}
              onPatch={patch => patchNote(n.id, patch)}
              onRequestDelete={() => requestDelete(n)}
            />
          )
        )}

        {/* Draft marker — visible only while the user is creating one */}
        {newMarkerDraft && (
          <NewMarkerInput
            draft={newMarkerDraft}
            onCommit={commitMarker}
            onCancel={() => setNewMarkerDraft(null)}
          />
        )}

        {/* Empty-state hint */}
        {!loading && notes.length === 0 && !newMarkerDraft && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
            <StickyNoteIcon size={22} className="text-slate-300 mb-2" />
            <p className="text-xs text-slate-400">
              Drop a sticky note or scribble a marker note for the team.
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Everyone with access to this book can see and edit the board.
            </p>
          </div>
        )}

      </div>

      {/* Add-sticky modal */}
      {stickyModalOpen && (
        <NewStickyModal
          onClose={() => setStickyModalOpen(false)}
          onCreate={async (content, color) => {
            const res = await fetch(`/api/bookkeeping/books/${bookId}/whiteboard`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'sticky',
                content,
                color,
                // Defaults pop new stickies near the centre with a small offset
                // so multiple new ones don't stack pixel-perfectly on top of
                // each other.
                pos_x: 35 + Math.random() * 25,
                pos_y: 30 + Math.random() * 25,
                rotation: 0,
              }),
            });
            if (res.ok) {
              const d = await res.json();
              setNotes(prev => prev.some(p => p.id === d.note.id) ? prev : [d.note as WhiteboardNote, ...prev]);
            }
            setStickyModalOpen(false);
          }}
          currentUserName={currentUserName}
        />
      )}

      {/* Confirm-before-delete lightbox — fires for both stickies and markers,
          whether triggered from the inline ✕ button or anywhere else. */}
      {pendingDelete && (
        <ConfirmDeleteModal
          preview={pendingDelete.preview}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

// ── Delete confirmation lightbox ────────────────────────────────────────────
function ConfirmDeleteModal({
  preview, onCancel, onConfirm,
}: {
  preview: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl w-[380px] shadow-2xl border border-slate-200 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900">Delete this note?</h4>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              You're about to remove the {preview}. This can't be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white"
          >
            <X size={11} /> Delete note
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sticky note view ────────────────────────────────────────────────────────
function StickyView({
  note, mode, isOwn, onStartDrag, onPatch, onRequestDelete,
}: {
  note: WhiteboardNote;
  mode: Mode;
  isOwn: boolean;
  onStartDrag: (e: React.MouseEvent) => void;
  onPatch: (patch: Partial<WhiteboardNote>) => void;
  onRequestDelete: () => void;
}) {
  const colorDef = STICKY_COLORS.find(c => c.value === note.color as StickyColor) ?? STICKY_COLORS[0];
  const rot = noteRotation(note.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  useEffect(() => { if (!editing) setDraft(note.content); }, [note.content, editing]);

  function commitEdit() {
    setEditing(false);
    if (draft.trim() !== note.content) onPatch({ content: draft.trim() });
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `${note.pos_x}%`,
        top:  `${note.pos_y}%`,
        // Lift the whole sticky up by ~ the magnet's height so pos_y refers
        // to where the body starts. That keeps the magnet itself inside the
        // visible board when a sticky is pinned right at the bottom edge.
        transform: 'translate(-50%, -16px)',
        zIndex: editing ? 30 : 5,
      }}
      className="select-none"
    >
      {/* Magnet — drag handle */}
      <div
        onMouseDown={onStartDrag}
        className={`mx-auto ${mode === 'normal' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{
          width: 28, height: 13, borderRadius: 13,
          background: MAGNET_GRADIENTS[note.color as StickyColor] ?? MAGNET_GRADIENTS.yellow,
          boxShadow: '0 2px 6px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.3)',
          marginBottom: -3,
          position: 'relative',
          zIndex: 2,
        }}
      />
      {/* Note body */}
      <div
        className="group relative"
        style={{
          width: 150,
          minHeight: 110,
          background: colorDef.bg,
          padding: '10px 11px 9px',
          transform: `rotate(${rot}deg)`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.07)',
          cursor: editing ? 'text' : 'default',
        }}
      >
        {/* Owner-only edit/delete on hover */}
        {isOwn && !editing && mode === 'normal' && (
          <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setEditing(true)} aria-label="Edit note" className="rounded-full hover:bg-black/10 p-0.5">
              <Pencil size={10} style={{ color: '#9ca3af' }} />
            </button>
            <button onClick={onRequestDelete} aria-label="Delete note" className="rounded-full hover:bg-black/10 p-0.5">
              <X size={11} style={{ color: '#9ca3af' }} />
            </button>
          </div>
        )}
        {editing ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            maxLength={300}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
              if (e.key === 'Escape') { setDraft(note.content); setEditing(false); }
            }}
            style={{
              fontFamily: 'var(--font-caveat)',
              fontSize: '1.05rem',
              lineHeight: 1.5,
              color: '#374151',
              background: 'transparent',
              border: 'none', outline: 'none', resize: 'none',
              width: '100%', minHeight: 72, padding: 0,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          />
        ) : (
          <>
            <p
              style={{
                fontFamily: 'var(--font-caveat)',
                fontSize: '1.05rem', lineHeight: 1.5,
                color: '#374151', marginBottom: 10,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {note.content || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Empty note</span>}
            </p>
            <div
              style={{
                borderTop: `1px solid ${colorDef.border}80`,
                paddingTop: 5,
                fontFamily: 'var(--font-caveat)',
                fontSize: '0.78rem',
                color: '#6b7280',
              }}
            >
              <p style={{ fontWeight: 600 }} className="truncate">{note.author_name ?? '—'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Marker view — handwritten free text ─────────────────────────────────────
function MarkerView({
  note, mode, isOwn, onStartDrag, onPatch, onRequestDelete,
}: {
  note: WhiteboardNote;
  mode: Mode;
  isOwn: boolean;
  onStartDrag: (e: React.MouseEvent) => void;
  onPatch: (patch: Partial<WhiteboardNote>) => void;
  onRequestDelete: () => void;
}) {
  const colorDef = MARKER_COLORS.find(c => c.value === note.color as MarkerColor) ?? MARKER_COLORS[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  useEffect(() => { if (!editing) setDraft(note.content); }, [note.content, editing]);

  function commitEdit() {
    setEditing(false);
    if (draft.trim() !== note.content) onPatch({ content: draft.trim() });
  }

  return (
    <div
      data-note-id={note.id}
      onDoubleClick={() => { if (mode === 'normal' && isOwn) setEditing(true); }}
      onMouseDown={e => {
        // Marker text is itself the drag handle — grab any non-edit click.
        if (editing) return;
        if (mode !== 'normal') return;
        onStartDrag(e);
      }}
      style={{
        position: 'absolute',
        left: `${note.pos_x}%`,
        top:  `${note.pos_y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: editing ? 30 : 4,
        cursor:
          editing            ? 'text' :
          mode === 'normal'  ? 'grab' : 'default',
        maxWidth: 280,
      }}
      className="group select-none"
    >
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          maxLength={500}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
            if (e.key === 'Escape') { setDraft(note.content); setEditing(false); }
          }}
          style={{
            fontFamily: 'var(--font-caveat)',
            fontSize: '1.4rem',
            lineHeight: 1.25,
            color: colorDef.ink,
            background: 'rgba(255,255,255,0.6)',
            border: `1px dashed ${colorDef.ink}`,
            outline: 'none', resize: 'none',
            minWidth: 120, minHeight: 36,
            padding: '2px 4px',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        />
      ) : (
        <>
          {/* Owner-only inline controls — only when not in another mode. */}
          {isOwn && mode === 'normal' && (
            <div className="absolute -top-3.5 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded px-0.5">
              <button onMouseDown={e => e.stopPropagation()} onClick={() => setEditing(true)} aria-label="Edit marker" className="p-0.5 rounded hover:bg-black/10">
                <Pencil size={10} className="text-slate-500" />
              </button>
              <button onMouseDown={e => e.stopPropagation()} onClick={onRequestDelete} aria-label="Delete marker" className="p-0.5 rounded hover:bg-black/10">
                <X size={11} className="text-slate-500" />
              </button>
            </div>
          )}
          <p
            style={{
              fontFamily: 'var(--font-caveat)',
              fontSize: '1.4rem',
              lineHeight: 1.25,
              color: colorDef.ink,
              // A tiny rotation makes the writing feel hand-done, not snapped to grid.
              transform: `rotate(${noteRotation(note.id) * 0.4}deg)`,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'none',
              textShadow: '0 0.4px 0 rgba(0,0,0,0.04)',
            }}
          >
            {note.content || <span style={{ opacity: 0.4, fontStyle: 'italic' }}>(empty)</span>}
          </p>
        </>
      )}
    </div>
  );
}

// ── Inline new-marker draft (renders before the row is committed to DB) ───
function NewMarkerInput({
  draft, onCommit, onCancel,
}: {
  draft: NewMarkerDraft;
  onCommit: (content: string) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState('');
  const ink = MARKER_COLORS.find(c => c.value === draft.color)?.ink ?? '#1f2937';

  return (
    <textarea
      data-marker-draft="true"
      value={content}
      onChange={e => setContent(e.target.value)}
      autoFocus
      maxLength={500}
      onBlur={() => onCommit(content)}
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit(content);
        if (e.key === 'Escape') onCancel();
      }}
      placeholder="…"
      style={{
        position: 'absolute',
        left: `${draft.posX}%`,
        top:  `${draft.posY}%`,
        transform: 'translate(-50%, -50%)',
        fontFamily: 'var(--font-caveat)',
        fontSize: '1.4rem',
        lineHeight: 1.25,
        color: ink,
        background: 'rgba(255,255,255,0.7)',
        border: `1px dashed ${ink}`,
        outline: 'none', resize: 'none',
        minWidth: 140, minHeight: 38,
        padding: '2px 6px',
        zIndex: 25,
      }}
    />
  );
}

// ── New sticky modal ────────────────────────────────────────────────────────
function NewStickyModal({
  onClose, onCreate, currentUserName,
}: {
  onClose: () => void;
  onCreate: (content: string, color: StickyColor) => Promise<void>;
  currentUserName: string | null;
}) {
  void currentUserName;
  const [color, setColor] = useState<StickyColor>('yellow');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bgColor = STICKY_COLORS.find(c => c.value === color)?.bg ?? '#fef9c3';
  const borderColor = STICKY_COLORS.find(c => c.value === color)?.border ?? '#e5e7eb';

  async function handleSubmit() {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try { await onCreate(content.trim(), color); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[360px] shadow-2xl border border-slate-200 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-slate-900">New sticky note</h4>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-slate-500 mb-2">Note colour</p>
        <div className="flex gap-2 mb-3">
          {STICKY_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => setColor(c.value)}
              aria-label={c.label}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: c.bg,
                borderColor: color === c.value ? c.border : 'transparent',
                outline: color === c.value ? `2px solid ${c.border}` : 'none',
                color: '#374151',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          autoFocus
          maxLength={300}
          placeholder="Write your note…"
          className="w-full rounded-lg p-3 resize-none focus:outline-none focus:ring-2"
          style={{
            fontFamily: 'var(--font-caveat)',
            fontSize: '1.15rem',
            lineHeight: 1.55,
            background: bgColor,
            border: `1px solid ${borderColor}`,
            minHeight: '110px',
            color: '#374151',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSubmit();
            if (e.key === 'Escape') onClose();
          }}
        />

        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!content.trim() || submitting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Pin to board
          </button>
        </div>
      </div>
    </div>
  );
}
