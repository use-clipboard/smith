import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { getHmrcConnection, hmrcRequest, hmrcErrorMessage } from '@/lib/hmrc/api';
import { buildFraudHeaders, resolveVendorPublicIp, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';
import { normaliseNino } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/agent/discover-businesses ───────────────────────────────
// Using the firm's MTD-IT AGENT connection, sweep a set of clients and fetch
// each one's HMRC income sources (Business Details "List All Businesses"). One
// agent token covers every authorised client. Returns a per-client bucketed
// result for the bulk-onboarding review screen. Admin only.
interface HmrcBusiness { typeOfBusiness?: string; businessId?: string; tradingName?: string }

const Body = z.object({
  clientIds: z.array(z.string().uuid()).max(500).optional(),
  fraudData: z.any().optional(),
  testScenario: z.string().optional(),
});

type Outcome =
  | { clientId: string; name: string; status: 'ok'; businesses: HmrcBusiness[] }
  | { clientId: string; name: string; status: 'missing_nino' | 'needs_auth' | 'error'; error?: string };

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  if (!isHmrcConfigured()) return NextResponse.json({ error: 'HMRC is not configured.' }, { status: 400 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();

  // Resolve the client set: explicit ids, else all MTD-IT-flagged firm clients.
  let q = service.from('clients').select('id, name, national_insurance_number').eq('firm_id', ctx.firmId);
  if (body.clientIds?.length) q = q.in('id', body.clientIds);
  else q = q.eq('mtd_it', true);
  const { data: clients } = await q;

  const fraudData = body.fraudData as ClientFraudData | undefined;
  const vendorPublicIp = await resolveVendorPublicIp();
  const fraudHeaders = fraudData ? buildFraudHeaders(req, fraudData, { userId: ctx.userId, vendorPublicIp }) : {};
  const testScenario = body.testScenario || undefined;

  // Sequential sweep. Each client uses its OWN connection if it has one
  // (kind='individual'), otherwise the firm agent connection — resolved per
  // client via getHmrcConnection. Re-reading per client picks up any token
  // refreshed/persisted by a previous iteration (no single-use double-refresh).
  const results: Outcome[] = [];
  for (const c of clients ?? []) {
    const name = c.name as string;
    const nino = normaliseNino(c.national_insurance_number as string | null);
    if (!nino) { results.push({ clientId: c.id as string, name, status: 'missing_nino' }); continue; }

    const conn = await getHmrcConnection(service, 'mtd_it', ctx.firmId, { clientId: c.id as string });
    if (!conn) { results.push({ clientId: c.id as string, name, status: 'needs_auth', error: 'Not connected — connect the firm agent, or this client individually.' }); continue; }

    const r = await hmrcRequest(conn, `/individuals/business/details/${nino}/list`, {
      version: '2.0', fraudHeaders, testScenario,
    });
    if (r.status === 401 || r.status === 403) {
      results.push({ clientId: c.id as string, name, status: 'needs_auth', error: 'Not authorised for this client at HMRC.' });
    } else if (r.status >= 400) {
      results.push({ clientId: c.id as string, name, status: 'error', error: hmrcErrorMessage(r.json) });
    } else {
      const j = r.json as { listOfBusinesses?: HmrcBusiness[]; businesses?: HmrcBusiness[] } | null;
      const businesses = (j?.listOfBusinesses ?? j?.businesses ?? []).filter(b => b.businessId);
      results.push({ clientId: c.id as string, name, status: 'ok', businesses });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    missing_nino: results.filter(r => r.status === 'missing_nino').length,
    needs_auth: results.filter(r => r.status === 'needs_auth').length,
    error: results.filter(r => r.status === 'error').length,
  };
  return NextResponse.json({ results, summary });
}
