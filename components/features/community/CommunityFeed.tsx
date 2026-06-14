'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageCircle, Heart, Flame, Clock, Plus, Loader2, MessagesSquare,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import ToolLayout from '@/components/ui/ToolLayout';
import { createClient } from '@/lib/supabase';
import { COMMUNITY_CATEGORIES, communityDisplayName, categoryLabel } from '@/lib/community';
import NewPostModal from './NewPostModal';
import CommentItem from './CommentItem';
import CommentComposer from './CommentComposer';
import type { CommunityPost, CommunityComment } from './types';

type Sort = 'trending' | 'new';

export default function CommunityFeed() {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('trending');
  const [category, setCategory] = useState<string | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort });
      if (category) params.set('category', category);
      const res = await fetch(`/api/community/posts?${params}`);
      if (res.ok) {
        const d = await res.json() as { posts: CommunityPost[] };
        setPosts(d.posts ?? []);
      } else {
        setPosts([]);
      }
    } finally { setLoading(false); }
  }, [sort, category]);

  useEffect(() => { load(); }, [load]);

  async function toggleLike(post: CommunityPost) {
    const liked = post.viewerLiked;
    // Optimistic
    setPosts(prev => prev.map(p => p.id === post.id ? {
      ...p, viewerLiked: !liked, like_count: p.like_count + (liked ? -1 : 1),
    } : p));
    try {
      await fetch(`/api/community/posts/${post.id}/like`, { method: liked ? 'DELETE' : 'POST' });
    } catch {
      // Revert on failure
      setPosts(prev => prev.map(p => p.id === post.id ? {
        ...p, viewerLiked: liked, like_count: p.like_count + (liked ? 1 : -1),
      } : p));
    }
  }

  return (
    <ToolLayout title="Community" icon={MessagesSquare} iconColor="#7C3AED">
      <div className="flex flex-col h-full p-5 gap-4 overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] max-w-2xl">
              A space for SMITH users across every firm to share, ask, and help each other.
              Be respectful, be useful. Only the author of a post or comment can edit or delete it —
              if you see something concerning, hit Report.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
          >
            <Plus size={14} /> New post
          </button>
        </div>

        {/* Sort + category filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
            {(['trending', 'new'] as Sort[]).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize transition-colors
                  ${sort === s
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                  }`}
              >
                {s === 'trending' ? <Flame size={12} /> : <Clock size={12} />}
                {s === 'trending' ? 'Trending' : 'New'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setCategory(null)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                category === null
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200'
              }`}
            >
              All
            </button>
            {COMMUNITY_CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  category === c.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-20 text-sm text-[var(--text-muted)]">
              No posts yet. Be the first to start a discussion.
            </div>
          ) : (
            <div className="space-y-2.5">
              {posts.map(post => (
                <PostRow
                  key={post.id}
                  post={post}
                  viewerId={me}
                  onOpen={() => router.push(`/community/${post.id}`)}
                  onToggleLike={() => toggleLike(post)}
                  onCommentCountChange={delta => setPosts(prev => prev.map(p =>
                    p.id === post.id ? { ...p, comment_count: Math.max(0, p.comment_count + delta) } : p
                  ))}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <NewPostModal
          onClose={() => setShowCreate(false)}
          onCreated={p => {
            setShowCreate(false);
            setPosts(prev => [p, ...prev]);
            router.push(`/community/${p.id}`);
          }}
        />
      )}
    </ToolLayout>
  );
}

function PostRow({
  post, viewerId, onOpen, onToggleLike, onCommentCountChange,
}: {
  post: CommunityPost;
  viewerId: string | null;
  onOpen: () => void;
  onToggleLike: () => void;
  onCommentCountChange: (delta: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<CommunityComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  // Bump this counter whenever the user clicks "Comment" — the composer
  // observes it as its `autoFocus` prop and re-focuses each time.
  const [focusComposer, setFocusComposer] = useState(0);
  const display = communityDisplayName(post.author?.full_name ?? null, post.author?.email ?? null);
  const when = fmtRelative(post.created_at);

  async function loadComments() {
    if (comments !== null) return; // already loaded; refresh on demand later if needed
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/community/posts/${post.id}`);
      if (res.ok) {
        const d = await res.json() as { comments: CommunityComment[] };
        setComments(d.comments ?? []);
      } else {
        setComments([]);
      }
    } finally { setLoadingComments(false); }
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next) loadComments();
  }

  function openComposer() {
    if (!expanded) {
      setExpanded(true);
      loadComments();
    }
    setFocusComposer(n => n + 1);
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] hover:border-[var(--accent)] transition-colors">
      {/* Top meta row */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-2.5 mb-2">
          <Avatar name={display} avatarUrl={post.author?.avatar_url ?? null} size={24} userId={post.author?.id} />
          <span className="text-xs font-medium text-[var(--text-primary)]">{display}</span>
          <span className="text-xs text-[var(--text-muted)]">·</span>
          <span className="text-xs text-[var(--text-muted)]">{when}</span>
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-50 text-violet-700 border border-violet-200">
            {categoryLabel(post.category)}
          </span>
        </div>

        {/* Title links to the dedicated post page for sharing */}
        <button
          onClick={onOpen}
          className="text-left text-sm font-semibold text-[var(--text-primary)] mb-1 hover:text-[var(--accent)] transition-colors block w-full"
        >
          {post.title}
        </button>
        <p className={`text-xs text-[var(--text-secondary)] whitespace-pre-wrap ${expanded ? '' : 'line-clamp-2'}`}>
          {post.body}
        </p>

        {/* Footer actions */}
        <div className="flex items-center gap-1 mt-3 text-xs text-[var(--text-muted)]">
          <button
            onClick={onToggleLike}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              post.viewerLiked ? 'text-red-600 bg-red-50' : 'hover:text-red-600 hover:bg-red-50/50'
            }`}
            aria-label={post.viewerLiked ? 'Unlike' : 'Like'}
          >
            <Heart size={13} className={post.viewerLiked ? 'fill-red-500 text-red-500' : ''} />
            {post.like_count}
          </button>
          <button
            onClick={openComposer}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[var(--accent)] hover:bg-[var(--accent-light)] font-medium"
            aria-label="Write a comment"
          >
            <MessageCircle size={13} />
            Comment
          </button>
          <button
            onClick={toggleExpanded}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-[var(--bg-nav-hover)] ${expanded ? 'text-[var(--accent)]' : ''}`}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide replies' : 'Show replies'}
          >
            {post.comment_count} {post.comment_count === 1 ? 'reply' : 'replies'}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Expanded inline panel: comments + composer */}
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-nav-hover)]/40 p-3 space-y-2.5">
          {loadingComments && comments === null ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : (
            <>
              {comments && comments.length > 0 && (
                <div className="space-y-2">
                  {comments.map(c => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      isAuthor={!!viewerId && c.author?.id === viewerId}
                      onChange={next => setComments(prev => prev?.map(x => x.id === next.id ? next : x) ?? null)}
                      onDelete={() => {
                        setComments(prev => prev?.filter(x => x.id !== c.id) ?? null);
                        onCommentCountChange(-1);
                      }}
                    />
                  ))}
                </div>
              )}
              <CommentComposer
                postId={post.id}
                variant="inline"
                rows={2}
                autoFocus={focusComposer}
                onPosted={c => {
                  setComments(prev => [...(prev ?? []), c]);
                  onCommentCountChange(+1);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
