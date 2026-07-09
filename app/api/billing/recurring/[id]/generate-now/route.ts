import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { mintRecurringInvoice } from '@/lib/billing/recurrence';

// POST /api/billing/recurring/[id]/generate-now — mint this schedule's invoice
// immediately (for its current next_run_date) and advance the schedule.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data: rec } = await supabase
    .from('recurring_invoices').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: s } = await supabase
    .from('billing_settings').select('default_payment_terms_days').eq('firm_id', ctx.firmId).maybeSingle();
  const terms = s?.default_payment_terms_days ?? 14;

  const res = await mintRecurringInvoice(supabase, rec, terms);
  if (!res.invoiceId && !res.minted) {
    return NextResponse.json({ error: 'Could not generate invoice' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, minted: res.minted, invoiceId: res.invoiceId });
}
