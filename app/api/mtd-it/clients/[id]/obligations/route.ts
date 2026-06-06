import { NextRequest, NextResponse } from 'next/server';
import { hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/clients/[clientId]/obligations ──────────────────────────
// Retrieves the client's Income Tax quarterly obligations (Obligations API
// v3.0, income-and-expenditure). Optionally filtered to a single business.
// POST so the browser-collected fraud-prevention data can be sent.
const TYPES = new Set(['self-employment', 'uk-property', 'foreign-property']);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveMtdItCtx(params.id);
  if (r instanceof NextResponse) return r;
  const { client, conn } = r;

  const body = await req.json().catch(() => ({})) as {
    fraudData?: ClientFraudData; testScenario?: string;
    typeOfBusiness?: string; businessId?: string; status?: 'Open' | 'Fulfilled';
  };
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData) : {};

  const qs = new URLSearchParams();
  if (body.typeOfBusiness && TYPES.has(body.typeOfBusiness)) qs.set('typeOfBusiness', body.typeOfBusiness);
  if (body.businessId) qs.set('businessId', body.businessId);
  if (body.status) qs.set('status', body.status);
  const query = qs.toString();

  const result = await hmrcRequest(
    conn,
    `/obligations/details/${client.nino}/income-and-expenditure${query ? `?${query}` : ''}`,
    { version: '3.0', fraudHeaders, testScenario: body.testScenario || undefined },
  );
  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), status: result.status, detail: result.json }, { status: 502 });
  }

  const obligations = (result.json as { obligations?: unknown[] } | null)?.obligations ?? [];
  return NextResponse.json({ obligations });
}
