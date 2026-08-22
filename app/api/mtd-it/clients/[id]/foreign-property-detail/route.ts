import { NextRequest, NextResponse } from 'next/server';
import { hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/clients/[id]/foreign-property-detail ────────────────────
// Amends an existing foreign property's details — Property Business API v6.0
// "Update a Foreign Property Detail"
// (PUT /individuals/business/property/foreign/{nino}/details/{propId}/{taxYear}).
// Used to rename a property or record that letting has ended (endDate/endReason).
// HMRC Property Business API v6.0 accepts a single endReason value for a foreign
// property detail — verified empirically against the sandbox (2026-08-22): every
// other candidate ('property-sold', 'other', …) is rejected with FORMAT_END_REASON.
const END_REASONS = new Set(['no-longer-renting-property-out']);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveMtdItCtx(params.id);
  if (r instanceof NextResponse) return r;
  const { client, conn, userId } = r;

  const body = await req.json().catch(() => ({})) as {
    propertyId?: string; taxYear?: string; propertyName?: string;
    endDate?: string; endReason?: string;
    fraudData?: ClientFraudData; testScenario?: string;
  };
  if (!body.propertyId) return NextResponse.json({ error: 'propertyId is required.' }, { status: 400 });
  if (!body.taxYear || !/^\d{4}-\d{2}$/.test(body.taxYear)) return NextResponse.json({ error: 'taxYear is required in the form 2026-27.' }, { status: 400 });
  if (!body.propertyName?.trim()) return NextResponse.json({ error: 'propertyName is required.' }, { status: 400 });
  if (body.endReason && !END_REASONS.has(body.endReason)) {
    return NextResponse.json({ error: 'endReason must be: no-longer-renting-property-out.' }, { status: 400 });
  }

  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData, { userId, vendorPublicIp }) : {};

  const payload: Record<string, string> = { propertyName: body.propertyName.trim().slice(0, 90) };
  if (body.endDate) payload.endDate = body.endDate;
  if (body.endReason) payload.endReason = body.endReason;

  const result = await hmrcRequest(conn, `/individuals/business/property/foreign/${client.nino}/details/${body.propertyId}/${body.taxYear}`, {
    method: 'PUT', version: '6.0', body: payload,
    fraudHeaders, testScenario: body.testScenario || undefined,
  });
  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), status: result.status, detail: result.json }, { status: 502 });
  }
  // HMRC returns 204 No Content on success.
  return NextResponse.json({ ok: true, propertyId: body.propertyId, taxYear: body.taxYear });
}
