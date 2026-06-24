import { NextRequest, NextResponse } from 'next/server';
import { hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/clients/[clientId]/businesses ───────────────────────────
// Lists the client's HMRC income sources (Business Details API v2.0,
// "List All Businesses") and the current trade/property → businessId mapping.
// POST so the browser-collected fraud-prevention data can be sent (ITSA reads
// also legally require the fraud headers).
interface HmrcBusiness { typeOfBusiness?: string; businessId?: string; tradingName?: string }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveMtdItCtx(params.id);
  if (r instanceof NextResponse) return r;
  const { client, conn, service, userId } = r;

  const body = await req.json().catch(() => ({})) as { fraudData?: ClientFraudData; testScenario?: string };
  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData, { userId, vendorPublicIp }) : {};

  const result = await hmrcRequest(conn, `/individuals/business/details/${client.nino}/list`, {
    version: '2.0', fraudHeaders, testScenario: body.testScenario || undefined,
  });
  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcErrorMessage(result.json), status: result.status, detail: result.json }, { status: 502 });
  }

  const j = result.json as { listOfBusinesses?: HmrcBusiness[]; businesses?: HmrcBusiness[] } | null;
  const businesses = (j?.listOfBusinesses ?? j?.businesses ?? []).filter(b => b.businessId);

  // Current mapping so the UI can show which sources are already linked.
  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  return NextResponse.json({
    businesses,
    trades: trades ?? [],
    properties: props ?? [],
  });
}
