import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

interface ReviewPoint { severity?: string; suggestedJournal?: { amount?: number | string | null } | null }
interface FinalAccountsResult {
  reviewPoints?: ReviewPoint[];
  workingPapers?: unknown[];
  businessName?: string;
  periodEnd?: string;
  dateTo?: string;
}

// ── GET /api/accounts-studio/review-results?clientId=… ───────────────────────
// The real Accounts Review round-trip: return the client's saved
// final_accounts_review runs with a computed summary so Accounts Studio can
// pull the actual review points, serious count, proposed journals and working
// papers back into the engagement.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('outputs')
    .select('id, client_name, created_at, result_data')
    .eq('firm_id', ctx.firmId)
    .eq('feature', 'final_accounts_review')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reviews = (data ?? []).map(row => {
    const rd = (row.result_data ?? {}) as FinalAccountsResult;
    const points = Array.isArray(rd.reviewPoints) ? rd.reviewPoints : [];
    const serious = points.filter(p => String(p.severity).toLowerCase() === 'serious').length;
    const journals = points.filter(p => {
      const amt = p.suggestedJournal?.amount;
      return amt !== null && amt !== undefined && Number(amt) !== 0;
    }).length;
    return {
      id: row.id as string,
      savedAt: row.created_at as string,
      businessName: (row.client_name as string | null) ?? rd.businessName ?? 'Accounts Review',
      periodEnd: rd.periodEnd ?? rd.dateTo ?? '',
      reviewPoints: points.length,
      serious,
      journals,
      workingPapers: Array.isArray(rd.workingPapers) && rd.workingPapers.length > 0,
    };
  });

  return NextResponse.json({ reviews });
}
