import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { allocateInvoiceNumber } from '@/lib/billing/numbering';
import { mapInvoiceRow, type InvoiceRow, type InvoiceLineRow } from '@/lib/billing/map';

// GET /api/billing/invoices/[id] → full invoice with lines.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: lines } = await supabase
    .from('invoice_lines').select('*').eq('invoice_id', params.id).order('position', { ascending: true });

  return NextResponse.json({ invoice: mapInvoiceRow(inv as InvoiceRow, (lines ?? []) as InvoiceLineRow[]) });
}

const PatchSchema = z.object({
  status: z.enum(['draft','sent','viewed','part_paid','paid','overdue','cancelled','bad_debt']).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  autoChase: z.boolean().optional(),
});

// PATCH /api/billing/invoices/[id] — update header fields / status.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const p = parsed.data;

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('invoices').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: nowIso };
  if (p.issueDate !== undefined) updates.issue_date = p.issueDate;
  if (p.dueDate !== undefined) updates.due_date = p.dueDate;
  if (p.notes !== undefined) updates.notes = p.notes;
  if (p.terms !== undefined) updates.terms = p.terms;
  if (p.autoChase !== undefined) updates.auto_chase = p.autoChase;

  if (p.status !== undefined) {
    updates.status = p.status;
    // Issuing a draft: stamp sent_at and allocate a number if it has none.
    if (p.status === 'sent') {
      if (!existing.sent_at) updates.sent_at = nowIso;
      if (!existing.number) updates.number = await allocateInvoiceNumber(supabase, ctx.firmId);
    }
    if (p.status === 'viewed' && !existing.viewed_at) updates.viewed_at = nowIso;
    if (p.status === 'paid') updates.paid_at = nowIso;
  }

  const { data: updated, error } = await supabase
    .from('invoices').update(updates).eq('id', params.id).eq('firm_id', ctx.firmId).select('*').single();
  if (error || !updated) return NextResponse.json({ error: 'Could not update invoice' }, { status: 500 });

  return NextResponse.json({ invoice: mapInvoiceRow(updated as InvoiceRow) });
}

// DELETE /api/billing/invoices/[id] — remove a draft/cancelled invoice.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('invoices').select('status, amount_paid_pence').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if ((existing.amount_paid_pence ?? 0) > 0) {
    return NextResponse.json({ error: 'Cannot delete an invoice with payments — cancel it instead.' }, { status: 400 });
  }

  const { error } = await supabase.from('invoices').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Could not delete invoice' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
