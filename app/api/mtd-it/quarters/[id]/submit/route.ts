import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { getHmrcConnection, hmrcRequest, hmrcErrorMessage, type HmrcConnection } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { normaliseNino } from '@/lib/hmrc/mtdItServer';
import { computeFilingUnits, type TypeOfBusiness } from '@/lib/mtdIt/computeUpdate';
import { taxYearLabel } from '@/lib/mtdIt/quarters';
import { logAudit } from '@/lib/audit/log';
import { buildSelfEmploymentCumulativeBody, buildUkPropertyCumulativeBody, buildForeignPropertyCumulativeBody, buildForeignPropertyByIdCumulativeBody, foreignCumulativeUsesPropertyId, cumulativePath, cumulativeApiVersion, hmrcTaxYear } from '@/lib/mtdIt/hmrcBody';
import { ensureForeignPropertyIds } from '@/lib/mtdIt/foreignProperties';
import type { MtdItQuarterType } from '@/types';

// ── POST /api/mtd-it/quarters/[id]/submit ────────────────────────────────────
// Files the YTD cumulative update for each of the quarter's business sources.
// Gated on the quarter being client-APPROVED. Figures are recomputed
// server-side (never trust the client). Self-employment is submitted now;
// property is held until its field codelist is verified.
type SourceResult =
  | { name: string; typeOfBusiness: TypeOfBusiness; status: 'submitted'; businessId: string; reference: string | null }
  | { name: string; typeOfBusiness: TypeOfBusiness; status: 'skipped' | 'error'; reason: string };

interface OblPeriod { start: string; end: string; status: string }

/**
 * Fetch the client's HMRC obligation periods for the tax year, grouped by
 * businessId and sorted by period end. Lets us file the cumulative update
 * against the correct period (HMRC validates periodDates against an obligation).
 * Best-effort — returns an empty map on any failure so the caller falls back to
 * the computed quarter dates.
 */
async function fetchObligationPeriods(
  conn: HmrcConnection, nino: string, fraudHeaders: Record<string, string>,
  testScenario: string | undefined, taxYearInt: number,
): Promise<Map<string, OblPeriod[]>> {
  const map = new Map<string, OblPeriod[]>();
  try {
    const r = await hmrcRequest(conn, `/obligations/details/${nino}/income-and-expenditure`, { version: '3.0', fraudHeaders, testScenario });
    if (r.status < 200 || r.status >= 300) return map;
    const yearStart = `${taxYearInt}-04-06`, yearEnd = `${taxYearInt + 1}-04-05`;
    const groups = ((r.json as { obligations?: unknown[] } | null)?.obligations ?? []) as Array<Record<string, unknown>>;
    for (const g of groups) {
      const bid = (g.businessId ?? g.referenceNumber) as string | undefined;
      if (!bid) continue;
      const details = (g.obligationDetails ?? g.details ?? []) as Array<Record<string, unknown>>;
      const periods = details
        .map(d => ({ start: String(d.periodStartDate ?? ''), end: String(d.periodEndDate ?? ''), status: String(d.status ?? '') }))
        .filter(p => p.start && p.end && p.start >= yearStart && p.end <= yearEnd)
        .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
      if (periods.length) map.set(bid, periods);
    }
  } catch { /* fall back to computed dates */ }
  return map;
}

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
    .from('clients').select('id, name, national_insurance_number, mtd_it_quarter_type').eq('id', quarter.client_id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (quarter.status === 'not_started') {
    return NextResponse.json({ error: 'Add the quarter’s entries before submitting to HMRC.' }, { status: 400 });
  }
  const nino = normaliseNino(client.national_insurance_number as string | null);
  if (!nino) return NextResponse.json({ error: "Set the client's National Insurance number first." }, { status: 400 });

  const conn = await getHmrcConnection(service, 'mtd_it', ctx.firmId, { clientId: client.id as string });
  if (!conn) return NextResponse.json({ error: 'Connect to HMRC (Income Tax) first.' }, { status: 400 });

  const quarterType: MtdItQuarterType = (client.mtd_it_quarter_type as MtdItQuarterType) ?? 'calendar';
  const uptoQuarter = quarter.quarter as 1 | 2 | 3 | 4;
  const taxYearStr = hmrcTaxYear(quarter.tax_year as number);
  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData, { userId: ctx.userId, vendorPublicIp }) : {};

  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, country, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  // The actual HMRC filing units: self-employment per trade; UK property
  // aggregated into the single UK business; foreign property aggregated into the
  // single foreign business (split by country). Aggregation is the whole point —
  // a client with several UK (or foreign) properties files ONE combined return
  // per business, so filing one property at a time would under-declare.
  const { units, errors: planErrors } = await computeFilingUnits(service, {
    clientId: client.id as string, taxYear: quarter.tax_year as number, quarterType, uptoQuarter,
    trades: (trades ?? []).map(t => ({ id: t.id as string, name: t.name as string, hmrcBusinessId: (t.hmrc_business_id as string | null) ?? null })),
    props: (props ?? []).map(p => ({ id: p.id as string, address: p.address as string, propertyType: p.property_type as 'uk' | 'foreign', country: (p.country as string | null) ?? null, hmrcBusinessId: (p.hmrc_business_id as string | null) ?? null })),
  });

  // Refuse to file anything that would under-declare. This lives here, before
  // the HMRC loop, rather than relying on the modal's disabled button: the modal
  // can be deep-linked open or left stale, and a filing is not reversible.
  if (planErrors.length > 0) {
    return NextResponse.json({ error: planErrors[0], errors: planErrors }, { status: 400 });
  }

  // Real HMRC obligation periods (best-effort) so we file against the right one.
  const obligationsByBusiness = await fetchObligationPeriods(conn, nino, fraudHeaders, body.testScenario || undefined, quarter.tax_year as number);

  const results: SourceResult[] = [];
  let submitted = 0, errors = 0;

  for (const unit of units) {
    if (!unit.businessId) {
      results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'skipped', reason: 'Not linked to an HMRC business.' });
      continue;
    }

    // File against the actual HMRC obligation period when we have it: the
    // cumulative window runs from the first obligation's start to the chosen
    // quarter's obligation end. Falls back to the computed dates otherwise.
    let periodStartDate = unit.figures.periodStartDate;
    let periodEndDate = unit.figures.periodEndDate;
    const periods = obligationsByBusiness.get(unit.businessId) ?? [];
    if (periods.length > 0) {
      periodStartDate = periods[0].start;
      periodEndDate = (periods[uptoQuarter - 1] ?? periods[periods.length - 1]).end;
    }

    let payload: object;
    if (unit.typeOfBusiness === 'self-employment') {
      payload = buildSelfEmploymentCumulativeBody({ ...unit.figures, periodStartDate, periodEndDate }, Boolean(body.useConsolidated));
    } else if (unit.typeOfBusiness === 'uk-property') {
      payload = buildUkPropertyCumulativeBody({ ...unit.figures, periodStartDate, periodEndDate }, Boolean(body.useConsolidated));
    } else if (foreignCumulativeUsesPropertyId(quarter.tax_year as number)) {
      // Foreign property, TY 2026-27+ (def2): keyed by HMRC propertyId. Resolve
      // or create an HMRC propertyId for each foreign property, then file per
      // property. The envelope is isolated in hmrcBody.ts.
      const splits = unit.foreignProperties ?? [];
      if (splits.length === 0) {
        results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'skipped', reason: 'No foreign property to file.' });
        continue;
      }
      // Cached HMRC per-property ids (best-effort; the column may not exist yet).
      let cachedIds = new Map<string, string | null>();
      try {
        const { data: idRows } = await service.from('mtd_it_properties').select('id, hmrc_property_id').in('id', splits.map(s => s.smithPropertyId));
        cachedIds = new Map((idRows ?? []).map(r => [r.id as string, (r.hmrc_property_id as string | null) ?? null]));
      } catch { /* column missing → resolve fresh via list/create */ }
      const { map: idMap, errors: idErrors } = await ensureForeignPropertyIds(
        service, conn, nino, unit.businessId, taxYearStr,
        splits.map(s => ({ id: s.smithPropertyId, address: s.address, country: s.country, hmrcPropertyId: cachedIds.get(s.smithPropertyId) ?? null })),
        fraudHeaders, body.testScenario || undefined,
      );
      if (idErrors.length > 0) {
        results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'skipped', reason: `Couldn't set up the foreign property at HMRC: ${idErrors[0].reason}` });
        continue;
      }
      const entries = splits
        .map(s => {
          const propertyId = idMap.get(s.smithPropertyId);
          return propertyId ? { propertyId, income: s.income, expensesByField: s.expensesByField, consolidatedExpenses: s.consolidatedExpenses, residentialFinanceCost: s.residentialFinanceCost, residentialFinanceCostBroughtFwd: s.residentialFinanceCostBroughtFwd } : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      if (entries.length === 0) {
        results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'skipped', reason: 'No foreign property could be linked to HMRC.' });
        continue;
      }
      payload = buildForeignPropertyByIdCumulativeBody(periodStartDate, periodEndDate, entries, Boolean(body.useConsolidated));
    } else {
      // Foreign property, TY 2025-26 (def1): keyed by countryCode. Drop any
      // country we couldn't resolve (never file a blank code).
      const countries = (unit.foreignCountries ?? []).filter(c => c.countryCode) as Array<{ countryCode: string; income: number; expensesByField: Record<string, number>; consolidatedExpenses: number; residentialFinanceCost: number; residentialFinanceCostBroughtFwd: number }>;
      if (countries.length === 0) {
        results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'skipped', reason: 'Set a valid country (e.g. "France" or "FRA") on the foreign property before filing.' });
        continue;
      }
      payload = buildForeignPropertyCumulativeBody(periodStartDate, periodEndDate, countries, Boolean(body.useConsolidated));
    }

    const path = cumulativePath(nino, unit.businessId, unit.typeOfBusiness, taxYearStr);
    const r = await hmrcRequest(conn, path, {
      method: 'PUT', body: payload, version: cumulativeApiVersion(unit.typeOfBusiness),
      fraudHeaders, testScenario: body.testScenario || undefined,
    });

    await service.from('mtd_it_submissions').insert({
      quarter_id: quarter.id, client_id: client.id, business_id: unit.businessId,
      type_of_business: unit.typeOfBusiness, tax_year: taxYearStr, period_to: periodEndDate,
      payload, hmrc_status: r.status, hmrc_response: r.json as object, submitted_by: ctx.userId,
    });

    if (r.status >= 200 && r.status < 300) {
      submitted++;
      const resp = (r.json ?? {}) as Record<string, unknown>;
      const reference = (resp.transactionReference ?? resp.submissionId ?? resp.calculationId ?? null) as string | null;
      results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'submitted', businessId: unit.businessId, reference });
    } else {
      errors++;
      results.push({ name: unit.name, typeOfBusiness: unit.typeOfBusiness, status: 'error', reason: hmrcErrorMessage(r.json) });
    }
  }

  // Flip the quarter to 'submitted' ONLY when EVERY stream was filed
  // successfully — nothing errored and nothing was skipped (unmapped, or
  // property pending). A partial filing leaves the status as-is.
  const skipped = results.filter(r => r.status === 'skipped').length;
  let quarterStatus = quarter.status as string;
  if (submitted > 0 && errors === 0 && skipped === 0) {
    // submitted_at is the precise filing moment (updated_at moves on any edit).
    const submittedIso = new Date().toISOString();
    await service.from('mtd_it_quarters')
      .update({ status: 'submitted', submitted_at: submittedIso, updated_at: submittedIso })
      .eq('id', quarter.id);
    quarterStatus = 'submitted';
  }

  // Audit the filing whenever at least one stream was actually sent to HMRC.
  if (submitted > 0) {
    await logAudit({
      firmId: ctx.firmId, tool: 'mtd_it', action: 'submitted',
      entityId: quarter.id as string, entityLabel: (client.name as string) ?? null, clientId: client.id as string,
      actorId: ctx.userId,
      summary: `Submitted Q${quarter.quarter} ${taxYearLabel(quarter.tax_year as number)} to HMRC — ${submitted} stream${submitted === 1 ? '' : 's'} filed${errors ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''}${skipped ? `, ${skipped} skipped` : ''}`,
    });
  }

  return NextResponse.json({ results, submitted, errors, skipped, quarterStatus });
}
