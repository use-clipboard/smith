'use client';

import { useState } from 'react';
import { X, Loader2, MessagesSquare } from 'lucide-react';
import { COMMUNITY_CATEGORIES } from '@/lib/community';
import type { CommunityPost } from './types';

interface Props {
  onClose:   () => void;
  onCreated: (post: CommunityPost) => void;
  /** When set, the modal opens in edit mode pre-filled with this post's fields. */
  existing?: CommunityPost;
}

export default function NewPostModal({ onClose, onCreated, existing }: Props) {
  const isEdit = !!existing;
  const [title, setTitle]       = useState(existing?.title ?? '');
  const [body, setBody]         = useState(existing?.body ?? '');
  const [category, setCategory] = useState<string>(existing?.category ?? 'general');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are both required.');
      return;
    }
    setSaving(true); setError(null);
    try {
      const url    = isEdit ? `/api/community/posts/${existing!.id}` : '/api/community/posts';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), category }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      if (isEdit) {
        onCreated({
          ...existing!,
          title: title.trim(),
          body: body.trim(),
          category,
          edited_at: new Date().toISOString(),
        });
      } else {
        const d = await res.json() as { post: CommunityPost };
        onCreated(d.post);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
              <MessagesSquare size={15} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {isEdit ? 'Edit post' : 'New post'}
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                Visible to every SMITH user across all firms
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={160}
              placeholder="A clear, concise question or topic"
              className="input-base"
              autoFocus
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1 text-right">{title.length}/160</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMUNITY_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all
                    ${category === c.id
                      ? 'bg-violet-500 border-violet-500 text-white'
                      : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-content)] hover:border-violet-400'
                    }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Body
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={10_000}
              placeholder="What's on your mind? Be respectful and useful. Links are auto-detected."
              rows={8}
              className="input-base resize-none"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1 text-right">{body.length.toLocaleString()}/10,000</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border)] bg-[var(--bg-nav-hover)]/40">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !body.trim()}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            {saving
              ? <><Loader2 size={12} className="animate-spin" /> {isEdit ? 'Saving…' : 'Posting…'}</>
              : <>{isEdit ? 'Save changes' : 'Post'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
