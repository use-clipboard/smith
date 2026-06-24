import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { HMRC_BASE_URL, HMRC_ENV, isHmrcConfigured } from '@/lib/hmrc/config';
import { getApplicationToken } from '@/lib/hmrc/client';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';

// ── POST /api/hmrc/validate-fraud-headers ────────────────────────────────────
// Admin dev/compliance harness for HMRC production approval. Builds the exact
// Gov-Client-* / Gov-Vendor-* fraud-prevention headers SMITH would send on a
// real MTD call, then sends them to HMRC's Test Fraud Prevention Headers
// validator (application-restricted: GET /test/fraud-prevention-headers/validate)
// and returns the verdict + the headers we sent. Getting a clean result here is
// a hard prerequisite for HMRC issuing production credentials for VAT and MTD IT.

const FraudDataSchema = z.object({
  deviceId: z.string(),
  timezoneOffsetMinutes: z.number(),
  screenWidth: z.number(),
  screenHeight: z.number(),
  colourDepth: z.number(),
  scalingFactor: z.number(),
  windowWidth: z.number(),
  windowHeight: z.number(),
  userAgent: z.string(),
  doNotTrack: z.boolean(),
  localIPs: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  if (!isHmrcConfigured()) {
    return NextResponse.json({
      error: 'HMRC software credentials are not configured. Set HMRC_CLIENT_ID and HMRC_CLIENT_SECRET (sandbox) before validating headers.',
    }, { status: 400 });
  }

  let fraudData: ClientFraudData;
  try { fraudData = FraudDataSchema.parse((await req.json()).fraudData) as ClientFraudData; }
  catch (e) { return NextResponse.json({ error: 'Invalid fraud data', detail: String(e) }, { status: 400 }); }

  const vendorPublicIp = await resolveVendorPublicIp();
  const headers = buildFraudHeaders(req, fraudData, { userId: ctx.userId, vendorPublicIp });

  // Application-restricted endpoint → server token via client-credentials.
  let token: string;
  try {
    token = (await getApplicationToken()).access_token;
  } catch (e) {
    return NextResponse.json({ error: `Could not get an HMRC application token: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  let res: Response;
  try {
    res = await fetch(`${HMRC_BASE_URL}/test/fraud-prevention-headers/validate`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.hmrc.1.0+json',
        ...headers,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach the HMRC validator: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  // The validator returns 200 with a body describing any errors/warnings. We
  // pass the raw body straight back plus a small normalised summary so the UI
  // can render a clear pass/warn/fail without guessing the exact schema.
  const b = (body ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(b.errors) ? b.errors : [];
  const warnings = Array.isArray(b.warnings) ? b.warnings : [];
  const verdict = res.status >= 400 || errors.length > 0
    ? 'fail'
    : warnings.length > 0 ? 'warn' : 'pass';

  return NextResponse.json({
    env: HMRC_ENV,
    httpStatus: res.status,
    verdict,
    code: typeof b.code === 'string' ? b.code : null,
    message: typeof b.message === 'string' ? b.message : null,
    errors,
    warnings,
    raw: body,
    // Echo the exact headers we sent so the user can eyeball each value.
    headersSent: headers,
  });
}
