// Billing module — post an issued invoice into the firm's Bookkeeping ledger.
//
// When billing_settings.post_to_bookkeeping is on and a target book is chosen,
// issuing (sending) an invoice posts a SIN (sales invoice) transaction into that
// book: Dr Trade debtors (gross), Cr Sales (net), Cr VAT-Output (vat). Mirrors
// app/api/bookkeeping/books/[id]/transactions POST (same ref RPC + split shape).
//
// Defensive by design: every failure path is a no-op with a reason, and it is
// idempotent via invoices.bookkeeping_txn_id — it never breaks invoicing.

import type { SupabaseClient } from '@supabase/supabase-js';
import { logBillingAudit } from './audit';

export interface PostResult { posted: boolean; reason?: string; txnId?: string }

const p2 = (pence: number) => Number(((pence || 0) / 100).toFixed(2));

async function findAccount(supabase: SupabaseClient, bookId: string, ledger: string, name: string): Promise<string | null> {
  const { data } = await supabase.from('bookkeeping_accounts').select('id').eq('book_id', bookId).eq('ledger', ledger).eq('name', name).maybeSingle();
  return (data?.id as string) ?? null;
}

export async function postInvoiceToBookkeeping(
  supabase: SupabaseClient,
  args: { firmId: string; userId: string | null; invoiceId: string },
): Promise<PostResult> {
  const { firmId, userId, invoiceId } = args;

  const { data: inv } = await supabase
    .from('invoices')
    .select('id, number, client_name, issue_date, subtotal_pence, vat_pence, total_pence, bookkeeping_txn_id')
    .eq('id', invoiceId).eq('firm_id', firmId).maybeSingle();
  if (!inv) return { posted: false, reason: 'invoice_not_found' };
  if (inv.bookkeeping_txn_id) return { posted: false, reason: 'already_posted' };

  const { data: settings } = await supabase
    .from('billing_settings').select('post_to_bookkeeping, bookkeeping_book_id, bookkeeping_sales_account').eq('firm_id', firmId).maybeSingle();
  if (!settings?.post_to_bookkeeping) return { posted: false, reason: 'toggle_off' };
  const bookId = settings.bookkeeping_book_id as string | null;
  if (!bookId) return { posted: false, reason: 'no_book' };

  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, vat_registered, period_lock_date').eq('id', bookId).eq('firm_id', firmId).maybeSingle();
  if (!book) return { posted: false, reason: 'book_not_found' };
  const issue = (inv.issue_date as string | null) ?? new Date().toISOString().slice(0, 10);
  if (book.period_lock_date && issue <= (book.period_lock_date as string)) return { posted: false, reason: 'period_locked' };

  const debtors = await findAccount(supabase, bookId, 'Debtors', 'Trade debtors');
  if (!debtors) return { posted: false, reason: 'no_debtors_account' };
  const salesId = (settings.bookkeeping_sales_account as string | null) || await findAccount(supabase, bookId, 'Income', 'Sales');
  if (!salesId) return { posted: false, reason: 'no_sales_account' };

  const gross = p2(inv.total_pence);
  const net = p2(inv.subtotal_pence);
  const vat = p2(inv.vat_pence);

  // Splits: Dr debtors gross; Cr sales (net) + Cr VAT (vat) when the book is VAT
  // registered and there's a VAT-Output account, else Cr sales the full gross.
  const vatId = book.vat_registered && vat > 0 ? await findAccount(supabase, bookId, 'Creditors', 'VAT - Output') : null;
  const useVat = !!vatId && vat > 0;
  const splits = [
    { account_id: debtors, debit: gross, credit: 0, entry_details: inv.client_name ?? null },
    { account_id: salesId, debit: 0, credit: useVat ? net : gross, entry_details: `Invoice ${inv.number ?? ''}`.trim() },
    ...(useVat ? [{ account_id: vatId!, debit: 0, credit: vat, entry_details: 'Output VAT' }] : []),
  ];

  const { data: seq, error: seqErr } = await supabase.rpc('bookkeeping_next_ref', { p_book_id: bookId, p_type: 'SIN' });
  if (seqErr || typeof seq !== 'number') return { posted: false, reason: 'ref_failed' };
  const refNo = `SIN ${String(seq).padStart(6, '0')}`;

  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: bookId, type: 'SIN', ref_no: refNo, ref_seq: seq, date: issue,
      payee_text: inv.client_name ?? null, details: `Invoice ${inv.number ?? ''}`.trim(),
      total: gross, vat_total: useVat ? vat : 0, vat_rate: useVat ? 20 : null,
      vat_treatment: useVat ? 'standard_20' : 'no_vat',
      primary_account_id: debtors, status: 'posted', created_by: userId, posted_at: new Date().toISOString(),
    })
    .select('id').single();
  if (txnErr || !txn) return { posted: false, reason: 'header_failed' };

  const { error: splitErr } = await supabase.from('bookkeeping_transaction_splits').insert(
    splits.map((s, i) => ({ transaction_id: txn.id, line_no: i + 1, account_id: s.account_id, debit: s.debit, credit: s.credit, entry_details: s.entry_details ?? null })),
  );
  if (splitErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return { posted: false, reason: 'splits_failed' };
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: bookId, user_id: userId, entity_type: 'transaction', entity_id: txn.id, action: 'create',
    diff: { type: 'SIN', ref_no: refNo, total: gross, source: 'billing_invoice', invoice_id: inv.id },
  }).then(() => {}, () => {});

  await supabase.from('invoices').update({ bookkeeping_txn_id: txn.id }).eq('id', inv.id).eq('firm_id', firmId);
  await logBillingAudit(supabase, { firmId, invoiceId: inv.id, userId, action: 'posted_to_bookkeeping', detail: refNo });
  return { posted: true, txnId: txn.id as string };
}
