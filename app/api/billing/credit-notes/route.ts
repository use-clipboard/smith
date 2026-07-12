import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { allocateCreditNoteNumber } from '@/lib/billing/numbering';
import { logBillingAudit, requireAdmin } from '@/lib/billing/audit';
import { fmtPence } from '@/lib/billing/totals';
import type { CreditNote } from '@/lib/billing/types';

interface CreditNoteRow {
  id: string; number: string | null; invoice_id: string | null;
  amount_pence: number; reason: string | null; status: string; created_at: string;
}
const mapRow = (r: CreditNoteRow): CreditNote => ({
  id: r.id, number: r.number, invoiceId: r.invoice_id, amountPence: r.amount_pence,
  reason: r.reason, status: r.status, createdAt: r.created_at,
});

// GET /api/billing/credit-notes?invoiceId= → credit notes for an invoice (or firm).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const invoiceId = new URL(req.url).searchParams.get('invoiceId');
  const supabase = createClient();
  let query = supabase.from('credit_notes').select('id, number, invoice_id, amount_pence, reason, status, created_at')
    .eq('firm_id', ctx.firmId).order('created_at', { ascending: false }).limit(500);
  if (invoiceId) query = query.eq('invoice_id', invoiceId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load credit notes' }, { status: 500 });
  return NextResponse.json({ creditNotes: (data as CreditNoteRow[]).map(mapRow) });
}

const CreateSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPence: z.number().int().positive().max(1_000_000_000),
  reason: z.string().max(400).nullable().optional(),
});

// POST /api/billing/credit-notes — raise a credit note against an invoice.
// Reduces the invoice's outstanding balance (total − paid − credit); if that
// clears it, the invoice is marked settled.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  const gate = requireAdmin(ctx.userRole, 'raise credit notes');
  if (gate) return gate;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid credit note' }, { status: 400 });
  const body = parsed.data;

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices').select('id, client_id, total_pence, amount_paid_pence, credit_pence, status')
    .eq('id', body.invoiceId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const currentCredit = inv.credit_pence ?? 0;
  const outstanding = balancePence(inv.total_pence, inv.amount_paid_pence, currentCredit);
  if (body.amountPence > outstanding) {
    return NextResponse.json({ error: `Credit note can't exceed the £${(outstanding / 100).toFixed(2)} outstanding.` }, { status: 400 });
  }

  const number = await allocateCreditNoteNumber(supabase, ctx.firmId);
  const { data: cn, error: cnErr } = await supabase
    .from('credit_notes')
    .insert({
      firm_id: ctx.firmId, client_id: inv.client_id ?? null, invoice_id: inv.id,
      number, amount_pence: body.amountPence, reason: body.reason ?? null, status: 'issued', created_by: ctx.userId,
    })
    .select('id, number, invoice_id, amount_pence, reason, status, created_at')
    .single();
  if (cnErr || !cn) return NextResponse.json({ error: 'Could not raise credit note' }, { status: 500 });

  const newCredit = currentCredit + body.amountPence;
  const settled = balancePence(inv.total_pence, inv.amount_paid_pence, newCredit) <= 0;
  await supabase.from('invoices').update({
    credit_pence: newCredit,
    status: settled ? 'paid' : inv.status,
    updated_at: new Date().toISOString(),
  }).eq('id', inv.id).eq('firm_id', ctx.firmId);

  await logBillingAudit(supabase, { firmId: ctx.firmId, invoiceId: inv.id, userId: ctx.userId, action: 'credit_note', detail: `${number} · ${fmtPence(body.amountPence)}${body.reason ? ` · ${body.reason}` : ''}` });

  return NextResponse.json({ creditNote: mapRow(cn as CreditNoteRow) }, { status: 201 });
}
