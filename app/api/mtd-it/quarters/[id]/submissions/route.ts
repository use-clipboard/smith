import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── GET /api/mtd-it/quarters/[id]/submissions ────────────────────────────────
// The HMRC submission receipts recorded for this quarter (audit trail).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  // Firm scope via the quarter's client.
  const { data: quarter } = await service
    .from('mtd_it_quarters').select('id, client_id').eq('id', params.id).single();
  if (!quarter) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: client } = await service
    .from('clients').select('id').eq('id', quarter.client_id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await service
    .from('mtd_it_submissions')
    .select('id, business_id, type_of_business, tax_year, period_to, hmrc_status, hmrc_response, submitted_at, submitter:users!mtd_it_submissions_submitted_by_fkey(full_name, email)')
    .eq('quarter_id', params.id)
    .order('submitted_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Extract a human-facing HMRC reference if the receipt carried one.
  const submissions = (data ?? []).map(s => {
    const resp = (s.hmrc_response ?? {}) as Record<string, unknown>;
    const ref = (resp.transactionReference ?? resp.submissionId ?? resp.calculationId ?? null) as string | null;
    const creator = Array.isArray(s.submitter) ? s.submitter[0] : s.submitter;
    return {
      id: s.id,
      business_id: s.business_id,
      type_of_business: s.type_of_business,
      tax_year: s.tax_year,
      period_to: s.period_to,
      ok: typeof s.hmrc_status === 'number' && s.hmrc_status >= 200 && s.hmrc_status < 300,
      hmrc_status: s.hmrc_status,
      hmrc_reference: ref,
      submitted_at: s.submitted_at,
      submitted_by: creator ? (creator.full_name ?? creator.email ?? null) : null,
    };
  });

  return NextResponse.json({ submissions });
}
