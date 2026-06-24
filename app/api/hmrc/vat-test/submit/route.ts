import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { getHmrcConnection, hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';

// ── POST /api/hmrc/vat-test/submit ───────────────────────────────────────────
// Admin sandbox harness — submit a VAT return for a VRN + period (evidence for
// the HMRC Production Approvals Checklist). Takes the nine box values directly
// (the user controls the test figures) and posts them via the same hmrcRequest
// path the live route uses. SANDBOX ONLY in practice — submission is otherwise
// irreversible; the env is surfaced so the UI can warn.
const FraudDataSchema = z.object({
  deviceId: z.string(), timezoneOffsetMinutes: z.number(), screenWidth: z.number(), screenHeight: z.number(),
  colourDepth: z.number(), scalingFactor: z.number(), windowWidth: z.number(), windowHeight: z.number(),
  userAgent: z.string(), doNotTrack: z.boolean(), localIPs: z.array(z.string()).default([]),
});
const Body = z.object({
  vrn: z.string().regex(/^\d{9}$/, 'VRN must be 9 digits'),
  periodKey: z.string().min(1),
  boxes: z.object({
    vatDueSales: z.number(),
    vatDueAcquisitions: z.number(),
    totalVatDue: z.number(),
    vatReclaimedCurrPeriod: z.number(),
    netVatDue: z.number(),
    totalValueSalesExVAT: z.number(),
    totalValuePurchasesExVAT: z.number(),
    totalValueGoodsSuppliedExVAT: z.number(),
    totalAcquisitionsExVAT: z.number(),
  }),
  finalised: z.boolean().default(true),
  fraudData: FraudDataSchema,
});

const r2 = (n: number) => +n.toFixed(2);

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

  const b = body.boxes;
  const payload = {
    periodKey: body.periodKey,
    vatDueSales: r2(b.vatDueSales),
    vatDueAcquisitions: r2(b.vatDueAcquisitions),
    totalVatDue: r2(b.totalVatDue),
    vatReclaimedCurrPeriod: r2(b.vatReclaimedCurrPeriod),
    netVatDue: r2(Math.abs(b.netVatDue)),
    totalValueSalesExVAT: Math.round(b.totalValueSalesExVAT),
    totalValuePurchasesExVAT: Math.round(b.totalValuePurchasesExVAT),
    totalValueGoodsSuppliedExVAT: Math.round(b.totalValueGoodsSuppliedExVAT),
    totalAcquisitionsExVAT: Math.round(b.totalAcquisitionsExVAT),
    finalised: body.finalised,
  };

  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = buildFraudHeaders(req, body.fraudData as ClientFraudData, { userId: ctx.userId, vendorPublicIp });

  const result = await hmrcRequest(conn, `/organisations/vat/${body.vrn}/returns`, { method: 'POST', body: payload, fraudHeaders });
  if (result.status !== 200 && result.status !== 201) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), httpStatus: result.status, raw: result.json, sent: payload }, { status: 502 });
  }
  return NextResponse.json({ httpStatus: result.status, raw: result.json, sent: payload });
}
