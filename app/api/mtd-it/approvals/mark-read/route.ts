import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/mtd-it/approvals/mark-read
//   Body: { quarter_id? }
//   Marks the current user's unread MTD IT approval notifications as read.
//   With quarter_id: only that quarter's notifications. Without: all.

const BodySchema = z.object({
  quarter_id: z.string().uuid().optional(),
}).strict();

const APPROVAL_TYPES = ['mtd_it_approved', 'mtd_it_changes_requested'];

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  let query = supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', ctx.userId)
    .eq('read', false)
    .in('type', APPROVAL_TYPES);

  // If a quarter was supplied, narrow the update via the data->>quarter_id
  // JSON accessor. Supabase PostgREST supports this filter syntax.
  if (parsed.data.quarter_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).eq('data->>quarter_id', parsed.data.quarter_id);
  }

  const { error } = await query;
  if (error) {
    console.error('POST /api/mtd-it/approvals/mark-read', error);
    return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
