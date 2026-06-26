import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Proportional split with penny-rounding remainder assigned to the largest. */
function splitByPct(total: number, pcts: number[]): number[] {
  const amounts = pcts.map(p => round2(total * (p || 0) / 100));
  if (amounts.length > 0) {
    const allocated = round2(amounts.reduce((s, a) => s + a, 0));
    const residual = round2(total - allocated);
    if (Math.abs(residual) >= 0.005) {
      let idx = 0;
      for (let i = 1; i < amounts.length; i++) if (Math.abs(amounts[i]) > Math.abs(amounts[idx])) idx = i;
      amounts[idx] = round2(amounts[idx] + residual);
    }
  }
  return amounts;
}

const Body = z.object({
  dividend_type: z.enum(['interim', 'final']).default('interim'),
  declaration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tax_year: z.string().max(20).nullable().optional(),
  total_amount: z.number().positive(),
  notes: z.string().max(2000).nullable().optional(),
});

// GET → dividends for a book, each with its recipients
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: dividends } = await supabase
    .from('bookkeeping_dividends')
    .select('id, dividend_type, declaration_date, payment_date, tax_year, total_amount, notes, created_at')
    .eq('book_id', params.id)
    .order('declaration_date', { ascending: false });

  const ids = (dividends ?? []).map(d => d.id as string);
  const recByDiv = new Map<string, Array<{ id: string; name: string; shareholding_pct: number | null; amount: number }>>();
  if (ids.length > 0) {
    const { data: recs } = await supabase
      .from('bookkeeping_dividend_recipients')
      .select('id, dividend_id, name, shareholding_pct, amount')
      .in('dividend_id', ids);
    for (const r of recs ?? []) {
      const arr = recByDiv.get(r.dividend_id as string) ?? [];
      arr.push({ id: r.id as string, name: r.name as string, shareholding_pct: r.shareholding_pct as number | null, amount: Number(r.amount) });
      recByDiv.set(r.dividend_id as string, arr);
    }
  }

  return NextResponse.json({
    dividends: (dividends ?? []).map(d => ({ ...d, recipients: recByDiv.get(d.id as string) ?? [] })),
  });
}

// POST → declare a dividend (snapshot shareholders by holding)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Shareholder participants.
  const { data: shareholders } = await supabase
    .from('bookkeeping_book_participants')
    .select('id, name, shareholding_pct')
    .eq('book_id', params.id)
    .eq('role', 'shareholder')
    .order('created_at', { ascending: true });
  if (!shareholders || shareholders.length === 0) {
    return NextResponse.json({ error: 'No shareholders on this book — add them in People & roles first.' }, { status: 400 });
  }

  const total = round2(body.total_amount);
  const pcts = shareholders.map(s => Number(s.shareholding_pct ?? 0));
  const amounts = splitByPct(total, pcts);

  const { data: dividend, error: divErr } = await supabase
    .from('bookkeeping_dividends')
    .insert({
      book_id: params.id, firm_id: ctx.firmId,
      dividend_type: body.dividend_type, declaration_date: body.declaration_date,
      payment_date: body.payment_date ?? null, tax_year: body.tax_year ?? null,
      total_amount: total, notes: body.notes ?? null, created_by: ctx.userId,
    })
    .select('id, dividend_type, declaration_date, payment_date, tax_year, total_amount, notes, created_at')
    .single();
  if (divErr || !dividend) return NextResponse.json({ error: divErr?.message ?? 'Insert failed' }, { status: 500 });

  const recipientRows = shareholders.map((s, i) => ({
    dividend_id: dividend.id, firm_id: ctx.firmId, participant_id: s.id,
    name: s.name as string, shareholding_pct: Number(s.shareholding_pct ?? 0), amount: amounts[i],
  }));
  const { data: recs, error: recErr } = await supabase
    .from('bookkeeping_dividend_recipients')
    .insert(recipientRows)
    .select('id, name, shareholding_pct, amount');
  if (recErr) {
    await supabase.from('bookkeeping_dividends').delete().eq('id', dividend.id);
    return NextResponse.json({ error: recErr.message }, { status: 500 });
  }

  return NextResponse.json({ dividend: { ...dividend, recipients: recs ?? [] } }, { status: 201 });
}
