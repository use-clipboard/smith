import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { HMRC_ENV } from '@/lib/hmrc/config';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';
import { itsaTaxYear, triggerFinalCalculation, retrieveCalculation, summariseCalculation } from '@/lib/tax-studio/hmrc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/tax-studio/returns/[id]/hmrc-calculate
// Triggers an HMRC final-declaration tax calculation for the return's client +
// year and retrieves it, so the accountant can review HMRC's own figures before
// crystallising. Reuses the MTD-IT HMRC connection (same self-assessment scope).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { fraudData?: ClientFraudData; testScenario?: string };
  if (!body.fraudData) return NextResponse.json({ error: 'Missing device data for HMRC fraud-prevention headers.' }, { status: 400 });

  const service = createServiceClient();
  const { data: row } = await service
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });
  const data = (row.data ?? {}) as { clientId?: string | null; taxYear?: string };
  if (!data.clientId) return NextResponse.json({ error: 'This return isn’t linked to a client.' }, { status: 400 });

  const r = await resolveMtdItCtx(data.clientId);
  if (r instanceof NextResponse) return r;

  const fraudHeaders = buildFraudHeaders(req, body.fraudData, { userId: ctx.userId, vendorPublicIp: await resolveVendorPublicIp() });
  const taxYear = itsaTaxYear(data.taxYear ?? '');
  const common = { conn: r.conn, nino: r.client.nino, taxYear, fraudHeaders, testScenario: body.testScenario };

  const trig = await triggerFinalCalculation(common);
  if (!trig.ok || !trig.calculationId) {
    return NextResponse.json({ error: trig.error ?? 'HMRC could not start the calculation.', hmrcStatus: trig.status }, { status: 502 });
  }

  const calc = await retrieveCalculation({ ...common, calculationId: trig.calculationId });
  const summary = calc.ok ? summariseCalculation(calc.json) : null;

  return NextResponse.json({
    ok: true,
    calculationId: trig.calculationId,
    isTest: HMRC_ENV !== 'production',
    hmrcStatus: calc.status,
    summary: summary ? { ...summary, calculationId: trig.calculationId } : { calculationId: trig.calculationId },
    retrieved: calc.ok,
  });
}
