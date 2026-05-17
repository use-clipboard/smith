import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET  /api/mtd-it/approvals/unread
//   Returns the current user's unread MTD IT approval notifications, grouped:
//     { total, by_client: { [client_id]: count }, by_quarter: { [quarter_id]: count } }
//   The dashboard polls this on mount to drive:
//     - the sidebar dot count
//     - the per-row "NEW APPROVAL" badges
//
// POST /api/mtd-it/approvals/unread/mark-read
//   Body: { quarter_id? }
//   Marks every unread mtd_it_approved / mtd_it_changes_requested notification
//   for the user as read. If quarter_id is supplied, only that quarter's
//   notifications are marked — used when the preparer opens a specific
//   quarter. Without it, marks all (used by "mark all read" in the sidebar).

const APPROVAL_TYPES = ['mtd_it_approved', 'mtd_it_changes_requested'];

interface NotifRow {
  type: string;
  data: { client_id?: string; quarter_id?: string } | null;
}

export async function GET(_req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('type, data')
    .eq('user_id', ctx.userId)
    .eq('read', false)
    .in('type', APPROVAL_TYPES);
  if (error) {
    console.error('GET /api/mtd-it/approvals/unread', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const rows = (data ?? []) as NotifRow[];
  const byClient:  Record<string, number> = {};
  const byQuarter: Record<string, number> = {};
  for (const r of rows) {
    const cid = r.data?.client_id;
    const qid = r.data?.quarter_id;
    if (cid) byClient[cid]  = (byClient[cid]  ?? 0) + 1;
    if (qid) byQuarter[qid] = (byQuarter[qid] ?? 0) + 1;
  }

  return NextResponse.json({
    total: rows.length,
    by_client: byClient,
    by_quarter: byQuarter,
  });
}
