import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('community_comment_likes')
    .insert({ comment_id: params.id, user_id: ctx.userId });

  if (error && error.code !== '23505') {
    console.error('POST /api/community/comments/[id]/like', error);
    return NextResponse.json({ error: 'Could not like comment' }, { status: 500 });
  }
  if (!error) bumpCommentLikeCount(params.id, +1);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();
  const { error, count } = await supabase
    .from('community_comment_likes')
    .delete({ count: 'exact' })
    .eq('comment_id', params.id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/community/comments/[id]/like', error);
    return NextResponse.json({ error: 'Could not unlike comment' }, { status: 500 });
  }
  if ((count ?? 0) > 0) bumpCommentLikeCount(params.id, -1);
  return NextResponse.json({ ok: true });
}

function bumpCommentLikeCount(commentId: string, delta: number): void {
  (async () => {
    try {
      const service = createServiceClient();
      const { data } = await service
        .from('community_comments')
        .select('like_count')
        .eq('id', commentId)
        .single();
      if (!data) return;
      const next = Math.max(0, (data.like_count as number) + delta);
      await service.from('community_comments').update({ like_count: next }).eq('id', commentId);
    } catch (err) { console.error('comment like_count bump failed', err); }
  })();
}
