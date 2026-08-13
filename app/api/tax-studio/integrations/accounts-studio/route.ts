import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

export const dynamic = 'force-dynamic';

// dd-mm-yyyy → Date (Accounts Studio stores periods in this format).
function parseDMY(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const ENTITY_LABEL: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', llp: 'LLP',
  limited_company: 'Limited Company', charity: 'Charity', trust: 'Trust',
};

// GET /api/tax-studio/integrations/accounts-studio?clientId=<uuid>&taxYear=2025/26
// Returns the accounts net profit for the engagement whose accounting period
// ENDS within the tax year (basis-period reform: the year-end in the tax year).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  // UK tax year window: 6 Apr startYear – 5 Apr startYear+1.
  const from = new Date(startYear, 3, 6);
  const to = new Date(startYear + 1, 3, 5);

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data, updated_at')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "No matching engagement" is a normal empty result, not an HTTP error — return
  // 200 with found:false so the Analyse card shows "no data" without logging a
  // console error (consistent with entity-sources / mtd-it).
  const notFound = NextResponse.json({ found: false, periodStart: '', periodEnd: '', entityLabel: '', isPartnership: false, netProfit: 0, turnover: 0 });

  // Most-recently-updated engagement whose period end lands in the tax year and
  // has real statements.
  for (const row of data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const pl = ((d.statements as Record<string, unknown> | null)?.profitLoss ?? null) as Record<string, unknown> | null;
    if (!pl) continue;
    const periodEnd = parseDMY(d.periodEnd);
    if (!periodEnd || periodEnd < from || periodEnd > to) continue;

    const entityType = (d.entityType as string) ?? '';
    const isPartnership = entityType === 'partnership' || entityType === 'llp';
    // Flatten the P&L statement groups into income / expense lines for itemising
    // into SA103F boxes. Turnover → income; cost of sales + expenses → expense.
    type Group = { lines?: { label?: unknown; current?: unknown }[] };
    const flatten = (groups: unknown, section: 'income' | 'expense') => {
      const out: { label: string; amount: number; section: 'income' | 'expense' }[] = [];
      for (const g of (Array.isArray(groups) ? groups : []) as Group[]) {
        for (const ln of g.lines ?? []) {
          const amount = Math.round(Number(ln.current ?? 0));
          const label = String(ln.label ?? '').trim();
          if (label && amount !== 0) out.push({ label, amount, section });
        }
      }
      return out;
    };
    const lines = [
      ...flatten(pl.turnover, 'income'),
      ...flatten(pl.costOfSales, 'expense'),
      ...flatten(pl.expenses, 'expense'),
    ];
    return NextResponse.json({
      found: true,
      periodStart: (d.periodStart as string) ?? '',
      periodEnd: (d.periodEnd as string) ?? '',
      entityLabel: ENTITY_LABEL[entityType] ?? 'Business',
      isPartnership,
      netProfit: Math.round(Number(pl.netProfit ?? 0)),
      turnover: Math.round(Number(pl.turnoverTotal ?? 0)),
      lines,
      note: isPartnership
        ? 'Whole-firm profit — apply this partner’s profit share before finalising.'
        : 'Accounts profit — add back disallowables and apply capital allowances for the tax-adjusted figure.',
    });
  }

  return notFound;
}
