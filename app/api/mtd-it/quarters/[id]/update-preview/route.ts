import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { computeMtdItCumulative, type BusinessSource, type TypeOfBusiness } from '@/lib/mtdIt/computeUpdate';
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
    service.from('mtd_it_properties').select('id, address, property_type, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  const sources: BusinessSource[] = [
    ...(trades ?? []).map(t => ({
      kind: 'trade' as const, id: t.id as string, hmrcBusinessId: (t.hmrc_business_id as string | null) ?? null,
      typeOfBusiness: 'self-employment' as TypeOfBusiness, name: t.name as string,
    })),
    ...(props ?? []).map(p => ({
      kind: 'property' as const, id: p.id as string, hmrcBusinessId: (p.hmrc_business_id as string | null) ?? null,
      typeOfBusiness: (p.property_type === 'foreign' ? 'foreign-property' : 'uk-property') as TypeOfBusiness,
      name: p.address as string,
    })),
  ];

  const results = await Promise.all(sources.map(source =>
    computeMtdItCumulative(service, {
      clientId: client.id as string, taxYear: quarter.tax_year as number, quarterType, uptoQuarter, source,
    }),
  ));

  return NextResponse.json({
    quarter: { id: quarter.id, tax_year: quarter.tax_year, quarter: quarter.quarter, status: quarter.status },
    results,
  });
}
