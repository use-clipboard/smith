import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { FA_LEDGERS, isFixedAssetLedger } from '@/lib/bookkeeping/fixedAssets';
import { loadLedgerSchedule } from '@/lib/bookkeeping/depreciationServer';

// ── GET /api/bookkeeping/books/[id]/depreciation ─────────────────────────────
// Build the depreciation schedule for a period.
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (required — the period to charge)
//   ?ledger=FA - vehicles           (optional — one ledger; omit for all FA
//                                     ledgers that have at least one account)
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const ledgerParam = url.searchParams.get('ledger');

  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });
  }
  if (ledgerParam && !isFixedAssetLedger(ledgerParam)) {
    return NextResponse.json({ error: 'Not a fixed-asset ledger' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Which FA ledgers does this book actually have accounts for?
  const { data: faAccounts } = await supabase
    .from('bookkeeping_accounts')
    .select('ledger')
    .eq('book_id', params.id)
    .like('ledger', 'FA -%');
  const presentLedgers = new Set((faAccounts ?? []).map(a => a.ledger as string));

  let ledgers: string[];
  if (ledgerParam) {
    ledgers = [ledgerParam];
  } else {
    ledgers = FA_LEDGERS.filter(l => presentLedgers.has(l));
    // Include any non-standard FA ledger the book may have, too.
    for (const l of presentLedgers) if (!ledgers.includes(l)) ledgers.push(l);
  }

  const schedules = await Promise.all(
    ledgers.map(l => loadLedgerSchedule(supabase, params.id, l, from, to)),
  );

  return NextResponse.json({ period: { from, to }, schedules });
}
