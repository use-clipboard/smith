import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { computeFilingUnits } from '@/lib/mtdIt/computeUpdate';
import type { MtdItQuarterType } from '@/types';

// ── GET /api/mtd-it/quarters/[id]/update-preview ─────────────────────────────
// Computes the YTD cumulative HMRC figures for every business source on this
// quarter's client. Read-only — nothing is sent to HMRC. Drives the submit
// preview + lets us validate the compute before wiring real submission.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data: quarter } = await service
    .from('mtd_it_quarters').select('id, client_id, tax_year, quarter, status').eq('id', params.id).single();
  if (!quarter) return NextResponse.json({ error: 'Quarter not found.' }, { status: 404 });

  // Firm scope via the client.
  const { data: client } = await service
    .from('clients').select('id, mtd_it_quarter_type').eq('id', quarter.client_id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const quarterType: MtdItQuarterType = (client.mtd_it_quarter_type as MtdItQuarterType) ?? 'calendar';
  const uptoQuarter = quarter.quarter as 1 | 2 | 3 | 4;

  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, country, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  // Use the SAME filing units as the real submission, so the preview figures are
  // exactly what gets filed (UK/foreign property aggregated into one unit each).
  const units = await computeFilingUnits(service, {
    clientId: client.id as string, taxYear: quarter.tax_year as number, quarterType, uptoQuarter,
    trades: (trades ?? []).map(t => ({ id: t.id as string, name: t.name as string, hmrcBusinessId: (t.hmrc_business_id as string | null) ?? null })),
    props: (props ?? []).map(p => ({ id: p.id as string, address: p.address as string, propertyType: p.property_type as 'uk' | 'foreign', country: (p.country as string | null) ?? null, hmrcBusinessId: (p.hmrc_business_id as string | null) ?? null })),
  });

  // Flatten to the per-unit shape the submit modal renders (figures + the unit's
  // display name / business id / type).
  const results = units.map(u => ({
    ...u.figures,
    typeOfBusiness: u.typeOfBusiness,
    businessId: u.businessId,
    name: u.name,
  }));

  return NextResponse.json({
    quarter: { id: quarter.id, tax_year: quarter.tax_year, quarter: quarter.quarter, status: quarter.status },
    results,
  });
}
