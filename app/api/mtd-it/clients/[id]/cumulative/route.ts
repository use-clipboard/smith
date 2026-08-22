import { NextRequest, NextResponse } from 'next/server';
import { hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { resolveMtdItCtx } from '@/lib/hmrc/mtdItServer';
import { cumulativePath, cumulativeApiVersion } from '@/lib/mtdIt/hmrcBody';

// ── POST /api/mtd-it/clients/[id]/cumulative ─────────────────────────────────
// Retrieves the year-to-date cumulative period summary already held at HMRC for
// each of the client's linked businesses — so the preparer can see what HMRC
// currently has before filing an amendment. Exercises:
//   Retrieve a Self-Employment Cumulative Period Summary (GET, v5.0)
//   Retrieve a UK Property Cumulative Period Summary       (GET, v6.0)
//   Retrieve a Foreign Property Cumulative Period Summary  (GET, v6.0)
type BizType = 'self-employment' | 'uk-property' | 'foreign-property';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveMtdItCtx(params.id);
  if (r instanceof NextResponse) return r;
  const { client, conn, service, userId } = r;

  const body = await req.json().catch(() => ({})) as { taxYear?: string; fraudData?: ClientFraudData; testScenario?: string };
  if (!body.taxYear || !/^\d{4}-\d{2}$/.test(body.taxYear)) return NextResponse.json({ error: 'taxYear is required in the form 2026-27.' }, { status: 400 });

  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData, { userId, vendorPublicIp }) : {};

  // Linked income sources with an HMRC businessId.
  const [{ data: trades }, { data: props }] = await Promise.all([
    service.from('mtd_it_trades').select('id, name, hmrc_business_id').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, address, property_type, hmrc_business_id').eq('client_id', client.id).eq('active', true),
  ]);

  const units: { name: string; typeOfBusiness: BizType; businessId: string }[] = [];
  for (const t of trades ?? []) {
    const bid = t.hmrc_business_id as string | null;
    if (bid) units.push({ name: t.name as string, typeOfBusiness: 'self-employment', businessId: bid });
  }
  const seenProp = new Set<string>();
  for (const p of props ?? []) {
    const bid = p.hmrc_business_id as string | null;
    if (!bid) continue;
    const typeOfBusiness: BizType = (p.property_type as string) === 'foreign' ? 'foreign-property' : 'uk-property';
    const key = `${typeOfBusiness}:${bid}`;
    if (seenProp.has(key)) continue; // properties of one type aggregate into one HMRC business
    seenProp.add(key);
    units.push({ name: p.address as string, typeOfBusiness, businessId: bid });
  }

  if (!units.length) return NextResponse.json({ error: 'No linked income sources with an HMRC business ID — discover and link the client’s businesses first.' }, { status: 400 });

  const results = [];
  for (const u of units) {
    const path = cumulativePath(client.nino, u.businessId, u.typeOfBusiness, body.taxYear);
    const res = await hmrcRequest(conn, path, { version: cumulativeApiVersion(u.typeOfBusiness), fraudHeaders, testScenario: body.testScenario || undefined });
    results.push({
      name: u.name, typeOfBusiness: u.typeOfBusiness, businessId: u.businessId, status: res.status,
      summary: res.status < 400 ? res.json : null,
      error: res.status >= 400 ? hmrcErrorMessage(res.json) : null,
    });
  }
  return NextResponse.json({ taxYear: body.taxYear, results });
}
