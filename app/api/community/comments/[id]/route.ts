import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const UpdateSchema = z.object({
  body: z.string().min(1).max(5_000),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('community_comments')
    .update({ body: parsed.data.body.trim(), edited_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('author_id', ctx.userId);

  if (error) {
    console.error('PATCH /api/community/comments/[id]', error);
    return NextResponse.json({ error: 'Could not update comment' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const supabase = createClient();

  // Need the post_id to decrement the cached count
  const { data: existing } = await supabase
    .from('community_comments')
    .select('post_id, author_id')
    .eq('id', params.id)
    .single();

  if (!existing || existing.author_id !== ctx.userId) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('community_comments')
    .delete()
    .eq('id', params.id)
    .eq('author_id', ctx.userId);

  if (error) {
    console.error('DELETE /api/community/comments/[id]', error);
    return NextResponse.json({ error: 'Could not delete comment' }, { status: 500 });
  }

  // Decrement cached comment_count via service role
  (async () => {
    try {
      const service = createServiceClient();
      const { data: post } = await service
        .from('community_posts')
        .select('comment_count')
        .eq('id', existing.post_id as string)
        .single();
      if (post && (post.comment_count as number) > 0) {
        await service
          .from('community_posts')
          .update({ comment_count: (post.comment_count as number) - 1 })
          .eq('id', existing.post_id as string);
      }
    } catch (err) { console.error('comment count decrement failed', err); }
  })();

  return NextResponse.json({ ok: true });
}
