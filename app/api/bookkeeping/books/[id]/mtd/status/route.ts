import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isHmrcConfigured, HMRC_ENV } from '@/lib/hmrc/config';

// ── GET /api/bookkeeping/books/[id]/mtd/status ───────────────────────────────
// MTD VAT readiness for this book. Used by the "Submit to HMRC" panel. Reads
// the (service-role-only) hmrc_connections table and returns ONLY non-sensitive
// fields — never the tokens. In Stage 1 there are no connections and the env
// isn't configured, so `configured` is false and the UI shows a setup state.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data: book } = await service
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered, vat_number')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // An agent connection covers the whole firm; a business connection is per book.
  let connection: { kind: 'agent' | 'business'; status: string } | null = null;
  try {
    const { data: conns } = await service
      .from('hmrc_connections')
      .select('kind, status, book_id')
      .eq('firm_id', ctx.firmId);
    const agent = (conns ?? []).find(c => c.kind === 'agent');
    const business = (conns ?? []).find(c => c.kind === 'business' && c.book_id === params.id);
    const chosen = business ?? agent ?? null;
    if (chosen) connection = { kind: chosen.kind as 'agent' | 'business', status: String(chosen.status) };
  } catch {
    // Table may not exist yet (migration not applied) — treat as no connection.
    connection = null;
  }

  return NextResponse.json({
    configured: isHmrcConfigured(),
    environment: HMRC_ENV,
    vatRegistered: Boolean(book.vat_registered),
    vatNumber: book.vat_number ?? null,
    connection,
  });
}
