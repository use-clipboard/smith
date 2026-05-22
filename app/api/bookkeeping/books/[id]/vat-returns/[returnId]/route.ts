import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── DELETE /api/bookkeeping/books/[id]/vat-returns/[returnId] ───────────────
// Unfile a VAT return. Admin-only. If the unfiled return was the one that
// drove book.vat_lock_date, roll the lock back to the previous filing's
// period_to (or null if none remain).
//
// We do NOT touch transactions' vat_period_override values — they remain
// pointing at the previously-next period. The admin should review those
// separately if needed.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; returnId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  const supabase = createClient();

  // Verify book + firm
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Fetch the return being deleted (must belong to this book)
  const { data: target, error: targetErr } = await supabase
    .from('bookkeeping_vat_returns')
    .select('id, book_id, ref_no, period_from, period_to, filing_journal_id')
    .eq('id', params.returnId)
    .eq('book_id', params.id)
    .single();
  if (targetErr || !target) return NextResponse.json({ error: 'Return not found' }, { status: 404 });

  // Delete the filing record first. We rely on filing_journal_id staying
  // intact on the journal until we explicitly delete it next, so the audit
  // diff can still reference it.
  const { error: delErr } = await supabase
    .from('bookkeeping_vat_returns')
    .delete()
    .eq('id', params.returnId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Delete the closing journal (and its splits via FK cascade). Without this,
  // reopening the period would leave the VAT control accounts double-cleared.
  if (target.filing_journal_id) {
    const { error: jrnDelErr } = await supabase
      .from('bookkeeping_transactions')
      .delete()
      .eq('id', target.filing_journal_id);
    if (jrnDelErr) {
      console.error('[bookkeeping] Could not delete VAT closing journal on unfile', jrnDelErr);
    }
  }

  // If this filing's period_to matches the current vat_lock_date, roll back
  // the lock to the next-latest filing's period_to. If no filings remain,
  // clear the lock entirely.
  let newLock: string | null = book.vat_lock_date as string | null;
  if (newLock && newLock === target.period_to) {
    const { data: latest } = await supabase
      .from('bookkeeping_vat_returns')
      .select('period_to')
      .eq('book_id', params.id)
      .order('period_to', { ascending: false })
      .limit(1);
    newLock = latest && latest.length > 0 ? (latest[0].period_to as string) : null;
    await supabase
      .from('bookkeeping_books')
      .update({ vat_lock_date: newLock })
      .eq('id', params.id);
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'vat_return',
    entity_id: params.returnId,
    action: 'delete',
    diff: {
      ref_no: target.ref_no,
      period: `${target.period_from} to ${target.period_to}`,
      vat_lock_date_after: newLock,
      filing_journal_id_deleted: target.filing_journal_id,
    },
  });

  return NextResponse.json({ ok: true, vat_lock_date: newLock });
}
