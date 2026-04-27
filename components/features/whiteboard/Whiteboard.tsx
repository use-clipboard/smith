'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, X, StickyNote as StickyNoteIcon, Pencil, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase';

type NoteColor = 'yellow' | 'pink' | 'blue';

interface WhiteboardMessage {
  id: string;
  content: string;
  color: NoteColor;
  author_name: string;
  created_at: string;
  user_id: string;
}

const COLOR_OPTIONS: { value: NoteColor; bg: string; border: string; label: string }[] = [
  { value: 'yellow', bg: '#fef9c3', border: '#fde047', label: 'Yellow' },
  { value: 'pink',   bg: '#fce7f3', border: '#f9a8d4', label: 'Pink'   },
  { value: 'blue',   bg: '#dbeafe', border: '#93c5fd', label: 'Blue'   },
];

const MAGNET_GRADIENTS: Record<NoteColor, string> = {
  yellow: 'radial-gradient(ellipse at 35% 30%, #fbbf24, #d97706 55%, #92400e)',
  pink:   'radial-gradient(ellipse at 35% 30%, #f472b6, #db2777 55%, #9d174d)',
  blue:   'radial-gradient(ellipse at 35% 30%, #60a5fa, #2563eb 55%, #1e3a8a)',
};

/** Stable ±4.5° rotation derived from the note's UUID */
function noteRotation(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return ((h % 90) - 45) / 10;
}

function formatPostedDate(dateStr: string): string {
  const date = new Date(dateStr);
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return 'just now';
  return `Posted ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

interface Props {
  initialMessages: WhiteboardMessage[];
  currentUserId: string;
  firmId: string;
  currentUserName: string;
}

export default function Whiteboard({ initialMessages, currentUserId, firmId, currentUserName }: Props) {
  const [messages, setMessages]         = useState<WhiteboardMessage[]>(initialMessages);
  const [showAdd, setShowAdd]           = useState(false);
  const [content, setContent]           = useState('');
  const [color, setColor]               = useState<NoteColor>('yellow');
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Real-time subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!firmId) return;
    const supabase = createClient();
    const channel = supabase
      .channel('whiteboard-changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whiteboard_messages',
        filter: `firm_id=eq.${firmId}`,
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          return [payload.new as WhiteboardMessage, ...prev];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whiteboard_messages',
        filter: `firm_id=eq.${firmId}`,
      }, (payload) => {
        setMessages(prev => prev.map(m =>
          m.id === (payload.new as WhiteboardMessage).id ? (payload.new as WhiteboardMessage) : m
        ));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'whiteboard_messages',
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== (payload.old as { id: string }).id));
      })
      .subscribe((status, err) => {
        if (err) console.warn('Whiteboard realtime:', err);
      });

    return () => { supabase.removeChannel(channel); };
  }, [firmId]);

  const openAdd = () => {
    setError('');
    setContent('');
    setColor('yellow');
    setShowAdd(true);
  };

  const closeAdd = useCallback(() => {
    setShowAdd(false);
    setError('');
  }, []);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/whiteboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), color, author_name: currentUserName }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; message?: WhiteboardMessage };
      if (!res.ok) {
        setError(j.error ?? 'Something went wrong. Please try again.');
        return;
      }
      // Add the new note to state immediately — don't wait for real-time subscription
      const message = j.message!;
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [message, ...prev];
      });
      setContent('');
      setShowAdd(false);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const handleEdit = useCallback(async (id: string, newContent: string) => {
    // Optimistic update
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
    const res = await fetch(`/api/whiteboard/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    if (!res.ok) {
      // Revert: reload all messages
      const r = await fetch('/api/whiteboard');
      if (r.ok) {
        const j = await r.json() as { messages: WhiteboardMessage[] };
        setMessages(j.messages);
      }
    }
  }, []);

  // ── Delete ────────────────────────────────────────────────────────────────
  const requestDelete = (id: string) => setConfirmDeleteId(id);

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    setMessages(prev => prev.filter(m => m.id !== id));
    const res = await fetch(`/api/whiteboard/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const r = await fetch('/api/whiteboard');
      if (r.ok) {
        const j = await r.json() as { messages: WhiteboardMessage[] };
        setMessages(j.messages);
      }
    }
  };

  const bgColor = COLOR_OPTIONS.find(c => c.value === color)?.bg ?? '#fef9c3';

  return (
    <>
      {/* ── Card ─────────────────────────────────────────────────────────── */}
      <div className="glass rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <StickyNoteIcon size={15} className="text-[var(--accent)]" />
            </div>
            <div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Team Noticeboard</span>
              {messages.length > 0 && (
                <span className="ml-2 text-xs text-[var(--text-muted)]">
                  {messages.length} note{messages.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus size={13} strokeWidth={2.5} />
            Add note
          </button>
        </div>

        {/* Notes area */}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <div className="text-[var(--text-muted)] opacity-40">
              <StickyNoteIcon size={22} />
            </div>
            <p className="text-xs text-[var(--text-muted)]">No notes yet. Be the first to add one.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-5 pt-1 pb-2">
            {messages.map(msg => (
              <StickyNoteCard
                key={msg.id}
                message={msg}
                isOwn={msg.user_id === currentUserId}
                onDelete={() => requestDelete(msg.id)}
                onEdit={(newContent) => handleEdit(msg.id, newContent)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Add-note modal (fixed, so it always centres in the viewport) ──── */}
      {showAdd && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeAdd(); }}
        >
          <div
            className="bg-[var(--bg-card-solid)] rounded-2xl p-6 w-[360px] shadow-2xl border border-[var(--border)]"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">New sticky note</h4>
              <button
                onClick={closeAdd}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors rounded-md p-0.5 hover:bg-[var(--accent-light)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Colour picker */}
            <p className="text-xs text-[var(--text-muted)] mb-2">Note colour</p>
            <div className="flex gap-3 mb-4">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className="transition-all duration-150 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
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

            {/* Textarea — Caveat font only here (note content) */}
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
                border: `1px solid ${COLOR_OPTIONS.find(c => c.value === color)?.border ?? '#e5e7eb'}`,
                minHeight: '110px',
                color: '#374151',
              }}
              maxLength={200}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                if (e.key === 'Escape') closeAdd();
              }}
            />

            <div className="flex items-center justify-between mt-1 mb-5">
              {error
                ? <p className="text-xs text-[var(--danger)]">{error}</p>
                : <span />
              }
              <p className="text-xs text-[var(--text-muted)] ml-auto">{content.length}/200</p>
            </div>

            <div className="flex gap-2">
              <button onClick={closeAdd} className="btn-secondary flex-1 justify-center text-xs py-2">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!content.trim() || submitting}
                className="btn-primary flex-1 justify-center text-xs py-2"
              >
                {submitting ? 'Pinning…' : 'Pin note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm-delete modal ─────────────────────────────────────────── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-[var(--bg-card-solid)] rounded-2xl p-6 w-[340px] shadow-2xl border border-[var(--border)]"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Remove note?</h4>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              This note will be permanently removed from the noticeboard for everyone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="btn-secondary flex-1 justify-center text-xs py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 justify-center text-xs py-2 rounded-lg font-medium text-white transition-colors"
                style={{ background: 'var(--danger)' }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sticky note card ──────────────────────────────────────────────────────────
function StickyNoteCard({
  message,
  isOwn,
  onDelete,
  onEdit,
}: {
  message: WhiteboardMessage;
  isOwn: boolean;
  onDelete: () => void;
  onEdit: (newContent: string) => Promise<void>;
}) {
  const [editing, setEditing]         = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [saving, setSaving]           = useState(false);

  const rotation = noteRotation(message.id);
  const colorDef = COLOR_OPTIONS.find(c => c.value === message.color) ?? COLOR_OPTIONS[0];

  // Keep local draft in sync with external real-time updates, but only when not actively editing
  useEffect(() => {
    if (!editing) setEditContent(message.content);
  }, [message.content, editing]);

  async function handleSave() {
    const trimmed = editContent.trim();
    if (!trimmed) return;
    if (trimmed === message.content) { setEditing(false); return; }
    setSaving(true);
    try {
      await onEdit(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditContent(message.content);
    setEditing(false);
  }

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ width: '150px', marginTop: '6px' }}
    >
      {/* Magnet */}
      <div
        style={{
          width: '28px',
          height: '13px',
          borderRadius: '13px',
          background: MAGNET_GRADIENTS[message.color],
          boxShadow: '0 2px 6px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.3)',
          zIndex: 2,
          position: 'relative',
          marginBottom: '-3px',
          flexShrink: 0,
        }}
      />

      {/* Note body */}
      <div
        className="group relative"
        style={{
          width: '150px',
          minHeight: '120px',
          background: colorDef.bg,
          padding: '10px 11px 9px',
          transform: `rotate(${rotation}deg)`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.07)',
          zIndex: editing ? 10 : 1,
          cursor: editing ? 'text' : 'default',
        }}
      >
        {/* Own-note controls — pencil + X, appear on hover */}
        {isOwn && !editing && (
          <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setEditing(true)}
              className="rounded-full hover:bg-black/10 p-0.5"
              title="Edit note"
            >
              <Pencil size={10} style={{ color: '#9ca3af' }} />
            </button>
            <button
              onClick={onDelete}
              className="rounded-full hover:bg-black/10 p-0.5"
              title="Remove note"
            >
              <X size={11} style={{ color: '#9ca3af' }} />
            </button>
          </div>
        )}

        {editing ? (
          /* ── Edit mode ──────────────────────────────────── */
          <>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              autoFocus
              maxLength={200}
              style={{
                fontFamily: 'var(--font-caveat)',
                fontSize: '1.05rem',
                lineHeight: 1.5,
                color: '#374151',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                width: '100%',
                minHeight: '72px',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                padding: 0,
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
            />
            {/* Edit footer */}
            <div
              style={{
                borderTop: `1px solid ${colorDef.border}80`,
                paddingTop: '5px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontFamily: 'var(--font-caveat)', fontSize: '0.72rem', color: '#9ca3af' }}>
                {editContent.length}/200
              </span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <button
                  onClick={handleCancel}
                  className="rounded hover:bg-black/10 p-0.5"
                  title="Cancel (Esc)"
                >
                  <X size={11} style={{ color: '#9ca3af' }} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editContent.trim()}
                  className="rounded hover:bg-black/10 p-0.5 disabled:opacity-40"
                  title="Save (Ctrl+Enter)"
                >
                  <Check size={11} style={{ color: saving ? '#9ca3af' : '#16a34a' }} />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ── Read mode ──────────────────────────────────── */
          <>
            <p
              style={{
                fontFamily: 'var(--font-caveat)',
                fontSize: '1.05rem',
                lineHeight: 1.5,
                color: '#374151',
                wordBreak: 'break-word',
                marginBottom: '10px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {message.content}
            </p>

            <div
              style={{
                borderTop: `1px solid ${colorDef.border}80`,
                paddingTop: '5px',
                fontFamily: 'var(--font-caveat)',
                fontSize: '0.8rem',
                color: '#6b7280',
                lineHeight: 1.4,
              }}
            >
              <p style={{ fontWeight: 600 }} className="truncate">{message.author_name}</p>
              <p>{formatPostedDate(message.created_at)}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
