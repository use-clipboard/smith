import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { getHmrcConnection, hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { normaliseNino } from '@/lib/hmrc/mtdItServer';
import { computeMtdItCumulative, type BusinessSource, type TypeOfBusiness } from '@/lib/mtdIt/computeUpdate';
import { buildSelfEmploymentCumulativeBody, cumulativePath, cumulativeApiVersion, hmrcTaxYear } from '@/lib/mtdIt/hmrcBody';
import type { MtdItQuarterType } from '@/types';

// ── POST /api/mtd-it/quarters/[id]/submit ────────────────────────────────────
// Files the YTD cumulative update for each of the quarter's business sources.
// Gated on the quarter being client-APPROVED. Figures are recomputed
// server-side (never trust the client). Self-employment is submitted now;
// property is held until its field codelist is verified.
type SourceResult =
  | { name: string; typeOfBusiness: TypeOfBusiness; status: 'submitted'; businessId: string }
  | { name: string; typeOfBusiness: TypeOfBusiness; status: 'skipped' | 'error'; reason: string };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) return NextResponse.json({ error: 'HMRC is not configured.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { fraudData?: ClientFraudData; testScenario?: string; useConsolidated?: boolean };

  const service = createServiceClient();
  const { data: quarter } = await service
    .from('mtd_it_quarters').select('id, client_id, tax_year, quarter, status').eq('id', params.id).single();
  if (!quarter) return NextResponse.json({ error: 'Quarter not found.' }, { status: 404 });

  const { data: client } = await service
    .from('clients').select('id, name, nino, mtd_it_quarter_type').eq('id', quarter.client_id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (quarter.status !== 'approved') {
    return NextResponse.json({ error: 'This quarter must be client-approved before submitting to HMRC.' }, { status: 400 });
  }
  const nino = normaliseNino(client.nino as string | null);
  if (!nino) return NextResponse.json({ error: "Set the client's National Insurance number first." }, { status: 400 });

  const conn = await getHmrcConnection(service, 'mtd_it', ctx.firmId, { clientId: client.id as string });
  if (!conn) return NextResponse.json({ error: 'Connect to HMRC (Income Tax) first.' }, { status: 400 });

  const quarterType: MtdItQuarterType = (client.mtd_it_quarter_type as MtdItQuarterType) ?? 'calendar';
  const uptoQuarter = quarter.quarter as 1 | 2 | 3 | 4;
  const taxYearStr = hmrcTaxYear(quarter.tax_year as number);
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData) : {};

  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  const sources: BusinessSource[] = [
    ...(trades ?? []).map(t => ({ kind: 'trade' as const, id: t.id as string, hmrcBusinessId: (t.hmrc_business_id as string | null) ?? null, typeOfBusiness: 'self-employment' as TypeOfBusiness, name: t.name as string })),
    ...(props ?? []).map(p => ({ kind: 'property' as const, id: p.id as string, hmrcBusinessId: (p.hmrc_business_id as string | null) ?? null, typeOfBusiness: (p.property_type === 'foreign' ? 'foreign-property' : 'uk-property') as TypeOfBusiness, name: p.address as string })),
  ];

  const results: SourceResult[] = [];
  let submitted = 0, errors = 0;

  for (const source of sources) {
    // Property submission is held until its field codelist is verified.
    if (source.typeOfBusiness !== 'self-employment') {
      results.push({ name: source.name, typeOfBusiness: source.typeOfBusiness, status: 'skipped', reason: 'Property submission is not enabled yet.' });
      continue;
    }
    if (!source.hmrcBusinessId) {
      results.push({ name: source.name, typeOfBusiness: source.typeOfBusiness, status: 'skipped', reason: 'Not linked to an HMRC business.' });
      continue;
    }

    const figures = await computeMtdItCumulative(service, { clientId: client.id as string, taxYear: quarter.tax_year as number, quarterType, uptoQuarter, source });
    const payload = buildSelfEmploymentCumulativeBody(figures, Boolean(body.useConsolidated));
    const path = cumulativePath(nino, source.hmrcBusinessId, source.typeOfBusiness, taxYearStr);

    const r = await hmrcRequest(conn, path, {
      method: 'PUT', body: payload, version: cumulativeApiVersion(source.typeOfBusiness),
      fraudHeaders, testScenario: body.testScenario || undefined,
    });

    await service.from('mtd_it_submissions').insert({
      quarter_id: quarter.id, client_id: client.id, business_id: source.hmrcBusinessId,
      type_of_business: source.typeOfBusiness, tax_year: taxYearStr, period_to: figures.periodEndDate,
      payload, hmrc_status: r.status, hmrc_response: r.json as object, submitted_by: ctx.userId,
    });

    if (r.status >= 200 && r.status < 300) {
      submitted++;
      results.push({ name: source.name, typeOfBusiness: source.typeOfBusiness, status: 'submitted', businessId: source.hmrcBusinessId });
    } else {
      errors++;
      results.push({ name: source.name, typeOfBusiness: source.typeOfBusiness, status: 'error', reason: hmrcErrorMessage(r.json) });
    }
  }

  // Flip the quarter to 'submitted' only when something was filed and nothing errored.
  let quarterStatus = quarter.status as string;
  if (submitted > 0 && errors === 0) {
    await service.from('mtd_it_quarters').update({ status: 'submitted', updated_at: new Date().toISOString() }).eq('id', quarter.id);
    quarterStatus = 'submitted';
  }

  return NextResponse.json({ results, submitted, errors, quarterStatus });
}
