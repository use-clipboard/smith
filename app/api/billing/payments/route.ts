import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

const RecordSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPence: z.number().int().positive().max(1_000_000_000),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['manual', 'stripe_card', 'stripe_bacs_dd', 'csv_import']).default('manual'),
  reference: z.string().max(200).nullable().optional(),
});

// POST /api/billing/payments — record a payment against one invoice and
// advance the invoice's paid amount + status. (Phase A: single-invoice
// allocation; multi-invoice splitting arrives with reconciliation.)
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = RecordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payment' }, { status: 400 });
  const body = parsed.data;

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, client_id, total_pence, amount_paid_pence, status')
    .eq('id', body.invoiceId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      firm_id: ctx.firmId,
      client_id: inv.client_id ?? null,
      method: body.method,
      amount_pence: body.amountPence,
      received_date: body.receivedDate,
      reference: body.reference ?? null,
      matched: true,
      matched_by: 'user',
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (payErr || !payment) return NextResponse.json({ error: 'Could not record payment' }, { status: 500 });

  await supabase.from('payment_allocations').insert({
    firm_id: ctx.firmId,
    payment_id: payment.id,
    invoice_id: inv.id,
    amount_pence: body.amountPence,
  });

  const newPaid = (inv.amount_paid_pence ?? 0) + body.amountPence;
  const nowIso = new Date().toISOString();
  const nextStatus = newPaid >= (inv.total_pence ?? 0) ? 'paid' : 'part_paid';
  const updates: Record<string, unknown> = {
    amount_paid_pence: newPaid,
    status: nextStatus,
    updated_at: nowIso,
  };
  if (nextStatus === 'paid') updates.paid_at = nowIso;

  const { error: updErr } = await supabase
    .from('invoices').update(updates).eq('id', inv.id).eq('firm_id', ctx.firmId);
  if (updErr) return NextResponse.json({ error: 'Payment saved but invoice update failed' }, { status: 500 });

  return NextResponse.json({ ok: true, amountPaidPence: newPaid, status: nextStatus }, { status: 201 });
}
