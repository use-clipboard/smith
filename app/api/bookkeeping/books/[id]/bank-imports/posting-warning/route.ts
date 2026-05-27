import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/bank-imports/posting-warning ──────────
// Cheap helper the input sheets call before saving a transaction. If the
// date falls inside the period of a RECONCILED rec for the same bank
// account, we return the rec details so the UI can show the warning
// lightbox the user asked for:
//
//   "The bank for that period is reconciled and locked.
//    Confirm entry still wanted?"
//
// Query params:
//   account_id  (uuid, required)  — the bank account the entry will post to
//   date        (YYYY-MM-DD, required)  — the transaction date
//
// Returns { locked: false } when fine, or
//   { locked: true, rec: { id, display_label, period_start, period_end, reconciled_at } }
//
// Notes:
//   • Caller decides whether to hard-block or just warn — we just surface
//     the fact.  In practice we'll show the lightbox and require explicit
//     "yes, still post" before sending the real POST /transactions.
//   • Only checks RECONCILED recs.  In-progress recs don't block — the
//     user is still actively shuffling those.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const accountId = url.searchParams.get('account_id');
  const date      = url.searchParams.get('date');
  if (!accountId || !date) {
    return NextResponse.json({ error: 'account_id and date are required' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = createClient();

  // Belt-and-braces firm gate (RLS does this too).
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Find any reconciled rec whose period contains this date.
  const { data: rec } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id, display_label, file_name, period_start, period_end, reconciled_at')
    .eq('book_id', params.id)
    .eq('account_id', accountId)
    .eq('status', 'reconciled')
    .lte('period_start', date)
    .gte('period_end',   date)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rec) return NextResponse.json({ locked: false });

  return NextResponse.json({
    locked: true,
    rec: {
      id: rec.id,
      label: rec.display_label || rec.file_name,
      period_start: rec.period_start,
      period_end:   rec.period_end,
      reconciled_at: rec.reconciled_at,
    },
  });
}
