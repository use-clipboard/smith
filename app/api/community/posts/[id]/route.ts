import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isCommunityCategory } from '@/lib/community';

const UpdateSchema = z.object({
  title:    z.string().min(1).max(160).optional(),
  body:     z.string().min(1).max(10_000).optional(),
  category: z.string().refine(isCommunityCategory).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();

  const { data: post, error } = await supabase
    .from('community_posts')
    .select(`
      id, title, body, category, like_count, comment_count, edited_at, created_at,
      author:users!community_posts_author_id_fkey(id, full_name, email, avatar_url)
    `)
    .eq('id', params.id)
    .single();

  if (error || !post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  const { data: comments } = await supabase
    .from('community_comments')
    .select(`
      id, body, like_count, edited_at, created_at,
      author:users!community_comments_author_id_fkey(id, full_name, email, avatar_url)
    `)
    .eq('post_id', params.id)
    .order('created_at', { ascending: true });

  // Which post/comment ids has the viewer liked?
  const commentIds = (comments ?? []).map(c => c.id as string);
  const [postLikeRes, commentLikeRes] = await Promise.all([
    supabase.from('community_post_likes').select('post_id').eq('user_id', ctx.userId).eq('post_id', params.id),
    commentIds.length > 0
      ? supabase.from('community_comment_likes').select('comment_id').eq('user_id', ctx.userId).in('comment_id', commentIds)
      : Promise.resolve({ data: [] as { comment_id: string }[] }),
  ]);
  const viewerLiked = (postLikeRes.data ?? []).length > 0;
  const likedComments = new Set((commentLikeRes.data ?? []).map(r => r.comment_id as string));

  const commentsOut = (comments ?? []).map(c => ({ ...c, viewerLiked: likedComments.has(c.id as string) }));

  return NextResponse.json({ post: { ...post, viewerLiked }, comments: commentsOut });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const update: Record<string, unknown> = { edited_at: new Date().toISOString() };
  if (parsed.data.title    !== undefined) update.title    = parsed.data.title.trim();
  if (parsed.data.body     !== undefined) update.body     = parsed.data.body.trim();
  if (parsed.data.category !== undefined) update.category = parsed.data.category;

  const supabase = createClient();
  const { error } = await supabase
    .from('community_posts')
    .update(update)
    .eq('id', params.id)
    .eq('author_id', ctx.userId); // belt-and-braces alongside the RLS policy

  if (error) {
    console.error('PATCH /api/community/posts/[id]', error);
    return NextResponse.json({ error: 'Could not update post' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', params.id)
    .eq('author_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/community/posts/[id]', error);
    return NextResponse.json({ error: 'Could not delete post' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
