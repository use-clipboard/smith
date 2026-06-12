import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { currentTaxYear, getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';

// GET /api/mtd-it/dashboard-summary
// Drives the MTD IT dashboard widget donut: for the quarter currently "in its
// filing window", how many of the firm's in-progress clients have submitted to
// HMRC vs are still outstanding.
//
// Which quarter? The quarterly deadline is the 7th of the SECOND month after the
// quarter ends (e.g. Apr–Jun → 7 Aug). We show the quarter whose deadline is the
// soonest one that hasn't yet passed — so Apr–Jun stays visible until 7 Aug, then
// it rolls to Jul–Sep on 8 Aug. Uses 'calendar' quarters for the display period.

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Deadline = 7th of the second month after the quarter end month. */
function deadlineFor(taxYear: number, quarter: 1 | 2 | 3 | 4): Date {
  const range = getQuarterDates(taxYear, quarter, 'calendar');
  const [ey, em] = range.to.split('-').map(Number); // end year, end month (1-12)
  return new Date(ey, (em - 1) + 2, 7); // JS month is 0-indexed; +2 months, day 7
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const cty = currentTaxYear(now);

  // Candidate quarters around now; pick the soonest deadline not yet passed.
  const candidates: { taxYear: number; quarter: 1 | 2 | 3 | 4; deadline: Date }[] = [];
  for (const ty of [cty - 1, cty, cty + 1]) {
    for (const q of [1, 2, 3, 4] as const) {
      candidates.push({ taxYear: ty, quarter: q, deadline: deadlineFor(ty, q) });
    }
  }
  const active = candidates
    .filter(c => c.deadline >= today)
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0]
    ?? candidates[candidates.length - 1];

  const range = getQuarterDates(active.taxYear, active.quarter, 'calendar');

  // Aggregate this firm's quarter records for the active period.
  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_quarters')
    .select('status, clients!inner(firm_id)')
    .eq('clients.firm_id', ctx.firmId)
    .eq('tax_year', active.taxYear)
    .eq('quarter', active.quarter);

  if (error) {
    console.error('GET /api/mtd-it/dashboard-summary', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as { status: string }[];
  const total = rows.length;
  const submitted = rows.filter(r => r.status === 'submitted').length;
  // "In review" = approved/sent (done by the team, not yet at HMRC); everything
  // else (not_started/draft/complete) is still being worked on.
  const inReview = rows.filter(r => r.status === 'approved' || r.status === 'sent').length;
  const outstanding = total - submitted - inReview;

  return NextResponse.json({
    taxYearLabel: taxYearLabel(active.taxYear),
    quarter: active.quarter,
    monthsLabel: range.monthsLabel,
    deadline: fmt(active.deadline),
    total,
    submitted,
    inReview,
    outstanding,
  });
}
