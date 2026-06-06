import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── GET /api/mtd-it/agent/clients ────────────────────────────────────────────
// The firm's MTD-IT clients with their HMRC identifiers + a count of mapped vs
// total income sources. Feeds the bulk-onboarding grid. Admin only.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  const service = createServiceClient();
  const { data: clients } = await service
    .from('clients')
    .select('id, name, client_ref, national_insurance_number, utr_number')
    .eq('firm_id', ctx.firmId).eq('mtd_it', true)
    .order('name');

  const ids = (clients ?? []).map(c => c.id as string);
  // Source counts (total + mapped) per client, in two cheap queries.
  const counts = new Map<string, { total: number; mapped: number }>();
  if (ids.length) {
    const [{ data: trades }, { data: props }] = await Promise.all([
      service.from('mtd_it_trades').select('client_id, hmrc_business_id').in('client_id', ids).eq('active', true),
      service.from('mtd_it_properties').select('client_id, hmrc_business_id').in('client_id', ids).eq('active', true),
    ]);
    for (const row of [...(trades ?? []), ...(props ?? [])]) {
      const cid = row.client_id as string;
      const c = counts.get(cid) ?? { total: 0, mapped: 0 };
      c.total += 1;
      if (row.hmrc_business_id) c.mapped += 1;
      counts.set(cid, c);
    }
  }

  const out = (clients ?? []).map(c => ({
    id: c.id, name: c.name, client_ref: c.client_ref,
    nino: c.national_insurance_number ?? '', self_assessment_utr: c.utr_number ?? '',
    sources: counts.get(c.id as string) ?? { total: 0, mapped: 0 },
  }));
  return NextResponse.json({ clients: out });
}
