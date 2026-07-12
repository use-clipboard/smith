import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';

const Schema = z.object({
  preference: z.enum(['oldest', 'newest']).optional(),
  clientId: z.string().uuid().optional(),
});

const OUTSTANDING = ['sent', 'viewed', 'part_paid', 'overdue'];

// POST /api/billing/payments/sweep-on-account — allocate every unapplied
// payment (money received but not yet matched to an invoice) to that client's
// outstanding invoices, oldest- or newest-first. Manual cleanup for a build-up
// of payments on account.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  let preference = parsed.data.preference;
  if (!preference) {
    const { data: s } = await supabase.from('billing_settings').select('allocation_preference').eq('firm_id', ctx.firmId).maybeSingle();
    preference = (s?.allocation_preference as 'oldest' | 'newest') ?? 'oldest';
  }

  // Payments + their existing allocations → unallocated remainder per payment.
  let payQ = supabase.from('payments').select('id, client_id, amount_pence').eq('firm_id', ctx.firmId);
  if (parsed.data.clientId) payQ = payQ.eq('client_id', parsed.data.clientId);
  const { data: payData } = await payQ.limit(5000);
  const payments = (payData ?? []) as { id: string; client_id: string | null; amount_pence: number }[];
  const payIds = payments.map(p => p.id);

  const allocatedByPayment = new Map<string, number>();
  if (payIds.length) {
    const { data: allocs } = await supabase.from('payment_allocations').select('payment_id, amount_pence').in('payment_id', payIds);
    for (const a of (allocs ?? []) as { payment_id: string; amount_pence: number }[]) {
      allocatedByPayment.set(a.payment_id, (allocatedByPayment.get(a.payment_id) ?? 0) + a.amount_pence);
    }
  }

  // Unapplied payments per client.
  const byClient = new Map<string, { paymentId: string; remaining: number }[]>();
  for (const p of payments) {
    if (!p.client_id) continue;
    const remaining = p.amount_pence - (allocatedByPayment.get(p.id) ?? 0);
    if (remaining <= 0) continue;
    (byClient.get(p.client_id) ?? byClient.set(p.client_id, []).get(p.client_id)!).push({ paymentId: p.id, remaining });
  }
  if (byClient.size === 0) return NextResponse.json({ ok: true, allocatedPence: 0, invoicesUpdated: 0, message: 'No payments on account to allocate.' });

  // Outstanding invoices for those clients.
  const clientIds = [...byClient.keys()];
  const { data: invData } = await supabase
    .from('invoices').select('id, client_id, total_pence, amount_paid_pence, credit_pence, issue_date, status')
    .eq('firm_id', ctx.firmId).in('client_id', clientIds).in('status', OUTSTANDING).limit(10000);
  const invByClient = new Map<string, { id: string; balance: number; paid: number; total: number; credit: number; issue: string }[]>();
  for (const r of (invData ?? [])) {
    const bal = balancePence(r.total_pence, r.amount_paid_pence, r.credit_pence ?? 0);
    if (bal <= 0) continue;
    const list = invByClient.get(r.client_id) ?? [];
    list.push({ id: r.id, balance: bal, paid: r.amount_paid_pence, total: r.total_pence, credit: r.credit_pence ?? 0, issue: r.issue_date ?? '' });
    invByClient.set(r.client_id, list);
  }

  const nowIso = new Date().toISOString();
  let allocatedPence = 0;
  const invoicesUpdated = new Set<string>();

  for (const [clientId, pays] of byClient) {
    const invoices = (invByClient.get(clientId) ?? []).sort((a, b) => preference === 'oldest' ? a.issue.localeCompare(b.issue) : b.issue.localeCompare(a.issue));
    let payIdx = 0;
    for (const inv of invoices) {
      let need = inv.balance;
      let addedToInvoice = 0;
      while (need > 0 && payIdx < pays.length) {
        const pay = pays[payIdx];
        if (pay.remaining <= 0) { payIdx++; continue; }
        const take = Math.min(need, pay.remaining);
        await supabase.from('payment_allocations').insert({ firm_id: ctx.firmId, payment_id: pay.paymentId, invoice_id: inv.id, amount_pence: take });
        pay.remaining -= take; need -= take; addedToInvoice += take; allocatedPence += take;
        if (pay.remaining <= 0) payIdx++;
      }
      if (addedToInvoice > 0) {
        const newPaid = inv.paid + addedToInvoice;
        const settled = balancePence(inv.total, newPaid, inv.credit) <= 0;
        const updates: Record<string, unknown> = { amount_paid_pence: newPaid, status: settled ? 'paid' : 'part_paid', updated_at: nowIso };
        if (settled) updates.paid_at = nowIso;
        await supabase.from('invoices').update(updates).eq('id', inv.id).eq('firm_id', ctx.firmId);
        invoicesUpdated.add(inv.id);
      }
      if (payIdx >= pays.length) break;
    }
  }

  return NextResponse.json({ ok: true, allocatedPence, invoicesUpdated: invoicesUpdated.size });
}
