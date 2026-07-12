import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { reconcileCredits, type OutstandingInvoice, type BankCredit } from '@/lib/billing/reconcile';
import { recordPayment } from '@/lib/billing/recordPayment';

const CreditSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(500),
  amountPence: z.number().int().positive().max(1_000_000_000),
});

const MatchSchema = z.object({ action: z.literal('match'), credits: z.array(CreditSchema).min(1).max(1000) });
const ConfirmSchema = z.object({
  action: z.literal('confirm'),
  importBatch: z.string().max(60).optional(),
  confirmations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amountPence: z.number().int().positive().max(1_000_000_000),
    receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().max(200).nullable().optional(),
  })).min(1).max(1000),
});
const Body = z.discriminatedUnion('action', [MatchSchema, ConfirmSchema]);

async function loadOutstanding(supabase: ReturnType<typeof createClient>, firmId: string): Promise<OutstandingInvoice[]> {
  const { data } = await supabase
    .from('invoices')
    .select('id, number, client_name, status, total_pence, amount_paid_pence, credit_pence')
    .eq('firm_id', firmId).in('status', ['sent', 'viewed', 'part_paid', 'overdue']).limit(3000);
  return (data ?? [])
    .map(r => ({ id: r.id, number: r.number, clientName: r.client_name, balancePence: balancePence(r.total_pence, r.amount_paid_pence, r.credit_pence ?? 0) }))
    .filter(r => r.balancePence > 0);
}

// POST /api/billing/reconcile — { action:'match' } returns suggested invoice
// matches for imported bank credits; { action:'confirm' } records the payments.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();

  if (parsed.data.action === 'match') {
    const invoices = await loadOutstanding(supabase, ctx.firmId);
    const matches = reconcileCredits(parsed.data.credits as BankCredit[], invoices);
    return NextResponse.json({ matches, outstandingCount: invoices.length });
  }

  // action === 'confirm'
  const batch = parsed.data.importBatch ?? `csv-${Date.now()}`;
  let recorded = 0;
  const errors: string[] = [];
  for (const c of parsed.data.confirmations) {
    const res = await recordPayment(supabase, {
      firmId: ctx.firmId, invoiceId: c.invoiceId, amountPence: c.amountPence, receivedDate: c.receivedDate,
      method: 'csv_import', reference: c.reference ?? null, matchedBy: 'user', createdBy: ctx.userId, importBatch: batch,
    });
    if (res.ok) recorded++;
    else errors.push(res.error ?? 'unknown');
  }
  return NextResponse.json({ ok: true, recorded, failed: errors.length });
}
