import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { computeInvoiceTotals } from '@/lib/billing/totals';
import { allocateInvoiceNumber } from '@/lib/billing/numbering';
import { mapInvoiceRow, type InvoiceRow } from '@/lib/billing/map';

const LIST_STATUSES = ['draft','sent','viewed','part_paid','paid','overdue','cancelled','bad_debt'] as const;

// GET /api/billing/invoices?status=&search=&limit= → invoice list (no lines).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();
  const limit = Math.min(Number(searchParams.get('limit')) || 200, 500);

  const supabase = createClient();
  let query = supabase
    .from('invoices')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && (LIST_STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status);
  }
  if (search) {
    query = query.or(`number.ilike.%${search}%,client_name.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load invoices' }, { status: 500 });

  return NextResponse.json({ invoices: (data as InvoiceRow[]).map(r => mapInvoiceRow(r)) });
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
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'sent']).default('draft'),
  lines: z.array(LineSchema).min(1).max(200),
});

// POST /api/billing/invoices — create an invoice (draft or sent).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid invoice' }, { status: 400 });
  const body = parsed.data;

  const totals = computeInvoiceTotals(body.lines);
  const supabase = createClient();

  // A number is assigned when the invoice is issued (sent); drafts stay unnumbered.
  const number = body.status === 'sent' ? await allocateInvoiceNumber(supabase, ctx.firmId) : null;
  const nowIso = new Date().toISOString();

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .insert({
      firm_id: ctx.firmId,
      client_id: body.clientId ?? null,
      client_name: body.clientName ?? null,
      number,
      status: body.status,
      issue_date: body.issueDate ?? null,
      due_date: body.dueDate ?? null,
      subtotal_pence: totals.subtotalPence,
      vat_pence: totals.vatPence,
      total_pence: totals.totalPence,
      amount_paid_pence: 0,
      notes: body.notes ?? null,
      terms: body.terms ?? null,
      source: 'manual',
      sent_at: body.status === 'sent' ? nowIso : null,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (invErr || !inv) return NextResponse.json({ error: 'Could not create invoice' }, { status: 500 });

  const lineRows = totals.lines.map((l, i) => ({
    invoice_id: inv.id,
    firm_id: ctx.firmId,
    description: l.description,
    quantity: l.quantity,
    unit_price_pence: l.unitPricePence,
    vat_rate: l.vatRate,
    net_pence: l.netPence,
    vat_pence: l.vatPence,
    gross_pence: l.grossPence,
    position: i,
  }));
  const { error: lineErr } = await supabase.from('invoice_lines').insert(lineRows);
  if (lineErr) {
    // Roll back the header so we never leave a lineless invoice.
    await supabase.from('invoices').delete().eq('id', inv.id);
    return NextResponse.json({ error: 'Could not create invoice lines' }, { status: 500 });
  }

  return NextResponse.json({ invoice: mapInvoiceRow(inv as InvoiceRow) }, { status: 201 });
}
