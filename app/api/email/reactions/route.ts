import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';

export interface ReactionRow {
  id: string;
  message_id: string;
  emoji: string;
  user_id: string;
  users: { full_name: string | null; email: string } | null;
}

// GET /api/email/reactions?threadId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const threadId = new URL(req.url).searchParams.get('threadId');
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('email_reactions')
    .select('id, message_id, emoji, user_id, users:users(full_name, email)')
    .eq('firm_id', ctx.firmId)
    .eq('thread_id', threadId);

  if (error) {
    console.error('GET /api/email/reactions', error);
    return NextResponse.json({ error: 'Failed to load reactions' }, { status: 500 });
  }

  return NextResponse.json({
    reactions: (data ?? []) as unknown as ReactionRow[],
    currentUserId: ctx.userId,
  });
}

const ToggleSchema = z.object({
  threadId:  z.string().min(1),
  messageId: z.string().min(1),
  emoji:     z.string().min(1).max(8),
});

// POST /api/email/reactions — toggle reaction (add if absent, remove if present)
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = ToggleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { threadId, messageId, emoji } = parsed.data;
  const supabase = createClient();

  // Check if reaction already exists for this user+message+emoji
  const { data: existing } = await supabase
    .from('email_reactions')
    .select('id')
    .eq('user_id', ctx.userId)
    .eq('message_id', messageId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from('email_reactions').delete().eq('id', existing.id);
    return NextResponse.json({ action: 'removed' });
  }

  const { error } = await supabase.from('email_reactions').insert({
    firm_id:    ctx.firmId,
    user_id:    ctx.userId,
    thread_id:  threadId,
    message_id: messageId,
    emoji,
  });

  if (error) {
    console.error('POST /api/email/reactions', error);
    return NextResponse.json({ error: 'Failed to save reaction' }, { status: 500 });
  }

  return NextResponse.json({ action: 'added' });
}
