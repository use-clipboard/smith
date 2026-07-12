import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeInvoiceTotals } from '@/lib/billing/totals';
import { mapInvoiceRow, type InvoiceRow } from '@/lib/billing/map';

interface TimeEntryRow {
  id: string; entry_date: string; activity: string | null; task_title: string | null;
  minutes: number; rate_pence: number;
}

/** Set of time-entry ids already billed (appear in an invoice line). */
async function billedEntryIds(supabase: ReturnType<typeof createClient>, firmId: string): Promise<Set<string>> {
  const { data } = await supabase.from('invoice_lines').select('time_entry_ids').eq('firm_id', firmId).not('time_entry_ids', 'is', null);
  const set = new Set<string>();
  for (const r of (data ?? []) as { time_entry_ids: string[] | null }[]) for (const id of r.time_entry_ids ?? []) set.add(id);
  return set;
}

async function firmDefaultRatePence(supabase: ReturnType<typeof createClient>, firmId: string): Promise<number> {
  const { data } = await supabase.from('firms').select('timesheet_settings').eq('id', firmId).maybeSingle();
  const s = data?.timesheet_settings as { defaultRatePence?: number } | null;
  return s?.defaultRatePence ?? 12000;
}
function entryValue(minutes: number, ratePence: number, fallbackRate: number): number {
  return Math.round((minutes / 60) * (ratePence > 0 ? ratePence : fallbackRate));
}

// GET /api/billing/bill-from-time?clientId= → unbilled billable time for a client.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

  const supabase = createClient();
  const [{ data: entryData }, billed, fallbackRate] = await Promise.all([
    supabase.from('time_entries').select('id, entry_date, activity, task_title, minutes, rate_pence')
      .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('entry_type', 'billable')
      .order('entry_date', { ascending: true }).limit(3000),
    billedEntryIds(supabase, ctx.firmId),
    firmDefaultRatePence(supabase, ctx.firmId),
  ]);

  const entries = ((entryData ?? []) as TimeEntryRow[])
    .filter(e => !billed.has(e.id))
    .map(e => ({
      id: e.id, date: e.entry_date, activity: e.activity || e.task_title || 'Work',
      minutes: e.minutes, valuePence: entryValue(e.minutes, e.rate_pence, fallbackRate),
    }));

  return NextResponse.json({
    entries,
    totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
    totalValuePence: entries.reduce((s, e) => s + e.valuePence, 0),
  });
}

const CreateSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().max(200).optional(),
  entryIds: z.array(z.string().uuid()).min(1).max(3000),
  grouping: z.enum(['entry', 'activity', 'single']).default('activity'),
});

function hoursLabel(minutes: number): string { return `${(minutes / 60).toFixed(2)}h`; }

// POST /api/billing/bill-from-time — create a draft invoice from selected time.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const body = parsed.data;

  const supabase = createClient();
  const [{ data: entryData }, billed, fallbackRate, { data: settings }] = await Promise.all([
    supabase.from('time_entries').select('id, entry_date, activity, task_title, minutes, rate_pence')
      .eq('firm_id', ctx.firmId).eq('client_id', body.clientId).eq('entry_type', 'billable').in('id', body.entryIds),
    billedEntryIds(supabase, ctx.firmId),
    firmDefaultRatePence(supabase, ctx.firmId),
    supabase.from('billing_settings').select('vat_registered, default_vat_rate, default_payment_terms_days').eq('firm_id', ctx.firmId).maybeSingle(),
  ]);

  // Only bill entries that are still unbilled (guards against double-billing).
  const entries = ((entryData ?? []) as TimeEntryRow[])
    .filter(e => !billed.has(e.id))
    .map(e => ({ ...e, activityLabel: e.activity || e.task_title || 'Work', value: entryValue(e.minutes, e.rate_pence, fallbackRate) }));
  if (entries.length === 0) return NextResponse.json({ error: 'Those time entries are already billed.' }, { status: 400 });

  const vatRate = (settings?.vat_registered ?? true) ? Number(settings?.default_vat_rate ?? 20) : 0;
  const termsDays = settings?.default_payment_terms_days ?? 14;

  // Build lines + the time-entry ids each covers.
  type Built = { description: string; netPence: number; entryIds: string[] };
  let built: Built[] = [];
  if (body.grouping === 'entry') {
    built = entries.map(e => ({ description: `${e.activityLabel} (${hoursLabel(e.minutes)}, ${e.entry_date})`, netPence: e.value, entryIds: [e.id] }));
  } else if (body.grouping === 'activity') {
    const groups = new Map<string, Built & { minutes: number }>();
    for (const e of entries) {
      const g = groups.get(e.activityLabel) ?? { description: e.activityLabel, netPence: 0, entryIds: [], minutes: 0 };
      g.netPence += e.value; g.entryIds.push(e.id); g.minutes += e.minutes;
      groups.set(e.activityLabel, g);
    }
    built = Array.from(groups.values()).map(g => ({ description: `${g.description} — ${hoursLabel(g.minutes)}`, netPence: g.netPence, entryIds: g.entryIds }));
  } else {
    const totalMin = entries.reduce((s, e) => s + e.minutes, 0);
    built = [{ description: `Professional services — ${hoursLabel(totalMin)}`, netPence: entries.reduce((s, e) => s + e.value, 0), entryIds: entries.map(e => e.id) }];
  }

  const totals = computeInvoiceTotals(built.map(b => ({ quantity: 1, unitPricePence: b.netPence, vatRate })));
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now()); due.setUTCDate(due.getUTCDate() + termsDays);

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .insert({
      firm_id: ctx.firmId, client_id: body.clientId, client_name: body.clientName ?? null,
      status: 'draft', issue_date: today, due_date: due.toISOString().slice(0, 10),
      subtotal_pence: totals.subtotalPence, vat_pence: totals.vatPence, total_pence: totals.totalPence,
      source: 'timesheet', created_by: ctx.userId,
    })
    .select('*').single();
  if (invErr || !inv) return NextResponse.json({ error: 'Could not create invoice' }, { status: 500 });

  const lineRows = totals.lines.map((l, i) => ({
    invoice_id: inv.id, firm_id: ctx.firmId,
    description: built[i].description, quantity: 1, unit_price_pence: l.unitPricePence,
    vat_rate: l.vatRate, net_pence: l.netPence, vat_pence: l.vatPence, gross_pence: l.grossPence,
    time_entry_ids: built[i].entryIds, position: i,
  }));
  const { error: lineErr } = await supabase.from('invoice_lines').insert(lineRows);
  if (lineErr) { await supabase.from('invoices').delete().eq('id', inv.id); return NextResponse.json({ error: 'Could not create invoice lines' }, { status: 500 }); }

  return NextResponse.json({ invoice: mapInvoiceRow(inv as InvoiceRow), billedEntries: entries.length }, { status: 201 });
}
