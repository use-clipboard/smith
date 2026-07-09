// Billing module — shared payment recorder.
//
// Creates a payment + its allocation against one invoice and advances the
// invoice's paid amount + status. Used by manual entry, CSV reconciliation and
// Stripe webhooks so the money-in logic lives in one place.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentMethod } from './types';

export interface RecordPaymentArgs {
  firmId: string;
  invoiceId: string;
  amountPence: number;
  receivedDate: string;   // yyyy-mm-dd
  method: PaymentMethod;
  reference?: string | null;
  providerRef?: string | null;
  matchedBy?: 'ai' | 'user';
  createdBy?: string | null;
  importBatch?: string | null;
  stripeFeePence?: number | null;
}

export interface RecordPaymentResult {
  ok: boolean;
  error?: string;
  amountPaidPence?: number;
  status?: 'paid' | 'part_paid';
  paymentId?: string;
}

export async function recordPayment(supabase: SupabaseClient, args: RecordPaymentArgs): Promise<RecordPaymentResult> {
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, client_id, total_pence, amount_paid_pence')
    .eq('id', args.invoiceId).eq('firm_id', args.firmId).maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found' };

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      firm_id: args.firmId,
      client_id: inv.client_id ?? null,
      method: args.method,
      amount_pence: args.amountPence,
      received_date: args.receivedDate,
      reference: args.reference ?? null,
      provider_ref: args.providerRef ?? null,
      matched: true,
      matched_by: args.matchedBy ?? 'user',
      import_batch: args.importBatch ?? null,
      stripe_fee_pence: args.stripeFeePence ?? null,
      created_by: args.createdBy ?? null,
    })
    .select('id')
    .single();
  if (payErr || !payment) return { ok: false, error: 'Could not record payment' };

  await supabase.from('payment_allocations').insert({
    firm_id: args.firmId, payment_id: payment.id, invoice_id: inv.id, amount_pence: args.amountPence,
  });

  const newPaid = (inv.amount_paid_pence ?? 0) + args.amountPence;
  const status: 'paid' | 'part_paid' = newPaid >= (inv.total_pence ?? 0) ? 'paid' : 'part_paid';
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { amount_paid_pence: newPaid, status, updated_at: nowIso };
  if (status === 'paid') updates.paid_at = nowIso;
  await supabase.from('invoices').update(updates).eq('id', inv.id).eq('firm_id', args.firmId);

  return { ok: true, amountPaidPence: newPaid, status, paymentId: payment.id };
}
