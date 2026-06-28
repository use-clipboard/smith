import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isDue } from '@/lib/bookkeeping/recurring';

type DB = ReturnType<typeof createClient>;

async function loadBook(supabase: DB, bookId: string, firmId: string) {
  const { data } = await supabase
    .from('bookkeeping_books').select('id, firm_id').eq('id', bookId).eq('firm_id', firmId).maybeSingle();
  return data ?? null;
}

const TRANSACTION_TYPES = ['PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','RJN','TRF','WOF','WBK','YET','DVT'] as const;
const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

const SplitSchema = z.object({
  account_id: z.string().uuid(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  entry_details: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  fund_id: z.string().uuid().nullable().optional(),
});

const TemplateSchema = z.object({
  payee_text: z.string().max(200).nullable().optional(),
  details: z.string().max(500).nullable().optional(),
  total: z.number().min(0),
  vat_total: z.number().min(0).default(0),
  vat_rate: z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  primary_account_id: z.string().uuid().nullable().optional(),
  splits: z.array(SplitSchema).min(1),
});

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(TRANSACTION_TYPES),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  interval_count: z.number().int().min(1).max(52).default(1),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  template: TemplateSchema,
});

// ── GET /api/bookkeeping/books/[id]/recurring ────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  if (!await loadBook(supabase, params.id, ctx.firmId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_recurring_transactions')
    .select('*')
    .eq('book_id', params.id)
    .order('active', { ascending: false })
    .order('next_due_date', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const recurring = (data ?? []).map(r => ({
    ...r,
    is_due: isDue(r.next_due_date as string, r.active as boolean, today, (r.end_date as string | null) ?? null),
  }));
  return NextResponse.json({ recurring, due_count: recurring.filter(r => r.is_due).length });
}

// ── POST /api/bookkeeping/books/[id]/recurring ───────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // Double-entry sanity on the template.
  const dr = body.template.splits.reduce((s, x) => s + x.debit, 0);
  const cr = body.template.splits.reduce((s, x) => s + x.credit, 0);
  if (Math.abs(dr - cr) > 0.005) {
    return NextResponse.json({ error: `Template is out of balance: Dr ${dr.toFixed(2)} vs Cr ${cr.toFixed(2)}` }, { status: 400 });
  }

  const supabase = createClient();
  if (!await loadBook(supabase, params.id, ctx.firmId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_recurring_transactions')
    .insert({
      book_id: params.id,
      name: body.name.trim(),
      type: body.type,
      frequency: body.frequency,
      interval_count: body.interval_count,
      next_due_date: body.next_due_date,
      end_date: body.end_date ?? null,
      template: body.template,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recurring: { ...data, is_due: false } });
}
