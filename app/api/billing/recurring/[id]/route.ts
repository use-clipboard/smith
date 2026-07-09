import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeInvoiceTotals } from '@/lib/billing/totals';
import { computeNextRunDate } from '@/lib/billing/recurrence';
import { mapRecurringRow, type RecurringRow } from '@/lib/billing/map';
import type { RecurrenceFrequency } from '@/lib/billing/types';

const LineSchema = z.object({
  description: z.string().max(400).default(''),
  quantity: z.number().min(0).max(1_000_000),
  unitPricePence: z.number().int().min(-100_000_000).max(100_000_000),
  vatRate: z.number().min(0).max(100).default(0),
});

const PatchSchema = z.object({
  action: z.enum(['pause', 'resume', 'skip']).optional(),
  clientName: z.string().max(200).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  autoSend: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  lines: z.array(LineSchema).min(1).max(200).optional(),
});

// PATCH /api/billing/recurring/[id] — lifecycle actions or field edits.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const p = parsed.data;

  const supabase = createClient();
  const { data: rec } = await supabase
    .from('recurring_invoices').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (p.action === 'pause') updates.status = 'paused';
  if (p.action === 'resume') updates.status = 'active';
  if (p.action === 'skip') {
    updates.next_run_date = computeNextRunDate(
      rec.next_run_date, rec.frequency as RecurrenceFrequency, rec.day_of_month, rec.interval_days,
    );
  }

  if (p.clientName !== undefined) updates.client_name = p.clientName;
  if (p.dayOfMonth !== undefined) updates.day_of_month = p.dayOfMonth;
  if (p.endDate !== undefined) updates.end_date = p.endDate;
  if (p.nextRunDate !== undefined) updates.next_run_date = p.nextRunDate;
  if (p.autoSend !== undefined) updates.auto_send = p.autoSend;
  if (p.notes !== undefined) updates.notes = p.notes;
  if (p.terms !== undefined) updates.terms = p.terms;

  if (p.lines) {
    const totals = computeInvoiceTotals(p.lines);
    updates.template = totals.lines.map(l => ({
      description: l.description, quantity: l.quantity, unitPricePence: l.unitPricePence, vatRate: l.vatRate,
    }));
    updates.subtotal_pence = totals.subtotalPence;
    updates.vat_pence = totals.vatPence;
    updates.total_pence = totals.totalPence;
  }

  const { data: updated, error } = await supabase
    .from('recurring_invoices').update(updates).eq('id', params.id).eq('firm_id', ctx.firmId).select('*').single();
  if (error || !updated) return NextResponse.json({ error: 'Could not update schedule' }, { status: 500 });

  return NextResponse.json({ recurring: mapRecurringRow(updated as RecurringRow) });
}

// DELETE /api/billing/recurring/[id] — remove a schedule (issued invoices remain).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { error } = await supabase
    .from('recurring_invoices').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Could not delete schedule' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
