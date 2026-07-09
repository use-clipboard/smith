// Billing module — recurring-invoice date math + the mint producer.
//
// Mirrors lib/tasks/recurrence.ts's clamped month arithmetic, but time-driven:
// a daily cron (/api/billing/recurring/run) calls generateDueRecurringInvoices,
// which mints one `invoices` row per due schedule and advances next_run_date.
// Idempotent per (schedule, run-date): a re-run never double-mints.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeLine } from './totals';
import { allocateInvoiceNumber } from './numbering';
import type { RecurrenceFrequency, RecurringTemplateLine } from './types';

/** Next scheduled date after `fromIso` for a given frequency. */
export function computeNextRunDate(
  fromIso: string,
  frequency: RecurrenceFrequency,
  dayOfMonth: number | null,
  intervalDays: number | null,
): string {
  const base = new Date(`${fromIso}T00:00:00Z`);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  if (frequency === 'custom') {
    const x = new Date(base.getTime());
    x.setUTCDate(x.getUTCDate() + (intervalDays && intervalDays > 0 ? intervalDays : 30));
    return x.toISOString().slice(0, 10);
  }

  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const idx = m + step;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const targetDay = dayOfMonth && dayOfMonth > 0 ? dayOfMonth : d;
  return new Date(Date.UTC(ty, tm, Math.min(targetDay, lastDay))).toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface RecurringRow {
  id: string;
  firm_id: string;
  client_id: string | null;
  client_name: string | null;
  frequency: RecurrenceFrequency;
  interval_days: number | null;
  day_of_month: number | null;
  next_run_date: string;
  end_date: string | null;
  status: string;
  template: RecurringTemplateLine[] | null;
  notes: string | null;
  terms: string | null;
  auto_send: boolean;
  created_by: string | null;
}

/**
 * Mint one invoice for a schedule's current next_run_date and advance the date.
 * Idempotent: if an invoice already exists for (schedule, run-date) it advances
 * without minting a duplicate. Returns whether a new invoice was created.
 */
export async function mintRecurringInvoice(
  supabase: SupabaseClient,
  rec: RecurringRow,
  termsDays: number,
): Promise<{ minted: boolean; invoiceId: string | null }> {
  const runDate = rec.next_run_date;

  // Idempotency guard: already minted for this run-date?
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('firm_id', rec.firm_id)
    .eq('source', 'recurring')
    .eq('source_id', rec.id)
    .eq('issue_date', runDate)
    .maybeSingle();

  let invoiceId: string | null = existing?.id ?? null;
  let minted = false;

  if (!existing) {
    const lines = (rec.template ?? []).map((l, i) =>
      computeLine({ description: l.description, quantity: l.quantity, unitPricePence: l.unitPricePence, vatRate: l.vatRate, position: i }),
    );
    const subtotal = lines.reduce((s, l) => s + l.netPence, 0);
    const vat = lines.reduce((s, l) => s + l.vatPence, 0);
    const nowIso = new Date().toISOString();
    const number = rec.auto_send ? await allocateInvoiceNumber(supabase, rec.firm_id) : null;

    const { data: inv, error } = await supabase
      .from('invoices')
      .insert({
        firm_id: rec.firm_id,
        client_id: rec.client_id,
        client_name: rec.client_name,
        number,
        status: rec.auto_send ? 'sent' : 'draft',
        issue_date: runDate,
        due_date: addDaysIso(runDate, termsDays),
        subtotal_pence: subtotal,
        vat_pence: vat,
        total_pence: subtotal + vat,
        notes: rec.notes,
        terms: rec.terms,
        source: 'recurring',
        source_id: rec.id,
        sent_at: rec.auto_send ? nowIso : null,
        created_by: rec.created_by,
      })
      .select('id')
      .single();

    if (error || !inv) {
      console.error('mintRecurringInvoice insert', error);
      return { minted: false, invoiceId: null };
    }
    invoiceId = inv.id;
    minted = true;

    if (lines.length > 0) {
      await supabase.from('invoice_lines').insert(
        lines.map((l, i) => ({
          invoice_id: inv.id,
          firm_id: rec.firm_id,
          description: l.description,
          quantity: l.quantity,
          unit_price_pence: l.unitPricePence,
          vat_rate: l.vatRate,
          net_pence: l.netPence,
          vat_pence: l.vatPence,
          gross_pence: l.grossPence,
          position: i,
        })),
      );
    }
  }

  // Advance the schedule. If the next date runs past end_date, park it (paused).
  const nextRun = computeNextRunDate(runDate, rec.frequency, rec.day_of_month, rec.interval_days);
  const finished = rec.end_date != null && nextRun > rec.end_date;
  await supabase
    .from('recurring_invoices')
    .update({
      next_run_date: nextRun,
      last_run_date: runDate,
      last_invoice_id: invoiceId,
      status: finished ? 'paused' : rec.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rec.id);

  return { minted, invoiceId };
}

/**
 * Mint invoices for every schedule that is due (next_run_date <= today, not
 * ended, active). One invoice per schedule per run — a schedule that's several
 * periods behind catches up over subsequent daily runs. Uses a service-role
 * client (cron has no user session).
 */
export async function generateDueRecurringInvoices(
  supabase: SupabaseClient,
  opts: { today?: string; firmId?: string } = {},
): Promise<{ minted: number; scanned: number }> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  let query = supabase
    .from('recurring_invoices')
    .select('*')
    .eq('status', 'active')
    .lte('next_run_date', today)
    .order('next_run_date', { ascending: true })
    .limit(500);
  if (opts.firmId) query = query.eq('firm_id', opts.firmId);

  const { data, error } = await query;
  if (error) { console.error('generateDueRecurringInvoices fetch', error); return { minted: 0, scanned: 0 }; }

  const rows = (data ?? []) as RecurringRow[];
  // Cache each firm's payment-terms once.
  const termsCache = new Map<string, number>();
  async function termsFor(firmId: string): Promise<number> {
    if (termsCache.has(firmId)) return termsCache.get(firmId)!;
    const { data: s } = await supabase.from('billing_settings').select('default_payment_terms_days').eq('firm_id', firmId).maybeSingle();
    const t = s?.default_payment_terms_days ?? 14;
    termsCache.set(firmId, t);
    return t;
  }

  let minted = 0;
  for (const rec of rows) {
    // Skip schedules whose end_date has already passed.
    if (rec.end_date != null && rec.next_run_date > rec.end_date) continue;
    const terms = await termsFor(rec.firm_id);
    const res = await mintRecurringInvoice(supabase, rec, terms);
    if (res.minted) minted++;
  }

  return { minted, scanned: rows.length };
}
