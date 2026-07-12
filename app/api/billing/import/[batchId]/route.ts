import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/billing/audit';

// DELETE /api/billing/import/[batchId] — undo an import (removes its invoices +
// recurring schedules). Refuses if a payment was recorded against any imported
// invoice since the import, so real money-in is never silently deleted.
export async function DELETE(_req: NextRequest, { params }: { params: { batchId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  const gate = requireAdmin(ctx.userRole, 'undo an import');
  if (gate) return gate;

  const supabase = createClient();
  const { data: batch } = await supabase
    .from('invoice_import_batches').select('id').eq('id', params.batchId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!batch) return NextResponse.json({ error: 'Import not found' }, { status: 404 });

  const { data: invs } = await supabase.from('invoices').select('id').eq('firm_id', ctx.firmId).eq('import_batch', params.batchId);
  const invoiceIds = (invs ?? []).map(i => i.id);

  if (invoiceIds.length) {
    const { count } = await supabase
      .from('payment_allocations').select('id', { count: 'exact', head: true }).in('invoice_id', invoiceIds);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: 'This import has payments recorded against it — undo isn’t possible. Cancel individual invoices instead.' }, { status: 400 });
    }
  }

  // Remove schedules + invoices (lines cascade) + the batch.
  await supabase.from('recurring_invoices').delete().eq('firm_id', ctx.firmId).eq('import_batch', params.batchId);
  await supabase.from('invoices').delete().eq('firm_id', ctx.firmId).eq('import_batch', params.batchId);
  await supabase.from('invoice_import_batches').delete().eq('id', params.batchId).eq('firm_id', ctx.firmId);

  return NextResponse.json({ ok: true, removed: invoiceIds.length });
}
