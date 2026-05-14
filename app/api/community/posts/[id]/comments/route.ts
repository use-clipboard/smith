import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';
import { communityDisplayName } from '@/lib/community';

const CreateSchema = z.object({
  body: z.string().min(1).max(5_000),
});

/**
 * POST /api/community/posts/[id]/comments
 *
 * Adds a comment, bumps the post's cached comment_count, and (when the post
 * author has community notifications enabled and isn't replying to themselves)
 * fires a notification via the bell.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabase = createClient();

  // Insert the comment
  const { data: comment, error } = await supabase
    .from('community_comments')
    .insert({
      post_id:   params.id,
      author_id: ctx.userId,
      body:      parsed.data.body.trim(),
    })
    .select(`
      id, body, like_count, edited_at, created_at,
      author:users!community_comments_author_id_fkey(id, full_name, email, avatar_url)
    `)
    .single();

  if (error || !comment) {
    console.error('POST /api/community/posts/[id]/comments', error);
    return NextResponse.json({ error: 'Could not add comment' }, { status: 500 });
  }

  // Bump cached comment_count via service-role (RLS would otherwise block
  // updates from a non-author). Fire-and-forget — not critical for the response.
  (async () => {
    try {
      const service = createServiceClient();
      const { data: post } = await service
        .from('community_posts')
        .select('comment_count, author_id, title')
        .eq('id', params.id)
        .single();
      if (!post) return;
      await service
        .from('community_posts')
        .update({ comment_count: (post.comment_count as number) + 1 })
        .eq('id', params.id);

      // Notify the post author (if it's not them replying, and they're opted in)
      const authorId = post.author_id as string;
      if (authorId && authorId !== ctx.userId) {
        const { data: target } = await service
          .from('users')
          .select('firm_id, community_notifications_enabled')
          .eq('id', authorId)
          .single();
        if (target?.community_notifications_enabled !== false && target?.firm_id) {
          const commenterName = communityDisplayName(
            (comment.author as { full_name?: string | null })?.full_name ?? null,
            (comment.author as { email?: string | null })?.email ?? null,
          );
          await createNotification({
            userId: authorId,
            firmId: target.firm_id as string,
            type:   'community_reply',
            title:  `New reply on "${(post.title as string) ?? 'your post'}"`,
            body:   `${commenterName} replied: ${parsed.data.body.trim().slice(0, 140)}`,
            data:   { post_id: params.id, link: `/community/${params.id}` },
          });
        }
      }
    } catch (err) {
      console.error('comment side-effects failed', err);
    }
  })();

  return NextResponse.json({ comment: { ...comment, viewerLiked: false } });
}
