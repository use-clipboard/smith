import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { getConnectionForBook, hmrcRequest } from '@/lib/hmrc/api';
import { buildFraudHeaders, type ClientFraudData } from '@/lib/hmrc/fraudHeaders';

// ── POST /api/bookkeeping/books/[id]/mtd/obligations ─────────────────────────
// Lists the OPEN VAT obligations (periods awaiting a return) for the book's VRN.
// POST (not GET) so the browser-collected fraud-prevention data can be sent.
function hmrcError(json: unknown): string {
  const j = json as { message?: string; errors?: { message?: string }[] } | null;
  if (j?.errors?.length) return j.errors.map(e => e.message).filter(Boolean).join('; ') || 'HMRC rejected the request.';
  return j?.message || 'HMRC rejected the request.';
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) return NextResponse.json({ error: 'HMRC is not configured.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { fraudData?: ClientFraudData; testScenario?: string };
  const service = createServiceClient();
  const { data: book } = await service
    .from('bookkeeping_books').select('id, firm_id, vat_number').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const vrn = (book.vat_number ?? '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(vrn)) return NextResponse.json({ error: 'Set a valid 9-digit VAT number first.' }, { status: 400 });

  const conn = await getConnectionForBook(service, ctx.firmId, params.id);
  if (!conn) return NextResponse.json({ error: 'Connect HMRC first.' }, { status: 400 });

  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData) : {};
  // Gov-Test-Scenario only affects HMRC's SANDBOX (ignored in production), and
  // lets sandbox return obligations dated relative to today instead of the
  // static 2017 sample data.
  const testScenario = body.testScenario || undefined;
  const result = await hmrcRequest(conn, `/organisations/vat/${vrn}/obligations?status=O`, { fraudHeaders, testScenario });

  if (result.status >= 400) {
    return NextResponse.json({ error: hmrcError(result.json), status: result.status, detail: result.json }, { status: 502 });
  }
  const obligations = (result.json as { obligations?: unknown[] } | null)?.obligations ?? [];
  return NextResponse.json({ obligations });
}
