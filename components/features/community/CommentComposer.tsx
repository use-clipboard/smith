'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Send } from 'lucide-react';
import type { CommunityComment } from './types';

interface Props {
  postId:    string;
  /** Visual variant — 'card' inside a single post page, 'inline' under a feed row. */
  variant?:  'card' | 'inline';
  rows?:     number;
  /** When true (or when the key/counter changes), focus the textarea on mount/update. */
  autoFocus?: boolean | number;
  /** Called with the new comment after a successful POST. */
  onPosted:  (c: CommunityComment) => void;
}

export default function CommentComposer({ postId, variant = 'card', rows = 3, autoFocus, onPosted }: Props) {
  const [body, setBody]       = useState('');
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea any time the autoFocus flag/counter changes truthy.
  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [autoFocus]);

  async function submit() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) return;
      const d = await res.json() as { comment: CommunityComment };
      onPosted(d.comment);
      setBody('');
    } finally { setPosting(false); }
  }

  const wrapperClass = variant === 'card'
    ? 'rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] p-3'
    : 'rounded-lg border border-[var(--border)] bg-[var(--bg-content)] p-2.5';

  return (
    <div className={wrapperClass}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={e => setBody(e.target.value)}
        maxLength={5000}
        placeholder="Write a reply…  plain text only, links auto-detected"
        rows={rows}
        className="input-base resize-none mb-2"
      />
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[var(--text-muted)]">{body.length.toLocaleString()}/5,000</p>
        <button
          onClick={submit}
          disabled={posting || !body.trim()}
          className="btn-primary text-xs inline-flex items-center gap-1.5"
        >
          {posting
            ? <><Loader2 size={12} className="animate-spin" /> Posting…</>
            : <><Send size={12} /> Reply</>}
        </button>
      </div>
    </div>
  );
}
