import { NextRequest, NextResponse } from 'next/server';
import { hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/clients/[id]/quarterly-period-type ──────────────────────
// Sets whether a business reports on standard or calendar quarters — Business
// Details API v2.0 "Create and Amend Quarterly Period Type for a Business"
// (PUT /individuals/business/details/{nino}/{businessId}/{taxYear}). POST here so
// the browser-collected fraud-prevention data travels with it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveMtdItCtx(params.id);
  if (r instanceof NextResponse) return r;
  const { client, conn, userId } = r;

  const body = await req.json().catch(() => ({})) as {
    businessId?: string; taxYear?: string;
    quarterlyPeriodType?: 'standard' | 'calendar';
    fraudData?: ClientFraudData; testScenario?: string;
  };
  if (!body.businessId) return NextResponse.json({ error: 'businessId is required.' }, { status: 400 });
  if (!body.taxYear || !/^\d{4}-\d{2}$/.test(body.taxYear)) return NextResponse.json({ error: 'taxYear is required in the form 2026-27.' }, { status: 400 });
  if (body.quarterlyPeriodType !== 'standard' && body.quarterlyPeriodType !== 'calendar') {
    return NextResponse.json({ error: 'quarterlyPeriodType must be "standard" or "calendar".' }, { status: 400 });
  }

  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData, { userId, vendorPublicIp }) : {};

  const result = await hmrcRequest(conn, `/individuals/business/details/${client.nino}/${body.businessId}/${body.taxYear}`, {
    method: 'PUT', version: '2.0',
    body: { quarterlyPeriodType: body.quarterlyPeriodType },
    fraudHeaders, testScenario: body.testScenario || undefined,
  });
  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), status: result.status, detail: result.json }, { status: 502 });
  }
  // HMRC returns 204 No Content on success.
  return NextResponse.json({ ok: true, businessId: body.businessId, taxYear: body.taxYear, quarterlyPeriodType: body.quarterlyPeriodType });
}
