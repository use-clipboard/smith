import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { allocateInvoiceNumber } from '@/lib/billing/numbering';

const Schema = z.object({
  action: z.enum(['mark_sent', 'mark_paid', 'delete', 'cancel']),
  invoiceIds: z.array(z.string().uuid()).min(1).max(500),
});

// POST /api/billing/invoices/bulk — apply a status action to many invoices.
// Rules are respected per invoice (drafts get numbered on send; only unpaid
// drafts/cancelled can be deleted), so mixed selections do the sensible thing.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { action, invoiceIds } = parsed.data;

  const supabase = createClient();
  const { data } = await supabase
    .from('invoices').select('id, status, number, sent_at, total_pence, amount_paid_pence')
    .eq('firm_id', ctx.firmId).in('id', invoiceIds);
  const invoices = (data ?? []) as { id: string; status: string; number: string | null; sent_at: string | null; total_pence: number; amount_paid_pence: number }[];

  const nowIso = new Date().toISOString();
  let affected = 0;
  let skipped = 0;

  for (const inv of invoices) {
    if (action === 'mark_sent') {
      if (inv.status !== 'draft') { skipped++; continue; }
      const updates: Record<string, unknown> = { status: 'sent', sent_at: nowIso, updated_at: nowIso };
      if (!inv.number) updates.number = await allocateInvoiceNumber(supabase, ctx.firmId);
      await supabase.from('invoices').update(updates).eq('id', inv.id).eq('firm_id', ctx.firmId);
      affected++;
    } else if (action === 'mark_paid') {
      if (inv.status === 'cancelled' || inv.status === 'draft') { skipped++; continue; }
      await supabase.from('invoices').update({ status: 'paid', amount_paid_pence: inv.total_pence, paid_at: nowIso, updated_at: nowIso }).eq('id', inv.id).eq('firm_id', ctx.firmId);
      affected++;
    } else if (action === 'cancel') {
      if (inv.status === 'paid' || (inv.amount_paid_pence ?? 0) > 0) { skipped++; continue; }
      await supabase.from('invoices').update({ status: 'cancelled', updated_at: nowIso }).eq('id', inv.id).eq('firm_id', ctx.firmId);
      affected++;
    } else { // delete
      if (!(inv.status === 'draft' || inv.status === 'cancelled') || (inv.amount_paid_pence ?? 0) > 0) { skipped++; continue; }
      await supabase.from('invoices').delete().eq('id', inv.id).eq('firm_id', ctx.firmId);
      affected++;
    }
  }

  return NextResponse.json({ affected, skipped });
}
