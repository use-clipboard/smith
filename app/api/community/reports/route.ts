import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Schema = z.object({
  postId:    z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  reason:    z.string().max(1000).optional(),
}).refine(s => !!s.postId || !!s.commentId, { message: 'postId or commentId is required' });

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase.from('community_reports').insert({
    reporter_id: ctx.userId,
    post_id:     parsed.data.postId ?? null,
    comment_id:  parsed.data.commentId ?? null,
    reason:      parsed.data.reason ?? null,
  });

  if (error) {
    console.error('POST /api/community/reports', error);
    return NextResponse.json({ error: 'Could not submit report' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
