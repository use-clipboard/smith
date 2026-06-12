import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/dashboard/needs-attention
// A firm-wide "which clients need looking at today" list, derived from live
// tasks (not complete/draft, not deleted) that have BOTH a client and a due
// date. Clients are bucketed by their most urgent task and ranked:
//   • "overdue"  — has ≥1 task whose due date has passed
//   • "due-soon" — has ≥1 task due within the next 7 days (and none overdue)
// Only clients that actually need attention are returned (top 6 by urgency).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ clients: [] }, { status: 401 });

  const supabase = createClient();

  // Live, client-linked, dated tasks for the firm (paginated past the 1k cap).
  const PAGE = 1000;
  const rows: { client_id: string; due_date: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('tasks')
      .select('client_id, due_date')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .not('status', 'in', '("complete","draft")')
      .not('client_id', 'is', null)
      .not('due_date', 'is', null)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return NextResponse.json({ clients: [] });
    if (!data || data.length === 0) break;
    rows.push(...(data as { client_id: string; due_date: string }[]));
    if (data.length < PAGE) break;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);

  const byClient = new Map<string, { overdue: number; dueSoon: number }>();
  for (const r of rows) {
    const due = new Date(r.due_date);
    const agg = byClient.get(r.client_id) ?? { overdue: 0, dueSoon: 0 };
    if (due < today) agg.overdue++;
    else if (due <= weekOut) agg.dueSoon++;
    byClient.set(r.client_id, agg);
  }

  const ranked = [...byClient.entries()]
    .filter(([, v]) => v.overdue > 0 || v.dueSoon > 0)
    .sort((a, b) => (b[1].overdue - a[1].overdue) || (b[1].dueSoon - a[1].dueSoon))
    .slice(0, 6);

  if (ranked.length === 0) return NextResponse.json({ clients: [] });

  const ids = ranked.map(([id]) => id);
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name, client_ref')
    .in('id', ids);
  const nameMap = new Map((clientRows ?? []).map(c => [c.id, c]));

  const clients = ranked.map(([id, v]) => {
    const c = nameMap.get(id);
    return {
      clientId: id,
      name: c?.name ?? 'Unknown client',
      clientRef: c?.client_ref ?? null,
      status: v.overdue > 0 ? 'overdue' : 'due-soon',
      reason: v.overdue > 0
        ? `${v.overdue} overdue task${v.overdue === 1 ? '' : 's'}`
        : `${v.dueSoon} due this week`,
    };
  });

  return NextResponse.json({ clients });
}
