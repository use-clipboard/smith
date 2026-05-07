'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, MessageSquare, Send, Pencil, Trash2, Check, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepComment {
  id: string;
  content: string;
  created_at: string;
  user: { id: string; full_name: string | null; email: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function initials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const AVATAR_COLOURS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500',
  'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500',
];

export function avatarColour(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

export function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  taskId: string;
  stepId: string;
  currentUserId: string;
  /** compact = narrower sidebar layout (stacked); default = wide list-row layout (side-by-side) */
  compact?: boolean;
}

export default function StepComments({ taskId, stepId, currentUserId, compact = false }: Props) {
  const [comments, setComments]     = useState<StepComment[] | null>(null);
  const [loading, setLoading]       = useState(false);
  const [draft, setDraft]           = useState('');
  const [posting, setPosting]       = useState(false);
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editDraft, setEditDraft]   = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchComments = useCallback(async () => {
    if (loading || comments !== null) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/steps/${stepId}/comments`);
      if (r.ok) { const d = await r.json(); setComments(d.comments ?? []); }
    } finally { setLoading(false); }
  }, [taskId, stepId, loading, comments]);

  // Auto-load comments when the component mounts (i.e. when the panel/chevron opens)
  useEffect(() => { fetchComments(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/steps/${stepId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (r.ok) {
        const d = await r.json();
        setComments(prev => [...(prev ?? []), d.comment]);
        setDraft('');
      }
    } finally { setPosting(false); }
  }

  function startEdit(c: StepComment) {
    setEditingId(c.id);
    setEditDraft(c.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function saveEdit(commentId: string) {
    const text = editDraft.trim();
    if (!text || savingEdit) return;
    setSavingEdit(true);
    try {
      const r = await fetch(
        `/api/tasks/${taskId}/steps/${stepId}/comments/${commentId}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) },
      );
      if (r.ok) {
        const d = await r.json();
        setComments(prev => prev?.map(c => c.id === commentId ? d.comment : c) ?? null);
        setEditingId(null);
        setEditDraft('');
      }
    } finally { setSavingEdit(false); }
  }

  async function deleteComment(commentId: string) {
    setDeletingId(commentId);
    try {
      const r = await fetch(
        `/api/tasks/${taskId}/steps/${stepId}/comments/${commentId}`,
        { method: 'DELETE' },
      );
      if (r.ok || r.status === 204) {
        setComments(prev => prev?.filter(c => c.id !== commentId) ?? null);
      }
    } finally { setDeletingId(null); }
  }

  function handleOpenClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(v => !v);
    if (!open) fetchComments();
  }

  function handleInputClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) { setOpen(true); fetchComments(); }
  }

  const count = comments?.length ?? 0;

  return (
    <div className={compact ? 'w-full' : 'flex-1 min-w-0'} onClick={e => e.stopPropagation()}>
      {/* Ghost summary row — always visible */}
      <div className="flex items-center gap-2">
        <div
          className="flex-1 flex items-center gap-1.5 rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50 px-2 py-1 cursor-text transition-colors group/cinput"
          onClick={handleInputClick}
        >
          {loading
            ? <Loader2 className="h-3.5 w-3.5 text-gray-200 animate-spin flex-shrink-0" />
            : <MessageSquare className="h-3.5 w-3.5 text-gray-300 group-hover/cinput:text-indigo-400 flex-shrink-0 transition-colors" />
          }
          {comments && count > 0 ? (
            <span className="text-xs text-gray-400 truncate">
              <span className="font-medium text-gray-600">
                {comments[count - 1].user?.full_name?.split(' ')[0] ?? 'Someone'}:
              </span>{' '}
              {comments[count - 1].content}
            </span>
          ) : (
            <span className="text-xs text-gray-300">{loading ? 'Loading…' : 'Add a note…'}</span>
          )}
        </div>
        {count > 0 && (
          <button
            onClick={handleOpenClick}
            className="flex-shrink-0 text-[10px] font-semibold text-gray-400 hover:text-indigo-600 bg-gray-100 hover:bg-indigo-50 px-1.5 py-0.5 rounded-full transition-colors"
          >
            {count}
          </button>
        )}
      </div>

      {/* Expanded thread */}
      {open && (
        <div className="mt-2 ml-1 border-l-2 border-indigo-100 pl-3 space-y-2">
          {loading && (
            <div className="flex items-center gap-1.5 py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-300" />
              <span className="text-xs text-gray-400">Loading…</span>
            </div>
          )}

          {comments?.map(c => {
            const isOwn      = c.user?.id === currentUserId;
            const isEditing  = editingId === c.id;
            const isDeleting = deletingId === c.id;

            return (
              <div key={c.id} className="flex gap-2 group/comment">
                <div className={`h-5 w-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white mt-0.5 ${avatarColour(c.user?.id ?? 'x')}`}>
                  {initials(c.user?.full_name, c.user?.email ?? '?').slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-gray-700">
                      {c.user?.full_name?.split(' ')[0] ?? c.user?.email ?? 'Unknown'}
                    </span>
                    <span className="text-[10px] text-gray-400">{timeAgo(c.created_at)}</span>
                    {isOwn && !isEditing && !isDeleting && (
                      <span className="ml-auto flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); startEdit(c); }}
                          title="Edit note"
                          className="p-0.5 rounded text-gray-300 hover:text-indigo-500 transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteComment(c.id); }}
                          title="Delete note"
                          className="p-0.5 rounded text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {isDeleting && <Loader2 className="ml-1 h-3 w-3 animate-spin text-gray-300" />}
                  </div>

                  {isEditing ? (
                    <form
                      onSubmit={e => { e.preventDefault(); e.stopPropagation(); saveEdit(c.id); }}
                      className="flex gap-1.5 mt-1"
                    >
                      <input
                        autoFocus
                        type="text"
                        value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 text-xs border border-indigo-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white min-w-0"
                      />
                      <button
                        type="submit"
                        disabled={!editDraft.trim() || savingEdit}
                        title="Save"
                        className="flex-shrink-0 flex items-center justify-center h-7 w-7 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
                      >
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); cancelEdit(); }}
                        title="Cancel"
                        className="flex-shrink-0 flex items-center justify-center h-7 w-7 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-lg transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs text-gray-600 leading-snug break-words">{c.content}</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Post form */}
          <form onSubmit={postComment} className="flex gap-1.5 pt-1">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Write a note…"
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white min-w-0"
            />
            <button
              type="submit"
              disabled={!draft.trim() || posting}
              className="flex-shrink-0 flex items-center justify-center h-7 w-7 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
            >
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
