import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/hmrc/disconnect { kind, bookId? } ──────────────────────────────
// Removes a stored HMRC connection (agent for the firm, or business for a book).
// Lets the user re-connect with a different HMRC/sandbox login.
export async function POST(req: NextRequest) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { kind?: string; bookId?: string };
  const kind = body.kind === 'business' ? 'business' : 'agent';

  const service = createServiceClient();
  let q = service.from('hmrc_connections').delete().eq('firm_id', ctx.firmId).eq('kind', kind);
  if (kind === 'business') {
    if (!body.bookId) return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    q = q.eq('book_id', body.bookId);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
