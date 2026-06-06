import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { HmrcService } from '@/lib/hmrc/config';

// ── POST /api/hmrc/disconnect { service?, kind, bookId?, clientId? } ──────────
// Removes a stored HMRC connection (agent for the firm, business for a book, or
// individual for a client). Lets the user re-connect with a different login.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { service?: string; kind?: string; bookId?: string; clientId?: string };
  const svc: HmrcService = body.service === 'mtd_it' ? 'mtd_it' : 'vat';
  const kind = body.kind === 'business' ? 'business' : body.kind === 'individual' ? 'individual' : 'agent';

  const service = createServiceClient();
  let q = service.from('hmrc_connections').delete().eq('firm_id', ctx.firmId).eq('service', svc).eq('kind', kind);
  if (kind === 'business') {
    if (!body.bookId) return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    q = q.eq('book_id', body.bookId);
  } else if (kind === 'individual') {
    if (!body.clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    q = q.eq('client_id', body.clientId);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
