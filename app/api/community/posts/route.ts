import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isCommunityCategory, trendingScore } from '@/lib/community';

const CreateSchema = z.object({
  title:    z.string().min(1).max(160),
  body:     z.string().min(1).max(10_000),
  category: z.string().refine(isCommunityCategory).optional(),
});

/**
 * GET /api/community/posts?sort=new|trending&category=<id>&limit=…
 *
 * Reads across all firms — the community feature is cross-firm by design.
 * Response shape lets the feed render without any further fetches:
 *   { posts: [{ ...post, author: {id, displayName, avatarUrl}, viewerLiked }] }
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ posts: [] }, { status: 401 });

  const url = req.nextUrl;
  const sort = (url.searchParams.get('sort') ?? 'new') as 'new' | 'trending';
  const category = url.searchParams.get('category');
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '100', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 100 : limitRaw, 1), 200);

  const supabase = createClient();
  let query = supabase
    .from('community_posts')
    .select(`
      id, title, body, category, like_count, comment_count, edited_at, created_at,
      author:users!community_posts_author_id_fkey(id, full_name, email, avatar_url)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category && isCommunityCategory(category)) {
    query = query.eq('category', category);
  }

  const { data: posts, error } = await query;
  if (error) {
    console.error('GET /api/community/posts', error);
    return NextResponse.json({ posts: [], error: 'fetch_failed' }, { status: 500 });
  }

  // Which of these has the current viewer liked?
  let likedIds = new Set<string>();
  if (posts && posts.length > 0) {
    const ids = posts.map(p => p.id);
    const { data: likes } = await supabase
      .from('community_post_likes')
      .select('post_id')
      .eq('user_id', ctx.userId)
      .in('post_id', ids);
    likedIds = new Set((likes ?? []).map(l => l.post_id as string));
  }

  let resultPosts = (posts ?? []).map(p => ({ ...p, viewerLiked: likedIds.has(p.id as string) }));

  if (sort === 'trending') {
    resultPosts = resultPosts.sort((a, b) =>
      trendingScore(b.like_count as number, b.created_at as string) -
      trendingScore(a.like_count as number, a.created_at as string)
    );
  }

  return NextResponse.json({ posts: resultPosts });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      author_id: ctx.userId,
      title:     parsed.data.title.trim(),
      body:      parsed.data.body.trim(),
      category:  parsed.data.category ?? 'general',
    })
    .select(`
      id, title, body, category, like_count, comment_count, edited_at, created_at,
      author:users!community_posts_author_id_fkey(id, full_name, email, avatar_url)
    `)
    .single();

  if (error || !data) {
    console.error('POST /api/community/posts', error);
    return NextResponse.json({ error: 'Could not create post' }, { status: 500 });
  }
  return NextResponse.json({ post: { ...data, viewerLiked: false } });
}
