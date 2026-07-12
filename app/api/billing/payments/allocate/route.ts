import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';

const Schema = z.object({
  amountPence: z.number().int().positive().max(1_000_000_000),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['manual', 'stripe_card', 'stripe_bacs_dd', 'csv_import']).default('manual'),
  reference: z.string().max(200).nullable().optional(),
  allocations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amountPence: z.number().int().positive().max(1_000_000_000),
  })).min(1).max(200),
});

// POST /api/billing/payments/allocate — record ONE payment and split it across
// several invoices (a lump-sum receipt / payment on account). Any unallocated
// remainder is kept on the payment but applied to no invoice.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;

  const allocTotal = body.allocations.reduce((s, a) => s + a.amountPence, 0);
  if (allocTotal > body.amountPence) {
    return NextResponse.json({ error: 'Allocated more than the amount received.' }, { status: 400 });
  }

  const supabase = createClient();
  const ids = body.allocations.map(a => a.invoiceId);
  const { data: invData } = await supabase
    .from('invoices').select('id, client_id, total_pence, amount_paid_pence, credit_pence, status')
    .eq('firm_id', ctx.firmId).in('id', ids);
  const invoices = new Map((invData ?? []).map(r => [r.id as string, r]));

  // Validate every allocation against the live balance.
  for (const a of body.allocations) {
    const inv = invoices.get(a.invoiceId);
    if (!inv) return NextResponse.json({ error: 'An invoice was not found.' }, { status: 404 });
    const bal = balancePence(inv.total_pence, inv.amount_paid_pence, inv.credit_pence ?? 0);
    if (a.amountPence > bal) {
      return NextResponse.json({ error: `Allocation exceeds the balance on invoice ${inv.id}.` }, { status: 400 });
    }
  }

  // One payment; client_id set when every allocation is for the same client.
  const clientIds = new Set((invData ?? []).map(r => r.client_id));
  const paymentClient = clientIds.size === 1 ? ([...clientIds][0] as string | null) : null;

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      firm_id: ctx.firmId, client_id: paymentClient, method: body.method,
      amount_pence: body.amountPence, received_date: body.receivedDate, reference: body.reference ?? null,
      matched: true, matched_by: 'user', created_by: ctx.userId,
    })
    .select('id').single();
  if (payErr || !payment) return NextResponse.json({ error: 'Could not record payment' }, { status: 500 });

  const nowIso = new Date().toISOString();
  let applied = 0;
  for (const a of body.allocations) {
    const inv = invoices.get(a.invoiceId)!;
    await supabase.from('payment_allocations').insert({ firm_id: ctx.firmId, payment_id: payment.id, invoice_id: a.invoiceId, amount_pence: a.amountPence });
    const newPaid = (inv.amount_paid_pence ?? 0) + a.amountPence;
    const settled = balancePence(inv.total_pence, newPaid, inv.credit_pence ?? 0) <= 0;
    const updates: Record<string, unknown> = { amount_paid_pence: newPaid, status: settled ? 'paid' : 'part_paid', updated_at: nowIso };
    if (settled) updates.paid_at = nowIso;
    await supabase.from('invoices').update(updates).eq('id', a.invoiceId).eq('firm_id', ctx.firmId);
    applied++;
  }

  const { logBillingAudit } = await import('@/lib/billing/audit');
  await logBillingAudit(supabase, { firmId: ctx.firmId, invoiceId: body.allocations[0]?.invoiceId ?? null, userId: ctx.userId, action: 'allocated', detail: `£${(allocTotal / 100).toFixed(2)} across ${applied} invoice(s)` });

  return NextResponse.json({ ok: true, paymentId: payment.id, applied, allocatedPence: allocTotal, unallocatedPence: body.amountPence - allocTotal });
}
