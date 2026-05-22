import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/transactions/[txId]/change-type ────────
// Re-classify a posted transaction as a different type (e.g. REC → JRN, or
// PAY → CHQ). A fresh ref is allocated from the target type's counter; the
// old ref is orphaned and never reused (gaps in the sequence are the audit
// trail, same as Delete).
//
// What happens to the data:
//   • Splits are PRESERVED as-is. They already balance, so they're valid
//     for any target type. If the new type's shape doesn't fit the existing
//     splits (e.g. JRN → SIN, which expects a customer primary), the user
//     can fix it via the Edit modal afterward.
//   • For JRN / RJN targets: primary_account_id, vat_total, vat_rate and
//     vat_treatment are CLEARED — journals don't have a primary or VAT
//     metadata at the header level.
//   • For RJN target: we do NOT create the auto-reversal entry. The user
//     can post the reversing pair manually if needed. This is consistent
//     with our "type changes are minimal, fix-via-edit afterwards" model.
//   • For other targets: header is left alone. If the existing primary
//     account no longer fits the new type's expected ledger, the user
//     gets a warning back (not a hard block) and can edit to fix.
//
// Body: { new_type: 'PAY'|'CHQ'|… }
// Returns: { transaction, warning?: string }

const TRANSACTION_TYPES = ['PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN'] as const;
type TxType = typeof TRANSACTION_TYPES[number];

const Body = z.object({
  new_type: z.enum(TRANSACTION_TYPES),
});

const TX_SELECT = `
  id, book_id, type, ref_no, ref_seq, date, payee_text, details,
  total, vat_total, vat_rate, vat_treatment, vat_period_override,
  primary_account_id, status, created_by, created_at, updated_at, posted_at,
  primary_account:bookkeeping_accounts!bookkeeping_transactions_primary_account_id_fkey(id, name, ledger, account_type),
  splits:bookkeeping_transaction_splits(
    id, transaction_id, line_no, account_id, debit, credit, entry_details, notes,
    account:bookkeeping_accounts(id, name, ledger, account_type)
  )
`;

/** Per-type primary-ledger expectations — used purely to surface a warning
 *  when the existing primary no longer fits. NULL means "no primary expected". */
const PRIMARY_LEDGER: Record<TxType, string | null> = {
  PAY: 'Bank', CHQ: 'Bank', REC: 'Bank', TRF: 'Bank',
  SIN: 'Customers', SCR: 'Customers',
  PIN: 'Suppliers', PCR: 'Suppliers',
  JRN: null, RJN: null,
};

const TYPES_WITHOUT_PRIMARY = new Set<TxType>(['JRN', 'RJN']);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Book + locks
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date, vat_lock_date, vat_registered')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Existing transaction
  const { data: existing, error: exErr } = await supabase
    .from('bookkeeping_transactions')
    .select('id, type, ref_no, date, primary_account_id, vat_total, primary_account:bookkeeping_accounts!bookkeeping_transactions_primary_account_id_fkey(id, ledger)')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (existing.type === body.new_type) {
    return NextResponse.json({ error: `Already a ${body.new_type} — no change needed.` }, { status: 400 });
  }

  // Period lock — block when the date sits in a hard-locked period.
  if (book.period_lock_date && existing.date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period locked through ${book.period_lock_date}` },
      { status: 403 },
    );
  }

  // VAT lock — block when this txn carries VAT and the date sits in a filed
  // VAT period. Changing type would either remove or alter the VAT impact,
  // which would silently invalidate the existing return's snapshot.
  if (
    book.vat_registered &&
    book.vat_lock_date &&
    existing.date <= book.vat_lock_date &&
    Number(existing.vat_total ?? 0) > 0 &&
    !isAdmin
  ) {
    return NextResponse.json(
      {
        error: 'vat_period_locked',
        message: `This transaction carries VAT and falls in a filed VAT period (locked through ${book.vat_lock_date}). Changing its type would alter what was filed. Have an admin unfile the return first.`,
      },
      { status: 403 },
    );
  }

  // Allocate the new ref atomically.
  const { data: nextSeq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: body.new_type });
  if (seqErr || typeof nextSeq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate new ref' }, { status: 500 });
  }
  const newRefNo = `${body.new_type} ${String(nextSeq).padStart(6, '0')}`;

  // Build the patch. JRN/RJN strip out header-level VAT and primary account
  // because journals don't carry them.
  const patch: Record<string, unknown> = {
    type: body.new_type,
    ref_no: newRefNo,
    ref_seq: nextSeq,
    updated_at: new Date().toISOString(),
  };
  if (TYPES_WITHOUT_PRIMARY.has(body.new_type)) {
    patch.primary_account_id = null;
    patch.vat_total = 0;
    patch.vat_rate = null;
    patch.vat_treatment = null;
  }

  const { error: updErr } = await supabase
    .from('bookkeeping_transactions')
    .update(patch)
    .eq('id', params.txId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Warn if the existing primary doesn't fit the new type's expected ledger.
  // Not fatal — the user can fix via Edit.
  let warning: string | null = null;
  const expectedLedger = PRIMARY_LEDGER[body.new_type];
  type PrimaryAcctRow = { id: string; ledger: string | null } | null;
  const primaryAcct = Array.isArray(existing.primary_account)
    ? (existing.primary_account[0] as PrimaryAcctRow)
    : (existing.primary_account as PrimaryAcctRow);
  if (
    expectedLedger
    && existing.primary_account_id
    && primaryAcct?.ledger
    && primaryAcct.ledger !== expectedLedger
  ) {
    warning = `Primary account is in "${primaryAcct.ledger}" but ${body.new_type} expects "${expectedLedger}". Open the transaction in Edit to fix.`;
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'update',
    diff: {
      change_type: { from: existing.type, to: body.new_type, old_ref_no: existing.ref_no, new_ref_no: newRefNo },
      cleared_fields: TYPES_WITHOUT_PRIMARY.has(body.new_type) ? ['primary_account_id', 'vat_total', 'vat_rate', 'vat_treatment'] : [],
    },
  });

  // Re-fetch with joined refs for the response.
  const { data: full, error: refetchErr } = await supabase
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', params.txId)
    .single();
  if (refetchErr) return NextResponse.json({ error: refetchErr.message }, { status: 500 });

  return NextResponse.json({ transaction: full, warning });
}
