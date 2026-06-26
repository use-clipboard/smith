import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeAllocation, type AllocationPartner } from '@/lib/bookkeeping/profitAllocation';

type DB = ReturnType<typeof createClient>;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Prepared {
  book: { id: string; admin_locked: boolean; current_fy_id: string | null };
  retained: { id: string; name: string };
  partners: AllocationPartner[];
  accountNames: Map<string, string>;
  profitToAllocate: number;
  defaultDate: string;
}

async function prepare(supabase: DB, bookId: string, firmId: string): Promise<Prepared | { error: string; status: number }> {
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, admin_locked, current_fy_id')
    .eq('id', bookId).eq('firm_id', firmId).maybeSingle();
  if (!book) return { error: 'Not found', status: 404 };

  // "Profit to be allocated" = the retained_earnings-tagged equity account.
  const { data: accts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, system_role')
    .eq('book_id', bookId);
  const retained = (accts ?? []).find(a => a.system_role === 'retained_earnings');
  if (!retained) {
    return { error: 'No "Profit to be allocated" account found on this book.', status: 400 };
  }
  const accountNames = new Map((accts ?? []).map(a => [a.id as string, a.name as string]));

  // Balance on that account (credit − debit; positive = profit).
  let debit = 0, credit = 0, from = 0;
  for (;;) {
    const { data } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('debit, credit')
      .eq('account_id', retained.id)
      .range(from, from + 999);
    const rows = data ?? [];
    for (const r of rows) { debit += Number(r.debit); credit += Number(r.credit); }
    if (rows.length < 1000) break;
    from += 1000;
  }
  const profitToAllocate = round2(credit - debit);

  // Partner participants.
  const { data: parts } = await supabase
    .from('bookkeeping_book_participants')
    .select('id, name, profit_share_pct, capital_account_id')
    .eq('book_id', bookId)
    .eq('role', 'partner');
  const partners: AllocationPartner[] = (parts ?? []).map(p => ({
    id: p.id as string,
    name: p.name as string,
    pct: Number(p.profit_share_pct ?? 0),
    accountId: (p.capital_account_id as string | null) ?? null,
  }));

  // Default date — the current FY end if known, else today.
  let defaultDate = new Date().toISOString().slice(0, 10);
  if (book.current_fy_id) {
    const { data: fy } = await supabase
      .from('bookkeeping_financial_years')
      .select('end_date').eq('id', book.current_fy_id).maybeSingle();
    if (fy?.end_date) defaultDate = fy.end_date as string;
  }

  return { book, retained: { id: retained.id, name: retained.name }, partners, accountNames, profitToAllocate, defaultDate };
}

// GET → preview the allocation
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const prep = await prepare(supabase, params.id, ctx.firmId);
  if ('error' in prep) return NextResponse.json({ error: prep.error }, { status: prep.status });

  const result = computeAllocation(prep.profitToAllocate, prep.partners);
  return NextResponse.json({
    retained_account: prep.retained,
    profit_to_allocate: result.profitToAllocate,
    total_pct: result.totalPct,
    ok: result.ok,
    warnings: result.warnings,
    residual_assigned_to: result.residualAssignedTo,
    default_date: prep.defaultDate,
    lines: result.lines.map(l => ({ ...l, account_name: prep.accountNames.get(l.accountId) ?? l.accountId })),
  });
}

// POST → post the allocation journal
const Body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json().catch(() => ({}))); }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }

  const supabase = createClient();
  const prep = await prepare(supabase, params.id, ctx.firmId);
  if ('error' in prep) return NextResponse.json({ error: prep.error }, { status: prep.status });

  if (prep.book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const result = computeAllocation(prep.profitToAllocate, prep.partners);
  if (!result.ok) {
    return NextResponse.json({ error: result.warnings[0] ?? 'Cannot allocate.' }, { status: 400 });
  }

  const date = body.date ?? prep.defaultDate;
  const profit = result.profitToAllocate;
  const total = round2(Math.abs(profit));
  const details = `Profit allocation — ${prep.retained.name}`;

  // Allocate the journal ref.
  const { data: seq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'JRN' });
  if (seqErr || typeof seq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `JRN ${String(seq).padStart(6, '0')}`;

  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id, type: 'JRN', ref_no: refNo, ref_seq: seq, date,
      payee_text: null, details, total, vat_total: 0,
      status: 'posted', created_by: ctx.userId, posted_at: new Date().toISOString(),
    })
    .select('id').single();
  if (txnErr || !txn) return NextResponse.json({ error: txnErr?.message ?? 'Insert failed' }, { status: 500 });

  // DR "Profit to be allocated" (clear it), CR each partner's capital account.
  // Signs flip for a loss.
  const splits: Array<{ transaction_id: string; line_no: number; account_id: string; debit: number; credit: number; entry_details: string }> = [];
  splits.push({
    transaction_id: txn.id, line_no: 1, account_id: prep.retained.id,
    debit: profit >= 0 ? total : 0, credit: profit < 0 ? total : 0,
    entry_details: details,
  });
  result.lines.forEach((l, i) => {
    splits.push({
      transaction_id: txn.id, line_no: i + 2, account_id: l.accountId,
      debit: l.share < 0 ? round2(-l.share) : 0,
      credit: l.share >= 0 ? round2(l.share) : 0,
      entry_details: `Profit share ${l.pct}% — ${l.name}`,
    });
  });

  const { error: splitsErr } = await supabase.from('bookkeeping_transaction_splits').insert(splits);
  if (splitsErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ref_no: refNo, transaction_id: txn.id });
}
