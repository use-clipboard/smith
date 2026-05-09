import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/email/thread-meta
 *
 * Returns the firm's complete set of allocated and task-linked thread IDs so
 * the inbox can show the green/blue indicators on every row at load time —
 * not only on threads the user has already clicked.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const supabase = createClient();

  const [allocsRes, linksRes] = await Promise.all([
    supabase.from('email_allocations').select('thread_id').eq('firm_id', ctx.firmId),
    supabase.from('email_task_links').select('thread_id').eq('firm_id', ctx.firmId),
  ]);

  const allocatedThreadIds = Array.from(new Set((allocsRes.data ?? []).map(r => r.thread_id as string)));
  const taskLinkedThreadIds = Array.from(new Set((linksRes.data ?? []).map(r => r.thread_id as string)));

  return NextResponse.json({ allocatedThreadIds, taskLinkedThreadIds });
}
