import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeInvoiceTotals } from '@/lib/billing/totals';
import { mapRecurringRow, type RecurringRow } from '@/lib/billing/map';

// GET /api/billing/recurring → all schedules for the firm.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('recurring_invoices')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('next_run_date', { ascending: true });
  if (error) return NextResponse.json({ error: 'Could not load schedules' }, { status: 500 });

  return NextResponse.json({ recurring: (data as RecurringRow[]).map(mapRecurringRow) });
}

const LineSchema = z.object({
  description: z.string().max(400).default(''),
  quantity: z.number().min(0).max(1_000_000),
  unitPricePence: z.number().int().min(-100_000_000).max(100_000_000),
  vatRate: z.number().min(0).max(100).default(0),
});

const CreateSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().max(200).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'annual', 'custom']),
  intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  autoSend: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  lines: z.array(LineSchema).min(1).max(200),
});

// POST /api/billing/recurring — create a schedule (first run = startDate).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid schedule' }, { status: 400 });
  const body = parsed.data;
  if (body.frequency === 'custom' && !body.intervalDays) {
    return NextResponse.json({ error: 'Custom frequency needs an interval in days.' }, { status: 400 });
  }

  const totals = computeInvoiceTotals(body.lines);
  const template = totals.lines.map(l => ({
    description: l.description, quantity: l.quantity, unitPricePence: l.unitPricePence, vatRate: l.vatRate,
  }));

  const supabase = createClient();
  const { data, error } = await supabase
    .from('recurring_invoices')
    .insert({
      firm_id: ctx.firmId,
      client_id: body.clientId ?? null,
      client_name: body.clientName ?? null,
      frequency: body.frequency,
      interval_days: body.frequency === 'custom' ? body.intervalDays : null,
      day_of_month: body.dayOfMonth ?? null,
      start_date: body.startDate,
      next_run_date: body.startDate,
      end_date: body.endDate ?? null,
      status: 'active',
      template,
      subtotal_pence: totals.subtotalPence,
      vat_pence: totals.vatPence,
      total_pence: totals.totalPence,
      notes: body.notes ?? null,
      terms: body.terms ?? null,
      auto_send: body.autoSend,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (error || !data) return NextResponse.json({ error: 'Could not create schedule' }, { status: 500 });
  return NextResponse.json({ recurring: mapRecurringRow(data as RecurringRow) }, { status: 201 });
}
