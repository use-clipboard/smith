import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { computeRentComputation, type LandlordEntityType } from '@/utils/landlordComputation';

export const dynamic = 'force-dynamic';

// Landlord run dates come from AI extraction / date pickers — accept the common
// formats and normalise to a Date.
function parseFlexibleDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);           // yyyy-mm-dd
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d.getTime()) ? null : d; }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);               // dd-mm-yyyy
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

interface LandlordRunData {
  income?: Record<string, unknown>[];
  expenses?: Record<string, unknown>[];
  adjustments?: Record<string, unknown>[];
  dateFrom?: string;
  dateTo?: string;
  entityType?: string;
  useAllowance?: boolean;
  broughtForwardLoss?: number;
}

// GET /api/tax-studio/integrations/landlord?clientId=<uuid>&taxYear=2025/26
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  const from = new Date(startYear, 3, 6);
  const windowEnd = new Date(startYear + 1, 3, 30); // 5 Apr + a little slack

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('outputs')
    .select('id, result_data, created_at')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('feature', 'landlord_analysis')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ found: false, dateFrom: '', dateTo: '', totalIncome: 0, totalExpenses: 0, netProfit: 0, taxableProfit: 0, financeReducer: 0 }, { status: 404 });
  }

  // Prefer a run whose period ends within the tax year; else fall back to the
  // most recent and ask the user to confirm the year.
  let chosen = rows.find(r => {
    const rd = (r.result_data ?? {}) as LandlordRunData;
    const end = parseFlexibleDate(rd.dateTo);
    return end && end >= from && end <= windowEnd;
  });
  let note: string | undefined;
  if (!chosen) {
    chosen = rows[0];
    const rd = (chosen.result_data ?? {}) as LandlordRunData;
    note = `No saved run clearly matches ${taxYearLabel} — showing the latest (${rd.dateFrom || '?'} – ${rd.dateTo || '?'}). Confirm it’s the right year.`;
  }

  const rd = (chosen.result_data ?? {}) as LandlordRunData;
  const comp = computeRentComputation(
    (rd.income ?? []) as unknown as { Amount: number }[],
    (rd.expenses ?? []) as unknown as { Category: string; Amount: number; CapitalExpense?: boolean }[],
    (rd.adjustments ?? []) as unknown as { type: 'income' | 'expense'; amount: number; category: string; description: string }[],
    {
      entityType: (rd.entityType === 'company' ? 'company' : 'individual') as LandlordEntityType,
      useAllowance: !!rd.useAllowance,
      broughtForwardLoss: Number(rd.broughtForwardLoss ?? 0),
    },
  );

  return NextResponse.json({
    found: true,
    dateFrom: rd.dateFrom ?? '',
    dateTo: rd.dateTo ?? '',
    totalIncome: Math.round(comp.totalIncome),
    totalExpenses: Math.round(comp.totalExpenses),
    netProfit: Math.round(comp.netProfit),
    taxableProfit: Math.round(comp.taxableProfit),
    financeCosts: Math.round(comp.financeCosts),
    financeReducer: Math.round(comp.financeReducer),
    note,
  });
}
