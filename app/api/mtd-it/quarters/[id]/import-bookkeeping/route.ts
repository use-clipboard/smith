import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeBalances } from '@/lib/bookkeeping/balances';
import { buildImportLines } from '@/lib/mtdIt/bookkeepingImport';
import { getQuarterDates } from '@/lib/mtdIt/quarters';
import type { MtdItQuarterType } from '@/types';

type DB = ReturnType<typeof createClient>;

interface QuarterCtx {
  client_id: string;
  tax_year: number;
  quarter: 1 | 2 | 3 | 4;
  status: string;
  from: string;
  to: string;
}

// Load the quarter, verify it belongs to the firm, and compute its date range.
async function loadQuarter(supabase: DB, quarterId: string, firmId: string): Promise<QuarterCtx | null> {
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, tax_year, quarter, status, clients!inner(firm_id, mtd_it_quarter_type)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return null;
  const client = (data as unknown as { clients?: { firm_id?: string; mtd_it_quarter_type?: MtdItQuarterType | null } }).clients;
  if (client?.firm_id !== firmId) return null;
  const q = (data.quarter as 1 | 2 | 3 | 4);
  const range = getQuarterDates(data.tax_year as number, q, client.mtd_it_quarter_type ?? 'calendar');
  return { client_id: data.client_id as string, tax_year: data.tax_year as number, quarter: q, status: data.status as string, from: range.from, to: range.to };
}

// GET → matching sole-trade books + trades + (if ?book_id) the computed P&L lines
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const q = await loadQuarter(supabase, params.id, ctx.firmId);
  if (!q) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  const [{ data: books }, { data: trades }] = await Promise.all([
    supabase.from('bookkeeping_books')
      .select('id, name, template_type')
      .eq('firm_id', ctx.firmId).eq('client_id', q.client_id).eq('archived', false)
      .in('template_type', ['sole_trader']),
    supabase.from('mtd_it_trades')
      .select('id, name').eq('client_id', q.client_id).eq('active', true).order('created_at', { ascending: true }),
  ]);

  let lines = null;
  const bookId = new URL(req.url).searchParams.get('book_id');
  if (bookId) {
    const book = (books ?? []).find(b => b.id === bookId);
    if (!book) return NextResponse.json({ error: 'Book not found for this client' }, { status: 404 });
    const balances = await computeBalances(supabase, bookId, { from: q.from, to: q.to, excludeTypes: ['YET'] });
    lines = buildImportLines(balances.accounts);
  }

  return NextResponse.json({ from: q.from, to: q.to, books: books ?? [], trades: trades ?? [], lines });
}

// POST → create the mtd_it_entries from the (possibly edited) lines
const Body = z.object({
  book_id: z.string().uuid(),
  trade_id: z.string().uuid().nullable().optional(),
  lines: z.array(z.object({
    description: z.string(),
    entry_type: z.enum(['income', 'expense']),
    amount: z.number(),
    category: z.string().min(1),
  })).min(1),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const q = await loadQuarter(supabase, params.id, ctx.firmId);
  if (!q) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  // Verify the book belongs to the firm + this client.
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id')
    .eq('id', body.book_id).eq('firm_id', ctx.firmId).eq('client_id', q.client_id).maybeSingle();
  if (!book) return NextResponse.json({ error: 'Book not found for this client' }, { status: 404 });

  const rows = body.lines.map(l => ({
    quarter_id: params.id,
    stream: 'sole',
    trade_id: body.trade_id ?? null,
    entry_date: q.to,
    description: l.description,
    category: l.category,
    entry_type: l.entry_type,
    gross_amount: l.amount,
    net_amount: l.amount,
    currency: 'GBP',
    gbp_amount: l.amount,
    manual: true,
  }));

  const { data: created, error } = await supabase.from('mtd_it_entries').insert(rows).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // First entries promote the quarter out of 'not_started'.
  await supabase.from('mtd_it_quarters').update({ status: 'draft' }).eq('id', params.id).eq('status', 'not_started');

  return NextResponse.json({ created: created?.length ?? 0 });
}
