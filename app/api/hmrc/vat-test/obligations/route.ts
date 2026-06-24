import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { getHmrcConnection, hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';

// ── POST /api/hmrc/vat-test/obligations ──────────────────────────────────────
// Admin sandbox harness — retrieve VAT obligations for a VRN (evidence for the
// HMRC Production Approvals Checklist). Mirrors the live book route but takes
// the VRN directly so no book is needed. Optional Gov-Test-Scenario for sandbox.
const FraudDataSchema = z.object({
  deviceId: z.string(), timezoneOffsetMinutes: z.number(), screenWidth: z.number(), screenHeight: z.number(),
  colourDepth: z.number(), scalingFactor: z.number(), windowWidth: z.number(), windowHeight: z.number(),
  userAgent: z.string(), doNotTrack: z.boolean(), localIPs: z.array(z.string()).default([]),
});
const Body = z.object({
  vrn: z.string().regex(/^\d{9}$/, 'VRN must be 9 digits'),
  status: z.enum(['O', 'F']).default('O'),
  testScenario: z.string().optional(),
  fraudData: FraudDataSchema,
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid request', detail: String(e) }, { status: 400 }); }

  const supa = createServiceClient();
  const conn = await getHmrcConnection(supa, 'vat', ctx.firmId, {});
  if (!conn) return NextResponse.json({ error: 'Connect HMRC (VAT) first.' }, { status: 400 });

  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = buildFraudHeaders(req, body.fraudData as ClientFraudData, { userId: ctx.userId, vendorPublicIp });

  const result = await hmrcRequest(conn, `/organisations/vat/${body.vrn}/obligations?status=${body.status}`, {
    fraudHeaders,
    testScenario: body.testScenario || undefined,
  });
  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), httpStatus: result.status, raw: result.json }, { status: 502 });
  }
  return NextResponse.json({ httpStatus: result.status, raw: result.json });
}
