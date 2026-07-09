import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeInvoiceTotals } from '@/lib/billing/totals';
import type { RecurringRow } from '@/lib/billing/map';
import type { RecurringTemplateLine } from '@/lib/billing/types';

const Schema = z.object({
  percent: z.number().min(-90).max(500),
  frequency: z.enum(['all', 'monthly', 'quarterly', 'annual', 'custom']).default('all'),
  ids: z.array(z.string().uuid()).max(1000).optional(),
});

// POST /api/billing/recurring/price-increase — apply a % change to the unit
// prices of matching active schedules (e.g. "all monthly +5%"). Recomputes
// each template's totals. Returns how many schedules were updated.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { percent, frequency, ids } = parsed.data;

  const supabase = createClient();
  let query = supabase.from('recurring_invoices').select('*').eq('firm_id', ctx.firmId).eq('status', 'active');
  if (frequency !== 'all') query = query.eq('frequency', frequency);
  if (ids && ids.length) query = query.in('id', ids);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load schedules' }, { status: 500 });

  const rows = (data ?? []) as RecurringRow[];
  const factor = 1 + percent / 100;
  let updated = 0;

  for (const rec of rows) {
    const template = (rec.template ?? []) as RecurringTemplateLine[];
    if (!template.length) continue;
    const bumped = template.map(l => ({
      description: l.description,
      quantity: l.quantity,
      unitPricePence: Math.round(l.unitPricePence * factor),
      vatRate: l.vatRate,
    }));
    const totals = computeInvoiceTotals(bumped);
    const { error: upErr } = await supabase
      .from('recurring_invoices')
      .update({
        template: totals.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPricePence: l.unitPricePence, vatRate: l.vatRate })),
        subtotal_pence: totals.subtotalPence,
        vat_pence: totals.vatPence,
        total_pence: totals.totalPence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rec.id).eq('firm_id', ctx.firmId);
    if (!upErr) updated++;
  }

  return NextResponse.json({ ok: true, updated, matched: rows.length });
}
