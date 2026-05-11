import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

interface ProposalRow {
  id: string; status: string; sent_at: string | null; decided_at: string | null;
  total_monthly: number | null; total_one_off: number | null; total_annual: number | null;
  decline_reason: string | null;
}
interface LineRow { proposal_id: string; service_name: string }

// GET /api/proposals/analytics — firm-wide win/loss summary for the dashboard.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, status, sent_at, decided_at, total_monthly, total_one_off, total_annual, decline_reason')
    .eq('firm_id', ctx.firmId);
  const rows = (proposals ?? []) as ProposalRow[];

  const accepted = rows.filter(r => r.status === 'accepted');
  const declined = rows.filter(r => r.status === 'declined');
  const decided = accepted.length + declined.length;
  const winRate = decided > 0 ? Math.round((accepted.length / decided) * 100) : null;

  // Average days from sent → decided (accepted + declined)
  const decidedWithSent = rows.filter(r => (r.status === 'accepted' || r.status === 'declined') && r.sent_at && r.decided_at);
  const avgDays = decidedWithSent.length > 0
    ? Math.round(decidedWithSent.reduce((acc, r) => {
        const days = (new Date(r.decided_at!).getTime() - new Date(r.sent_at!).getTime()) / 86_400_000;
        return acc + days;
      }, 0) / decidedWithSent.length * 10) / 10
    : null;

  // Money won (sum of accepted MRR + annual + one-off as a rough total)
  const wonMonthly = accepted.reduce((acc, r) => acc + Number(r.total_monthly ?? 0), 0);
  const wonAnnual = accepted.reduce((acc, r) => acc + Number(r.total_annual ?? 0), 0);
  const wonOneOff = accepted.reduce((acc, r) => acc + Number(r.total_one_off ?? 0), 0);

  // Top decline reasons (loose grouping by first 80 chars, case-insensitive)
  const reasonCounts = new Map<string, number>();
  for (const r of declined) {
    if (!r.decline_reason) continue;
    const key = r.decline_reason.toLowerCase().trim().slice(0, 80);
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topDeclineReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // Acceptance rate per service
  const { data: items } = await supabase
    .from('proposal_line_items')
    .select('proposal_id, service_name')
    .in('proposal_id', rows.length > 0 ? rows.map(r => r.id) : ['00000000-0000-0000-0000-000000000000']);
  const acceptedSet = new Set(accepted.map(a => a.id));
  const declinedSet = new Set(declined.map(d => d.id));
  const serviceStats = new Map<string, { wins: number; losses: number }>();
  for (const li of (items ?? []) as LineRow[]) {
    const stat = serviceStats.get(li.service_name) ?? { wins: 0, losses: 0 };
    if (acceptedSet.has(li.proposal_id)) stat.wins += 1;
    else if (declinedSet.has(li.proposal_id)) stat.losses += 1;
    serviceStats.set(li.service_name, stat);
  }
  const serviceWinRates = Array.from(serviceStats.entries())
    .map(([name, s]) => ({ name, wins: s.wins, losses: s.losses, winRate: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : null }))
    .filter(s => s.wins + s.losses >= 2) // need at least 2 data points
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1))
    .slice(0, 8);

  return NextResponse.json({
    counts: {
      total: rows.length,
      draft: rows.filter(r => r.status === 'draft').length,
      outstanding: rows.filter(r => r.status === 'sent' || r.status === 'viewed').length,
      accepted: accepted.length,
      declined: declined.length,
      expired: rows.filter(r => r.status === 'expired').length,
    },
    winRate,
    avgDaysToDecide: avgDays,
    revenueWon: { monthly: wonMonthly, annual: wonAnnual, one_off: wonOneOff },
    topDeclineReasons,
    serviceWinRates,
  });
}
