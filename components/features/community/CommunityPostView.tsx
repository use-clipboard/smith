'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Heart, MessageCircle, Pencil, Trash2, Loader2, MoreHorizontal, Flag, MessagesSquare, AlertTriangle,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { communityDisplayName, categoryLabel, linkifyPlainText } from '@/lib/community';
import { createClient } from '@/lib/supabase';
import NewPostModal from './NewPostModal';
import CommentItem from './CommentItem';
import CommentComposer from './CommentComposer';
import type { CommunityPost, CommunityComment } from './types';

interface Props { postId: string }

export default function CommunityPostView({ postId }: Props) {
  const router = useRouter();
  const [post, setPost]         = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [me, setMe]             = useState<string | null>(null);
  const [editing, setEditing]   = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/community/posts/${postId}`);
      if (res.ok) {
        const d = await res.json() as { post: CommunityPost; comments: CommunityComment[] };
        setPost(d.post);
        setComments(d.comments ?? []);
      } else {
        setPost(null);
      }
    } finally { setLoading(false); }
  }, [postId]);

  useEffect(() => { load(); }, [load]);

  async function togglePostLike() {
    if (!post) return;
    const liked = post.viewerLiked;
    setPost({ ...post, viewerLiked: !liked, like_count: post.like_count + (liked ? -1 : 1) });
    try {
      await fetch(`/api/community/posts/${post.id}/like`, { method: liked ? 'DELETE' : 'POST' });
    } catch {
      setPost(p => p ? { ...p, viewerLiked: liked, like_count: p.like_count + (liked ? 1 : -1) } : p);
    }
  }

  async function deletePost() {
    if (!post) return;
    if (!confirm('Delete this post? This cannot be undone.')) return;
    const res = await fetch(`/api/community/posts/${post.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/community');
  }

  async function reportPost() {
    if (!post) return;
    const reason = prompt('Briefly describe the issue with this post:');
    if (reason === null) return;
    await fetch('/api/community/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: post.id, reason: reason.trim() || null }),
    });
    alert('Thanks — the SMITH team will review your report.');
  }

  if (loading) {
    return (
      <ToolLayout title="Community" icon={MessagesSquare} iconColor="#7C3AED">
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </ToolLayout>
    );
  }
  if (!post) {
    return (
      <ToolLayout title="Community" icon={MessagesSquare} iconColor="#7C3AED">
        <div className="p-6">
          <button
            onClick={() => router.push('/community')}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] mb-3"
          >
            <ArrowLeft size={13} /> Back to community
          </button>
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-[var(--text-muted)]">
            <AlertTriangle size={26} className="opacity-50" />
            <p className="text-sm">This post was deleted or could not be found.</p>
          </div>
        </div>
      </ToolLayout>
    );
  }

  const isAuthor = me === post.author?.id;
  const display = communityDisplayName(post.author?.full_name ?? null, post.author?.email ?? null);

  return (
    <ToolLayout title="Community" icon={MessagesSquare} iconColor="#7C3AED">
      <div className="flex flex-col h-full p-5 gap-4 overflow-y-auto">
        <button
          onClick={() => router.push('/community')}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] shrink-0"
        >
          <ArrowLeft size={13} /> Back to community
        </button>

        {/* Post body */}
        <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <Avatar name={display} avatarUrl={post.author?.avatar_url ?? null} size={28} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{display}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {new Date(post.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {post.edited_at && ' · edited'}
              </p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-50 text-violet-700 border border-violet-200">
              {categoryLabel(post.category)}
            </span>
            <PostActionMenu
              isAuthor={isAuthor}
              onEdit={() => setEditing(true)}
              onDelete={deletePost}
              onReport={reportPost}
            />
          </div>

          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{post.title}</h1>
          <div
            className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: linkifyPlainText(post.body) }}
          />

          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            <button
              onClick={togglePostLike}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                post.viewerLiked ? 'text-red-600 bg-red-50' : 'hover:text-red-600 hover:bg-red-50/50'
              }`}
            >
              <Heart size={14} className={post.viewerLiked ? 'fill-red-500 text-red-500' : ''} />
              {post.like_count}
            </button>
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={14} />
              {post.comment_count} {post.comment_count === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        </article>

        {/* Comment composer (shared) */}
        <CommentComposer
          postId={post.id}
          onPosted={c => {
            setComments(prev => [...prev, c]);
            setPost(p => p ? { ...p, comment_count: p.comment_count + 1 } : p);
          }}
        />

        {/* Comments (shared) */}
        <div className="space-y-2.5">
          {comments.map(c => (
            <CommentItem
              key={c.id}
              comment={c}
              isAuthor={!!me && c.author?.id === me}
              onChange={next => setComments(prev => prev.map(x => x.id === next.id ? next : x))}
              onDelete={() => {
                setComments(prev => prev.filter(x => x.id !== c.id));
                setPost(p => p ? { ...p, comment_count: Math.max(0, p.comment_count - 1) } : p);
              }}
            />
          ))}
        </div>
      </div>

      {editing && (
        <NewPostModal
          existing={post}
          onClose={() => setEditing(false)}
          onCreated={updated => { setEditing(false); setPost(updated); }}
        />
      )}
    </ToolLayout>
  );
}

function PostActionMenu({
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
        <div className="absolute right-0 top-7 z-20 w-44 glass-solid rounded-lg border border-[var(--border)] shadow-xl overflow-hidden">
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
