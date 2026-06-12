'use client';

/**
 * Whiteboard — the firm-wide Team Noticeboard on the dashboard.
 *
 * Same interaction model as the per-book whiteboard
 * (BookWhiteboardCard): free-form draggable sticky notes plus
 * handwritten marker-pen text, synced in realtime via Supabase.
 *
 *   • Stickies (yellow/pink/blue/green) — added via the "+ Sticky"
 *     button → modal. Draggable by the magnet at the top. Pinned
 *     near an edge they spill over neighbouring panels for a 3D
 *     pinned-to-board feel, but the magnet itself always stays
 *     inside the board.
 *   • Markers (black/blue/red) — "✎ Add text" → pick a colour →
 *     click anywhere on the board to start writing in a Caveat
 *     handwritten font. Marker text is clamped on all four edges
 *     so it can't escape the board.
 *   • Delete — own notes show a ✕ on hover; clicking it asks for
 *     confirmation in a small lightbox.
 *   • Realtime — channel `whiteboard-changes` listening to inserts,
 *     updates and deletes for the firm.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, X, Pencil, Loader2, StickyNote as StickyNoteIcon, PenTool, AlertTriangle,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import Avatar from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase';

type StickyColor = 'yellow' | 'pink' | 'blue' | 'green';
type MarkerColor = 'black' | 'blue' | 'red';

interface WhiteboardMessage {
  id: string;
  content: string;
  color: string;
  author_name: string;
  created_at: string;
  user_id: string;
  kind: 'sticky' | 'marker';
  pos_x: number;
  pos_y: number;
  rotation: number;
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

/** Stable ±4.5° rotation derived from the note id — keeps stickies feeling
 *  pinned-up rather than pixel-grid-perfect. */
/** dd-mm-yyyy from any ISO/datetime string. */
function formatUkDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function noteRotation(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return ((h % 90) - 45) / 10;
}

interface Props {
  initialMessages: WhiteboardMessage[];
  currentUserId: string;
  firmId: string;
  currentUserName: string;
  /** Admins can delete any note (not just their own). */
  isAdmin: boolean;
  /** Map of user_id → avatar URL, for showing the author's photo on stickies. */
  avatarUrls: Record<string, string | null>;
}

type Mode = 'normal' | 'add_marker';
interface NewMarkerDraft { posX: number; posY: number; color: MarkerColor; }
interface PendingDelete { id: string; kind: 'sticky' | 'marker'; preview: string; }

// Fixed board height — tall enough for several rows of stickies but not so
// tall it dominates the dashboard. Stickies pinned near the bottom edge
// intentionally spill over the Recent Clients / Activity / Team strip
// below for the 3D pinned-to-board feel.
const BOARD_HEIGHT_PX = 360;

export default function Whiteboard({ initialMessages, currentUserId, firmId, currentUserName, isAdmin, avatarUrls }: Props) {
  const [messages, setMessages] = useState<WhiteboardMessage[]>(initialMessages);
  const [mode, setMode] = useState<Mode>('normal');
  const [stickyModalOpen, setStickyModalOpen] = useState(false);
  const [markerColor, setMarkerColor] = useState<MarkerColor>('black');
  const [newMarkerDraft, setNewMarkerDraft] = useState<NewMarkerDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [creating, setCreating] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!firmId) return;
    const supabase = createClient();
    const channel = supabase
      .channel('whiteboard-changes')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'whiteboard_messages',
        filter: `firm_id=eq.${firmId}`,
      }, payload => {
        setMessages(prev => {
          const n = payload.new as WhiteboardMessage;
          if (prev.some(m => m.id === n.id)) return prev;
          return [n, ...prev];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'whiteboard_messages',
        filter: `firm_id=eq.${firmId}`,
      }, payload => {
        const n = payload.new as WhiteboardMessage;
        setMessages(prev => prev.map(m => m.id === n.id ? n : m));
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'whiteboard_messages',
      }, payload => {
        const old = payload.old as { id: string };
        setMessages(prev => prev.filter(m => m.id !== old.id));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [firmId]);

  // ── Esc exits modes ──────────────────────────────────────────────────────
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

  // ── Helpers ──────────────────────────────────────────────────────────────
  function eventToPercent(e: { clientX: number; clientY: number }) {
    const board = boardRef.current;
    if (!board) return { x: 50, y: 50 };
    const rect = board.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height) * 100));
    return { x, y };
  }

  const patchNote = useCallback((id: string, body: Partial<WhiteboardMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...body } : m));
    void fetch(`/api/whiteboard/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, []);

  function requestDelete(note: WhiteboardMessage) {
    const preview = note.kind === 'sticky'
      ? `sticky note "${note.content.slice(0, 60) || '(empty)'}"`
      : `marker note "${note.content.slice(0, 60) || '(empty)'}"`;
    setPendingDelete({ id: note.id, kind: note.kind, preview });
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setMessages(prev => prev.filter(m => m.id !== id));
    await fetch(`/api/whiteboard/${id}`, { method: 'DELETE' });
  }

  // Drag handler shared by stickies (magnet) and markers (whole text block).
  function startDrag(noteId: string, e: React.MouseEvent) {
    if (mode !== 'normal') return;
    e.preventDefault();
    e.stopPropagation();
    const board = boardRef.current;
    if (!board) return;
    const startNote = messages.find(m => m.id === noteId);
    if (!startNote) return;
    // Anyone in the firm can move notes around the board (edit/delete are gated
    // separately). No owner check here.

    const rect = board.getBoundingClientRect();
    const startMouseX = ((e.clientX - rect.left) / rect.width)  * 100;
    const startMouseY = ((e.clientY - rect.top)  / rect.height) * 100;
    const offsetX = startNote.pos_x - startMouseX;
    const offsetY = startNote.pos_y - startMouseY;

    let lastX = startNote.pos_x;
    let lastY = startNote.pos_y;
    const isMarker = startNote.kind === 'marker';

    function onMove(ev: MouseEvent) {
      const r = board!.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width)  * 100;
      const my = ((ev.clientY - r.top)  / r.height) * 100;
      let nextX = mx + offsetX;
      let nextY = my + offsetY;

      if (isMarker) {
        // Clamp markers fully inside the board on all four edges (with a
        // small safety pad). Stickies are allowed to overflow because that
        // gives them the 3D pinned feel; the magnet itself stays in.
        const el = document.querySelector(`[data-msg-id="${noteId}"]`) as HTMLElement | null;
        if (el) {
          const er = el.getBoundingClientRect();
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
      setMessages(prev => prev.map(m => m.id === noteId ? { ...m, pos_x: lastX, pos_y: lastY } : m));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      patchNote(noteId, { pos_x: lastX, pos_y: lastY });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onBoardClick(e: React.MouseEvent) {
    if (mode === 'add_marker') {
      const { x, y } = eventToPercent(e);
      setNewMarkerDraft({ posX: x, posY: y, color: markerColor });
      setMode('normal');
    }
  }

  async function commitMarker(content: string) {
    if (!newMarkerDraft) return;
    const trimmed = content.trim();
    if (!trimmed) { setNewMarkerDraft(null); return; }

    // Clamp initial drop position to the board using the in-progress
    // textarea's rendered size — otherwise a click near any edge would
    // post a marker that lives half off-board.
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

    setCreating(true);
    try {
      const res = await fetch('/api/whiteboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'marker',
          content: trimmed,
          color: newMarkerDraft.color,
          author_name: currentUserName,
          pos_x: posX,
          pos_y: posY,
          rotation: 0,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setMessages(prev => prev.some(m => m.id === d.message.id) ? prev : [d.message as WhiteboardMessage, ...prev]);
      }
    } finally {
      setCreating(false);
      setNewMarkerDraft(null);
    }
  }

  async function createSticky(content: string, color: StickyColor) {
    setCreating(true);
    try {
      const res = await fetch('/api/whiteboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'sticky',
          content,
          color,
          author_name: currentUserName,
          // Default position: scattered around the upper-centre with a small
          // random offset so multiple new stickies don't stack pixel-perfectly.
          pos_x: 30 + Math.random() * 30,
          pos_y: 18 + Math.random() * 25,
          rotation: 0,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setMessages(prev => prev.some(m => m.id === d.message.id) ? prev : [d.message as WhiteboardMessage, ...prev]);
      }
    } finally {
      setCreating(false);
      setStickyModalOpen(false);
    }
  }

  const cursorStyle =
    mode === 'add_marker' ? 'cursor-crosshair' :
    'cursor-default';

  return (
    <>
      {/* The card needs its own stacking context so the overflow-spilling
          stickies render above sibling cards (Recent Clients / Team / etc.). */}
      <div className="relative z-20 glass rounded-xl overflow-visible">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
            <StickyNoteIcon size={15} className="text-[var(--accent)]" />
          </div>
          <span className="text-sm font-semibold text-[var(--text-primary)]">Team Noticeboard</span>
          <span className="text-xs text-[var(--text-muted)]">
            {messages.length} {messages.length === 1 ? 'note' : 'notes'}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Marker colour picker — appears only while Add text is active. */}
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
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 font-medium"
            >
              <Plus size={13} strokeWidth={2.5} /> Sticky
            </button>
            <button
              type="button"
              onClick={() => { setMode(m => m === 'add_marker' ? 'normal' : 'add_marker'); setNewMarkerDraft(null); }}
              className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                mode === 'add_marker'
                  ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                  : 'border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-slate-50'
              }`}
            >
              <PenTool size={13} strokeWidth={2.5} /> Add text
            </button>
          </div>
        </div>

        {/* Mode hint */}
        {mode === 'add_marker' && (
          <div className="px-5 py-1 text-[10px] font-medium bg-indigo-50 text-indigo-800 border-y border-indigo-200">
            Pick a pen colour, then click anywhere on the board to drop a marker. Press Esc to cancel.
          </div>
        )}

        {/* Board surface */}
        <div
          ref={boardRef}
          onClick={onBoardClick}
          className={`relative rounded-b-xl ${cursorStyle}`}
          style={{
            height: `${BOARD_HEIGHT_PX}px`,
            backgroundColor: 'rgba(255, 255, 255, 0.4)',
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 28px, rgba(148,163,184,0.03) 28px, rgba(148,163,184,0.03) 29px)',
            overflow: 'visible',
          }}
        >
          {messages.map(m => m.kind === 'sticky'
            ? (
              <StickyView
                key={m.id}
                message={m}
                isOwn={m.user_id === currentUserId}
                isAdmin={isAdmin}
                avatarUrl={avatarUrls[m.user_id] ?? null}
                onStartDrag={e => startDrag(m.id, e)}
                onPatch={patch => patchNote(m.id, patch)}
                onRequestDelete={() => requestDelete(m)}
              />
            ) : (
              <MarkerView
                key={m.id}
                message={m}
                mode={mode}
                isOwn={m.user_id === currentUserId}
                isAdmin={isAdmin}
                avatarUrl={avatarUrls[m.user_id] ?? null}
                onStartDrag={e => startDrag(m.id, e)}
                onPatch={patch => patchNote(m.id, patch)}
                onRequestDelete={() => requestDelete(m)}
              />
            )
          )}

          {newMarkerDraft && (
            <NewMarkerInput
              draft={newMarkerDraft}
              onCommit={commitMarker}
              onCancel={() => setNewMarkerDraft(null)}
            />
          )}

          {messages.length === 0 && !newMarkerDraft && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
              <StickyNoteIcon size={26} className="text-slate-300 mb-2" />
              <p className="text-xs text-[var(--text-muted)]">
                Drop a sticky note or scribble a marker note for the team.
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                Everyone in the firm can see and post on the board.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add-sticky modal */}
      {stickyModalOpen && (
        <NewStickyModal
          submitting={creating}
          onClose={() => setStickyModalOpen(false)}
          onCreate={createSticky}
        />
      )}

      {/* Confirm-before-delete lightbox */}
      {pendingDelete && (
        <ConfirmDeleteModal
          preview={pendingDelete.preview}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}

// ── Sticky note view ────────────────────────────────────────────────────────
function StickyView({
  message, isOwn, isAdmin, avatarUrl, onStartDrag, onPatch, onRequestDelete,
}: {
  message: WhiteboardMessage;
  isOwn: boolean;
  isAdmin: boolean;
  avatarUrl: string | null;
  onStartDrag: (e: React.MouseEvent) => void;
  onPatch: (patch: Partial<WhiteboardMessage>) => void;
  onRequestDelete: () => void;
}) {
  const colorDef = STICKY_COLORS.find(c => c.value === message.color as StickyColor) ?? STICKY_COLORS[0];
  const rot = noteRotation(message.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  useEffect(() => { if (!editing) setDraft(message.content); }, [message.content, editing]);

  function commitEdit() {
    setEditing(false);
    if (draft.trim() !== message.content) onPatch({ content: draft.trim() });
  }

  return (
    <div
      data-msg-id={message.id}
      style={{
        position: 'absolute',
        left: `${message.pos_x}%`,
        top:  `${message.pos_y}%`,
        // Lift the whole sticky so pos_y refers to where the body starts —
        // keeps the magnet itself inside the board when pinned at the bottom.
        transform: 'translate(-50%, -16px)',
        zIndex: editing ? 30 : 5,
      }}
      className="select-none"
    >
      {/* Magnet — drag handle (anyone in the firm can move notes) */}
      <div
        onMouseDown={onStartDrag}
        className="mx-auto cursor-grab active:cursor-grabbing"
        style={{
          width: 28, height: 13, borderRadius: 13,
          background: MAGNET_GRADIENTS[message.color as StickyColor] ?? MAGNET_GRADIENTS.yellow,
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
          minHeight: 120,
          background: colorDef.bg,
          padding: '10px 11px 9px',
          transform: `rotate(${rot}deg)`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.07)',
          cursor: editing ? 'text' : 'default',
        }}
      >
        {(isOwn || isAdmin) && !editing && (
          <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {isOwn && (
              <Tooltip label="Edit note">
                <button onClick={() => setEditing(true)} aria-label="Edit note" className="rounded-full hover:bg-black/10 p-0.5">
                  <Pencil size={10} style={{ color: '#9ca3af' }} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={isOwn ? 'Remove note' : 'Remove note (admin)'}>
              <button onClick={onRequestDelete} aria-label="Remove note" className="rounded-full hover:bg-black/10 p-0.5">
                <X size={11} style={{ color: '#9ca3af' }} />
              </button>
            </Tooltip>
          </div>
        )}
        {editing ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            maxLength={500}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
              if (e.key === 'Escape') { setDraft(message.content); setEditing(false); }
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
              {message.content || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Empty note</span>}
            </p>
            <div
              style={{
                borderTop: `1px solid ${colorDef.border}80`,
                paddingTop: 5,
                fontFamily: 'var(--font-caveat)',
                fontSize: '0.8rem',
                color: '#6b7280',
                lineHeight: 1.4,
              }}
              className="flex items-end justify-between gap-2"
            >
              <div className="min-w-0">
                <p style={{ fontWeight: 600 }} className="truncate">{message.author_name || '—'}</p>
                {message.created_at && (
                  <p style={{ fontSize: '0.7rem', opacity: 0.8 }} className="truncate">{formatUkDate(message.created_at)}</p>
                )}
              </div>
              <div className="shrink-0">
                <Avatar name={message.author_name} avatarUrl={avatarUrl} size={22} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Marker view — handwritten free text ─────────────────────────────────────
function MarkerView({
  message, mode, isOwn, isAdmin, avatarUrl, onStartDrag, onPatch, onRequestDelete,
}: {
  message: WhiteboardMessage;
  mode: Mode;
  isOwn: boolean;
  isAdmin: boolean;
  avatarUrl: string | null;
  onStartDrag: (e: React.MouseEvent) => void;
  onPatch: (patch: Partial<WhiteboardMessage>) => void;
  onRequestDelete: () => void;
}) {
  const colorDef = MARKER_COLORS.find(c => c.value === message.color as MarkerColor) ?? MARKER_COLORS[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  useEffect(() => { if (!editing) setDraft(message.content); }, [message.content, editing]);

  function commitEdit() {
    setEditing(false);
    if (draft.trim() !== message.content) onPatch({ content: draft.trim() });
  }

  return (
    <div
      data-msg-id={message.id}
      onDoubleClick={() => { if (mode === 'normal' && isOwn) setEditing(true); }}
      onMouseDown={e => {
        if (editing) return;
        if (mode !== 'normal') return;
        onStartDrag(e); // anyone in the firm can move notes
      }}
      style={{
        position: 'absolute',
        left: `${message.pos_x}%`,
        top:  `${message.pos_y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: editing ? 30 : 4,
        cursor: editing ? 'text' : mode === 'normal' ? 'grab' : 'default',
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
            if (e.key === 'Escape') { setDraft(message.content); setEditing(false); }
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
          {(isOwn || isAdmin) && mode === 'normal' && (
            <div className="absolute -top-3.5 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded px-0.5">
              {isOwn && (
                <button onMouseDown={e => e.stopPropagation()} onClick={() => setEditing(true)} aria-label="Edit marker" className="p-0.5 rounded hover:bg-black/10">
                  <Pencil size={10} className="text-slate-500" />
                </button>
              )}
              <button onMouseDown={e => e.stopPropagation()} onClick={onRequestDelete} aria-label={isOwn ? 'Delete marker' : 'Delete marker (admin)'} className="p-0.5 rounded hover:bg-black/10">
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
              transform: `rotate(${noteRotation(message.id) * 0.4}deg)`,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'none',
              textShadow: '0 0.4px 0 rgba(0,0,0,0.04)',
            }}
          >
            {message.content || <span style={{ opacity: 0.4, fontStyle: 'italic' }}>(empty)</span>}
          </p>
          {/* Footer — line + author name + date + profile pic, like the stickies */}
          <div
            style={{
              borderTop: '1px solid rgba(0,0,0,0.12)',
              marginTop: 4,
              paddingTop: 3,
              fontFamily: 'var(--font-caveat)',
              fontSize: '0.78rem',
              color: '#6b7280',
              lineHeight: 1.3,
            }}
            className="flex items-end justify-between gap-2"
          >
            <div className="min-w-0">
              <p style={{ fontWeight: 600 }} className="truncate">{message.author_name || '—'}</p>
              {message.created_at && (
                <p style={{ fontSize: '0.68rem', opacity: 0.8 }} className="truncate">{formatUkDate(message.created_at)}</p>
              )}
            </div>
            <div className="shrink-0">
              <Avatar name={message.author_name} avatarUrl={avatarUrl} size={20} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Inline new-marker draft ─────────────────────────────────────────────────
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

// ── New-sticky modal ────────────────────────────────────────────────────────
function NewStickyModal({
  submitting, onClose, onCreate,
}: {
  submitting: boolean;
  onClose: () => void;
  onCreate: (content: string, color: StickyColor) => Promise<void>;
}) {
  const [color, setColor] = useState<StickyColor>('yellow');
  const [content, setContent] = useState('');
  const bgColor = STICKY_COLORS.find(c => c.value === color)?.bg ?? '#fef9c3';
  const borderColor = STICKY_COLORS.find(c => c.value === color)?.border ?? '#e5e7eb';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[var(--bg-card-solid)] rounded-2xl p-6 w-[360px] shadow-2xl border border-[var(--border)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">New sticky note</h4>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-2">Note colour</p>
        <div className="flex gap-2 mb-3 flex-wrap">
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
          maxLength={500}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onCreate(content.trim(), color);
            if (e.key === 'Escape') onClose();
          }}
        />

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center text-xs py-2" disabled={submitting}>
            Cancel
          </button>
          <button
            onClick={() => void onCreate(content.trim(), color)}
            disabled={!content.trim() || submitting}
            className="btn-primary flex-1 justify-center text-xs py-2 inline-flex items-center gap-1.5"
          >
            {submitting ? <><Loader2 size={11} className="animate-spin" /> Pinning…</> : 'Pin to board'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm-delete lightbox ────────────────────────────────────────────────
function ConfirmDeleteModal({
  preview, onCancel, onConfirm,
}: {
  preview: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[1500]"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="bg-[var(--bg-card-solid)] rounded-2xl w-[380px] shadow-2xl border border-[var(--border)] p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Delete this note?</h4>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 break-words">
              You're about to remove the {preview}. This can't be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
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
