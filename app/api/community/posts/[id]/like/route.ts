import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * POST   /api/community/posts/[id]/like   — like (idempotent)
 * DELETE /api/community/posts/[id]/like   — unlike
 *
 * Adjusts the cached like_count via the service role so RLS doesn't block a
 * non-author from incrementing the counter on someone else's post.
 */

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('community_post_likes')
    .insert({ post_id: params.id, user_id: ctx.userId });

  // 23505 = unique-violation, meaning the user already liked — treat as success.
  if (error && error.code !== '23505') {
    console.error('POST /api/community/posts/[id]/like', error);
    return NextResponse.json({ error: 'Could not like post' }, { status: 500 });
  }
  if (!error) bumpLikeCount(params.id, +1);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error, count } = await supabase
    .from('community_post_likes')
    .delete({ count: 'exact' })
    .eq('post_id', params.id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/community/posts/[id]/like', error);
    return NextResponse.json({ error: 'Could not unlike post' }, { status: 500 });
  }
  if ((count ?? 0) > 0) bumpLikeCount(params.id, -1);
  return NextResponse.json({ ok: true });
}

function bumpLikeCount(postId: string, delta: number): void {
  (async () => {
    try {
      const service = createServiceClient();
      const { data } = await service
        .from('community_posts')
        .select('like_count')
        .eq('id', postId)
        .single();
      if (!data) return;
      const next = Math.max(0, (data.like_count as number) + delta);
      await service.from('community_posts').update({ like_count: next }).eq('id', postId);
    } catch (err) { console.error('like_count bump failed', err); }
  })();
}
