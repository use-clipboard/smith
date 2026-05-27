import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/reopen ────────
// Un-reconcile a completed rec so the user can adjust matches/clearings.
// The cleared splits stay cleared (so the user picks up where they left
// off) but the rec status returns to in_progress and the edit-locks at the
// API layer fall away.
//
// Blocked if the rec's period overlaps the book's period_lock_date — opening
// the rec would otherwise let the user touch splits inside a locked period.
//
// Also blocked when a NEWER reconciled rec exists for the same account.
// Reopening an older rec while a newer one is locked would corrupt the
// carry-forward chain (the newer one's opening_balance was computed from
// the older one's closing_balance, which the user is about to change).
// Reopen the newer rec first.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // ── Firm + book + rec gate ─────────────────────────────────────────────
  const { data: imp } = await supabase
    .from('bookkeeping_bank_imports')
    .select(`
      id, book_id, account_id, status, period_start, period_end,
      book:bookkeeping_books!inner(firm_id, period_lock_date)
    `)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (!imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (imp.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (imp.status !== 'reconciled') {
    return NextResponse.json({
      error: `Only reconciled recs can be reopened (this one is ${imp.status}).`,
    }, { status: 409 });
  }

  // Period-lock guard
  // @ts-expect-error — !inner guarantees the join
  const periodLock = imp.book.period_lock_date as string | null;
  if (periodLock && imp.period_end && imp.period_end <= periodLock) {
    return NextResponse.json({
      error: `This rec's period ends on or before the book's lock date (${periodLock}). Unlock the period in book settings before reopening.`,
    }, { status: 403 });
  }

  // Newer-rec guard — preserve the carry-forward chain.
  const { data: newer } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id, period_end')
    .eq('account_id', imp.account_id)
    .eq('status', 'reconciled')
    .gt('period_end', imp.period_end!)
    .order('period_end', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (newer) {
    return NextResponse.json({
      error: 'A newer reconciliation exists for this account — reopen it first to keep opening-balance carry-forward consistent.',
      blocking_rec_id: newer.id,
    }, { status: 409 });
  }

  // Also reject if there's another in-progress rec on this account already
  // (would breach the partial unique index). Shouldn't happen given the
  // unique constraint, but a clear 409 beats a constraint violation.
  const { data: active } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id')
    .eq('account_id', imp.account_id)
    .in('status', ['pending', 'in_progress'])
    .maybeSingle();
  if (active) {
    return NextResponse.json({
      error: 'Another active reconciliation exists for this account. Finish or abandon it first.',
      blocking_rec_id: active.id,
    }, { status: 409 });
  }

  const { data: updated, error } = await supabase
    .from('bookkeeping_bank_imports')
    .update({
      status: 'in_progress',
      reconciled_at: null,
      reconciled_by: null,
      // completed_at / completed_by are kept as historical record — we
      // want the History tab to remember the original completion event.
    })
    .eq('id', params.importId)
    .select('*')
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Failed to reopen' }, { status: 500 });
  }

  return NextResponse.json({ import: updated });
}
