import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Cap context to keep token cost predictable. Most-recent first.
const MAX_ANALYSES = 5;
const MAX_INCOME_ROWS = 200;
const MAX_EXPENSE_ROWS = 300;

interface PastIncome { Date: string; PropertyAddress: string; Description: string; Amount: number }
interface PastExpense { DueDate: string; Description: string; Category: string; Supplier: string; PropertyAddress: string; Amount: number; CapitalExpense: boolean; TenantPayable: boolean }

// GET /api/landlord/client-context?clientId=<uuid>
//
// Pulls the client's most recent saved Landlord analyses and returns a
// compact summary the API/prompt can use as past-data context. Helps the AI
// stay consistent with previously-chosen categories, supplier names,
// property addresses, and capital-vs-revenue classifications.
//
// Returns: { incomeCount, expenseCount, analysisCount, pastIncome[], pastExpenses[] }
// Empty payload (counts: 0) is a valid no-context response.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ incomeCount: 0, expenseCount: 0, analysisCount: 0, pastIncome: [], pastExpenses: [] });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('outputs')
    .select('id, result_data, created_at')
    .eq('feature', 'landlord_analysis')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(MAX_ANALYSES);

  if (error) {
    console.error('[GET /api/landlord/client-context]', error);
    return NextResponse.json({ incomeCount: 0, expenseCount: 0, analysisCount: 0, pastIncome: [], pastExpenses: [] });
  }

  const analyses = data ?? [];
  if (analyses.length === 0) {
    return NextResponse.json({ incomeCount: 0, expenseCount: 0, analysisCount: 0, pastIncome: [], pastExpenses: [] });
  }

  type RD = { income?: unknown[]; expenses?: unknown[] };

  const allIncome: PastIncome[] = [];
  const allExpenses: PastExpense[] = [];
  for (const a of analyses) {
    const rd = a.result_data as RD | null;
    if (Array.isArray(rd?.income)) {
      for (const r of rd!.income as Record<string, unknown>[]) {
        allIncome.push({
          Date: String(r.Date ?? ''),
          PropertyAddress: String(r.PropertyAddress ?? ''),
          Description: String(r.Description ?? ''),
          Amount: Number(r.Amount ?? 0),
        });
        if (allIncome.length >= MAX_INCOME_ROWS) break;
      }
    }
    if (Array.isArray(rd?.expenses)) {
      for (const r of rd!.expenses as Record<string, unknown>[]) {
        allExpenses.push({
          DueDate: String(r.DueDate ?? ''),
          Description: String(r.Description ?? ''),
          Category: String(r.Category ?? ''),
          Supplier: String(r.Supplier ?? ''),
          PropertyAddress: String(r.PropertyAddress ?? ''),
          Amount: Number(r.Amount ?? 0),
          CapitalExpense: Boolean(r.CapitalExpense),
          TenantPayable: Boolean(r.TenantPayable),
        });
        if (allExpenses.length >= MAX_EXPENSE_ROWS) break;
      }
    }
  }

  return NextResponse.json({
    incomeCount: allIncome.length,
    expenseCount: allExpenses.length,
    analysisCount: analyses.length,
    pastIncome: allIncome,
    pastExpenses: allExpenses,
  });
}
