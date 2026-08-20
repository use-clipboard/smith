import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

export const dynamic = 'force-dynamic';

// Accounts Studio stores period dates as dd-mm-yyyy → convert to ISO for the
// wizard's <input type="date">.
function dmyToIso(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// A day-month "year end" (e.g. "31-03", "31/03", "31 March") → a 12-month
// accounting period ending on the most recent occurrence of that year end.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function periodFromYearEnd(raw: unknown): { periodStart: string; periodEnd: string } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();
  let day: number | null = null, month: number | null = null;
  let m = s.match(/^(\d{1,2})[-/ ](\d{1,2})(?:[-/ ]\d{2,4})?$/); // dd-mm(-yyyy)
  if (m) { day = Number(m[1]); month = Number(m[2]); }
  else {
    const m2 = s.match(/^(\d{1,2})\s+([a-z]{3,})/); // "31 March"
    if (m2) { day = Number(m2[1]); month = MONTHS.indexOf(m2[2].slice(0, 3)) + 1; }
  }
  if (!day || !month || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  // Most recent year end that has passed.
  let endYear = now.getFullYear();
  const thisYearEnd = new Date(endYear, month - 1, day);
  if (thisYearEnd > now) endYear -= 1;
  const end = new Date(endYear, month - 1, day);
  const start = new Date(end); start.setFullYear(end.getFullYear() - 1); start.setDate(start.getDate() + 1);
  return { periodStart: iso(start), periodEnd: iso(end) };
}

// GET /api/tax-studio/ct600/period?clientId=<uuid>
// Best-guess accounting period for a company: the most recent Accounts Studio
// engagement's period, else derived from the client's year end.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createServiceClient();

  // 1) Accounts Studio — the authoritative accounting period.
  const { data: engagements } = await supabase
    .from('accounts_studio_engagements')
    .select('data, updated_at')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  for (const row of engagements ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const ps = dmyToIso(d.periodStart), pe = dmyToIso(d.periodEnd);
    if (ps && pe) return NextResponse.json({ found: true, periodStart: ps, periodEnd: pe, source: 'Accounts Studio' });
  }

  // 2) Fallback — the client's year end.
  const { data: client } = await supabase
    .from('clients').select('year_end').eq('firm_id', ctx.firmId).eq('id', clientId).maybeSingle();
  const p = periodFromYearEnd(client?.year_end);
  if (p) return NextResponse.json({ found: true, ...p, source: 'the client’s year end' });

  return NextResponse.json({ found: false });
}
