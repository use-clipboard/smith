import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeNextRunDate } from '@/lib/billing/recurrence';

const RowSchema = z.object({
  number: z.string().max(60).nullable(),
  clientName: z.string().max(200),
  clientId: z.string().uuid().nullable(),
  createClient: z.boolean().default(false),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  totalPence: z.number().int().min(0).max(1_000_000_000),
  amountPaidPence: z.number().int().min(0).max(1_000_000_000),
  status: z.enum(['paid', 'part_paid', 'outstanding']),
  description: z.string().max(400).default(''),
});
const Schema = z.object({
  source: z.string().max(30).optional(),
  filename: z.string().max(260).optional(),
  createRecurring: z.boolean().default(false),
  rows: z.array(RowSchema).min(1).max(5000),
});

function slugRef(name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'CLIENT';
  return `${base}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
function trailingNumber(n: string | null): number { const m = (n ?? '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; }

// POST /api/billing/import/commit — write the reviewed rows as invoices.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid import' }, { status: 400 });
  const body = parsed.data;
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Skip invoice numbers that already exist (idempotent re-import).
  const numbers = body.rows.map(r => r.number).filter((n): n is string => !!n);
  const existingNumbers = new Set<string>();
  if (numbers.length) {
    const { data: dupes } = await supabase.from('invoices').select('number').eq('firm_id', ctx.firmId).in('number', numbers);
    for (const d of (dupes ?? []) as { number: string | null }[]) if (d.number) existingNumbers.add(d.number);
  }

  // Create the batch first so everything can be tagged (and undone).
  const { data: batch, error: batchErr } = await supabase
    .from('invoice_import_batches')
    .insert({ firm_id: ctx.firmId, source: body.source ?? 'generic', filename: body.filename ?? null, created_by: ctx.userId })
    .select('id').single();
  if (batchErr || !batch) return NextResponse.json({ error: 'Could not start import' }, { status: 500 });
  const batchId = batch.id as string;

  // Create any new clients (dedupe by name within this import).
  const newClientByName = new Map<string, string>();
  let clientCreatedCount = 0;
  for (const r of body.rows) {
    if (r.clientId || !r.createClient) continue;
    const key = r.clientName.trim().toLowerCase();
    if (newClientByName.has(key)) continue;
    const { data: c } = await supabase.from('clients').insert({ firm_id: ctx.firmId, name: r.clientName.trim(), client_ref: slugRef(r.clientName) }).select('id').single();
    if (c) { newClientByName.set(key, c.id); clientCreatedCount++; }
  }
  const resolveClient = (r: z.infer<typeof RowSchema>): string | null => r.clientId ?? newClientByName.get(r.clientName.trim().toLowerCase()) ?? null;

  // Build invoice rows.
  const toInsert = body.rows
    .filter(r => !(r.number && existingNumbers.has(r.number)))
    .map(r => {
      const issue = r.issueDate ?? today;
      const outstandingOverdue = r.status === 'outstanding' && r.dueDate != null && r.dueDate < today;
      const status = r.status === 'paid' ? 'paid' : r.status === 'part_paid' ? 'part_paid' : outstandingOverdue ? 'overdue' : 'sent';
      const paid = r.status === 'paid' ? r.totalPence : Math.min(r.amountPaidPence, r.totalPence);
      return {
        firm_id: ctx.firmId,
        client_id: resolveClient(r),
        client_name: r.clientName.trim(),
        number: r.number,
        status,
        issue_date: issue,
        due_date: r.dueDate,
        subtotal_pence: r.totalPence, vat_pence: 0, total_pence: r.totalPence,
        amount_paid_pence: paid,
        source: 'import', import_batch: batchId,
        sent_at: issue, paid_at: r.status === 'paid' ? issue : null,
        notes: r.description || null,
        created_by: ctx.userId,
      };
    });

  if (toInsert.length === 0) {
    await supabase.from('invoice_import_batches').delete().eq('id', batchId);
    return NextResponse.json({ error: 'Nothing to import (all rows already exist).' }, { status: 400 });
  }

  const { data: created, error: invErr } = await supabase.from('invoices').insert(toInsert).select('id, client_id, total_pence, issue_date');
  if (invErr || !created) {
    await supabase.from('invoice_import_batches').delete().eq('id', batchId);
    return NextResponse.json({ error: 'Could not create invoices' }, { status: 500 });
  }

  // One line per invoice (single net line; VAT unknown on migration).
  const lineRows = created.map((inv, i) => ({
    invoice_id: inv.id, firm_id: ctx.firmId,
    description: toInsert[i].notes || 'Imported invoice', quantity: 1,
    unit_price_pence: inv.total_pence, vat_rate: 0, net_pence: inv.total_pence, vat_pence: 0, gross_pence: inv.total_pence, position: 0,
  }));
  await supabase.from('invoice_lines').insert(lineRows);

  // Advance the invoice number sequence past the highest imported number.
  const maxNum = Math.max(0, ...numbers.map(trailingNumber));
  if (maxNum > 0) {
    const { data: s } = await supabase.from('billing_settings').select('next_invoice_number, invoice_prefix').eq('firm_id', ctx.firmId).maybeSingle();
    const next = (s?.next_invoice_number as number) ?? 1;
    if (maxNum + 1 > next) {
      await supabase.from('billing_settings').upsert({ firm_id: ctx.firmId, next_invoice_number: maxNum + 1, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });
    }
  }

  // Optional: detect recurring schedules from repeating invoices.
  let recurringCount = 0;
  if (body.createRecurring) {
    const clientNameById = new Map<string, string>();
    created.forEach((inv, i) => { if (inv.client_id) clientNameById.set(inv.client_id, toInsert[i].client_name); });
    const groups = new Map<string, { total: number; dates: string[] }>();
    for (const inv of created) {
      if (!inv.client_id) continue;
      const roundedPounds = Math.round(inv.total_pence / 100);
      const key = `${inv.client_id}:${roundedPounds}`;
      const g = groups.get(key) ?? { total: inv.total_pence, dates: [] as string[] };
      g.dates.push(inv.issue_date as string); groups.set(key, g);
    }
    for (const [key, g] of groups) {
      if (g.dates.length < 3) continue;
      const sorted = g.dates.slice().sort();
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) gaps.push((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000);
      const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      const freq = med >= 25 && med <= 35 ? 'monthly' : med >= 85 && med <= 95 ? 'quarterly' : med >= 355 && med <= 375 ? 'annual' : null;
      if (!freq) continue;
      const clientId = key.split(':')[0];
      const last = sorted[sorted.length - 1];
      const next = computeNextRunDate(last, freq, null, null);
      await supabase.from('recurring_invoices').insert({
        firm_id: ctx.firmId, client_id: clientId, client_name: clientNameById.get(clientId) ?? null,
        frequency: freq, start_date: last, next_run_date: next, status: 'active',
        template: [{ description: 'Imported recurring', quantity: 1, unitPricePence: g.total, vatRate: 0 }],
        subtotal_pence: g.total, vat_pence: 0, total_pence: g.total,
        auto_send: false, import_batch: batchId, source_note: 'Detected from imported history', created_by: ctx.userId,
      });
      recurringCount++;
    }
  }

  await supabase.from('invoice_import_batches').update({ invoice_count: created.length, client_created_count: clientCreatedCount, recurring_count: recurringCount }).eq('id', batchId);

  return NextResponse.json({ batchId, invoiceCount: created.length, clientCreatedCount, recurringCount, skipped: body.rows.length - toInsert.length });
}
