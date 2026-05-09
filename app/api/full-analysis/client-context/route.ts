import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Cap context to keep token cost predictable. Most-recent first.
const MAX_ANALYSES = 5;
const MAX_ROWS = 500;

// GET /api/full-analysis/client-context?clientId=<uuid>&software=<TargetSoftware>
//
// Builds a synthetic "past transactions" CSV from this client's most recent
// Full Analysis runs that used the same target software. Feeds the AI so it
// can stay consistent with the client's previous account-code choices and
// flag potential duplicates.
//
// Returns: { csv: string, rowCount: number, analysisCount: number }
//
// Empty payload (csv: '', rowCount: 0) is a valid no-context response.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const software = url.searchParams.get('software');

  if (!clientId || !software) {
    return NextResponse.json({ csv: '', rowCount: 0, analysisCount: 0 });
  }

  const supabase = createClient();

  // Most recent same-software analyses for this client, scoped to firm.
  const { data, error } = await supabase
    .from('outputs')
    .select('id, target_software, result_data, created_at')
    .eq('feature', 'full_analysis')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId)
    .eq('target_software', software)
    .order('created_at', { ascending: false })
    .limit(MAX_ANALYSES);

  if (error) {
    console.error('[GET /api/full-analysis/client-context]', error);
    return NextResponse.json({ csv: '', rowCount: 0, analysisCount: 0 });
  }

  const analyses = data ?? [];
  if (analyses.length === 0) {
    return NextResponse.json({ csv: '', rowCount: 0, analysisCount: 0 });
  }

  // Flatten transactions, newest analysis first (so most recent code choices win after dedup).
  const allRows: Record<string, unknown>[] = [];
  for (const a of analyses) {
    const txs = (a.result_data as { transactions?: Record<string, unknown>[] } | null)?.transactions;
    if (Array.isArray(txs)) allRows.push(...txs);
    if (allRows.length >= MAX_ROWS) break;
  }
  const capped = allRows.slice(0, MAX_ROWS);
  if (capped.length === 0) {
    return NextResponse.json({ csv: '', rowCount: 0, analysisCount: analyses.length });
  }

  // Build CSV — union of keys from sampled rows, in insertion order.
  const headerSet = new Set<string>();
  for (const row of capped) Object.keys(row).forEach(k => headerSet.add(k));
  const headers = [...headerSet];

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    return `"${String(v).replace(/"/g, '""')}"`;
  };

  const lines = [
    headers.map(h => `"${h}"`).join(','),
    ...capped.map(row => headers.map(h => escape(row[h])).join(',')),
  ];

  return NextResponse.json({
    csv: lines.join('\n'),
    rowCount: capped.length,
    analysisCount: analyses.length,
  });
}
