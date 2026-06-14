'use client';

import { useState } from 'react';
import { Heart, MoreHorizontal, Pencil, Trash2, Flag } from 'lucide-react';
import { useEffect, useRef } from 'react';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import { communityDisplayName, linkifyPlainText } from '@/lib/community';
import type { CommunityComment } from './types';

interface Props {
  comment: CommunityComment;
  /** When set, the current viewer authored this comment — show edit/delete. */
  isAuthor: boolean;
  onChange: (next: CommunityComment) => void;
  onDelete: () => void;
}

export default function CommentItem({ comment, isAuthor, onChange, onDelete }: Props) {
  const [editing, setEditing]       = useState(false);
  const [draftBody, setDraftBody]   = useState(comment.body);

  const author = communityDisplayName(comment.author?.full_name ?? null, comment.author?.email ?? null);

  async function toggleLike() {
    const liked = comment.viewerLiked;
    onChange({ ...comment, viewerLiked: !liked, like_count: comment.like_count + (liked ? -1 : 1) });
    try {
      await fetch(`/api/community/comments/${comment.id}/like`, { method: liked ? 'DELETE' : 'POST' });
    } catch {
      onChange({ ...comment, viewerLiked: liked, like_count: comment.like_count + (liked ? 1 : -1) });
    }
  }

  async function saveEdit() {
    const trimmed = draftBody.trim();
    if (!trimmed || trimmed === comment.body) { setEditing(false); return; }
    const res = await fetch(`/api/community/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: trimmed }),
    });
    if (res.ok) {
      onChange({ ...comment, body: trimmed, edited_at: new Date().toISOString() });
      setEditing(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this comment?')) return;
    const res = await fetch(`/api/community/comments/${comment.id}`, { method: 'DELETE' });
    if (res.ok) onDelete();
  }

  async function handleReport() {
    const reason = prompt('Briefly describe the issue with this comment:');
    if (reason === null) return;
    await fetch('/api/community/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId: comment.id, reason: reason.trim() || null }),
    });
    alert('Thanks — the SMITH team will review your report.');
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar name={author} avatarUrl={comment.author?.avatar_url ?? null} size={22} userId={comment.author?.id} />
        <span className="text-xs font-medium text-[var(--text-primary)]">{author}</span>
        <span className="text-xs text-[var(--text-muted)]">·</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {new Date(comment.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {comment.edited_at && ' · edited'}
        </span>
        <div className="ml-auto">
          <ActionMenu
            isAuthor={isAuthor}
            onEdit={() => { setEditing(true); setDraftBody(comment.body); }}
            onDelete={handleDelete}
            onReport={handleReport}
          />
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            maxLength={5000}
            rows={3}
            className="input-base resize-none"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-xs">Cancel</button>
            <button onClick={saveEdit} disabled={!draftBody.trim()} className="btn-primary text-xs">Save</button>
          </div>
        </div>
      ) : (
        <div
          className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: linkifyPlainText(comment.body) }}
        />
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
        <button
          onClick={toggleLike}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ${
            comment.viewerLiked ? 'text-red-600' : 'hover:text-red-600'
          }`}
        >
          <Heart size={11} className={comment.viewerLiked ? 'fill-red-500 text-red-500' : ''} />
          {comment.like_count}
        </button>
      </div>
    </div>
  );
}

function ActionMenu({
  isAuthor, onEdit, onDelete, onReport,
}: {
  isAuthor: boolean;
  onEdit:   () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Tooltip label="More">
        <button
          onClick={() => setOpen(v => !v)}
          aria-label="More options"
          className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"
        >
          <MoreHorizontal size={14} />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-40 glass-solid rounded-lg border border-[var(--border)] shadow-xl overflow-hidden">
          {isAuthor && (
            <>
              <button
                onClick={() => { setOpen(false); onEdit(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)]"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                onClick={() => { setOpen(false); onDelete(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
              >
                <Trash2 size={12} /> Delete
              </button>
              <div className="border-t border-[var(--border)]" />
            </>
          )}
          <button
            onClick={() => { setOpen(false); onReport(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)]"
          >
            <Flag size={12} className="text-amber-500" /> Report
          </button>
        </div>
      )}
    </div>
  );
}
