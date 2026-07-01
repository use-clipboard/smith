import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/email/thread-meta
 *
 * Returns the firm's complete set of allocated and task-linked thread IDs so
 * the inbox can show the green/blue indicators on every row at load time —
 * not only on threads the user has already clicked.
 *
 * Gmail thread ids are per-mailbox, so `allocatedThreadIds` only matches for
 * the user who created the allocation. `allocatedMessageKeys` carries the
 * stable RFC 2822 Message-IDs of every allocated message plus their reply-chain
 * references — these are identical across mailboxes, so any user viewing the
 * same conversation can light up the marker (chain-wide) by matching a row's
 * Message-ID / References against this set.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const supabase = createClient();

  const [allocsRes, linksRes] = await Promise.all([
    supabase.from('email_allocations').select('thread_id, rfc_message_id, rfc_references').eq('firm_id', ctx.firmId),
    supabase.from('email_task_links').select('thread_id, rfc_message_id, rfc_references').eq('firm_id', ctx.firmId),
  ]);

  const allocatedThreadIds = Array.from(new Set((allocsRes.data ?? []).map(r => r.thread_id as string)));
  const taskLinkedThreadIds = Array.from(new Set((linksRes.data ?? []).map(r => r.thread_id as string)));

  // Union of every row's own Message-ID and the ids it descends from — the full
  // set of RFC ids that belong to an allocated / task-linked conversation.
  const collectMessageKeys = (rows: { rfc_message_id: string | null; rfc_references: string[] | null }[]): string[] => {
    const keys = new Set<string>();
    for (const r of rows) {
      if (r.rfc_message_id) keys.add(r.rfc_message_id);
      for (const ref of r.rfc_references ?? []) {
        if (ref) keys.add(ref);
      }
    }
    return Array.from(keys);
  };

  return NextResponse.json({
    allocatedThreadIds,
    taskLinkedThreadIds,
    allocatedMessageKeys: collectMessageKeys((allocsRes.data ?? []) as { rfc_message_id: string | null; rfc_references: string[] | null }[]),
    taskLinkedMessageKeys: collectMessageKeys((linksRes.data ?? []) as { rfc_message_id: string | null; rfc_references: string[] | null }[]),
  });
}
