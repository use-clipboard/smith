import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/bank-imports/start-period ──────────────
// Period-first entry point for the new rec model.  The user picks a date
// range (defaulted to the active year/period from the header) and we create
// an in-progress rec, computing the opening balance carry-forward and
// returning a list of uncleared splits that fall BEFORE the period start
// (the "brought forward" list — usually old un-presented cheques).
//
// One active rec per (account, status in pending/in_progress) is enforced
// at both the API layer (here) and the DB layer (partial unique index).
// If an active rec already exists, we return 409 with its id so the UI can
// route the user into it instead of silently failing.

const PostBody = z.object({
  account_id:    z.string().uuid(),
  period_start:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Optional label like "Nov 2026 statement". Auto-generated if omitted. */
  display_label: z.string().max(80).optional(),
  /** Only honoured when this is the first rec on the account (no prior
   *  reconciled rec to carry from). Lets the user type their bank's true
   *  opening balance on the day the bookkeeping starts. */
  opening_balance_override: z.number().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PostBody>;
  try { body = PostBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (body.period_end < body.period_start) {
    return NextResponse.json({ error: 'Period end is before the start.' }, { status: 400 });
  }

  const supabase = createClient();

  // ── Firm + book gate ────────────────────────────────────────────────────
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Account gate ────────────────────────────────────────────────────────
  const { data: account } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type, book_id')
    .eq('id', body.account_id)
    .eq('book_id', params.id)
    .single();
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  // ── Reject if an active rec already exists on this account ──────────────
  // Friendlier than letting the partial unique index throw 23505. We return
  // the active rec's id so the UI can offer "Open existing" / "Abandon and
  // start fresh" instead of just an error.
  const { data: existing } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id, period_start, period_end, status')
    .eq('account_id', body.account_id)
    .in('status', ['pending', 'in_progress'])
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      error: 'An active reconciliation already exists for this account.',
      existing_rec: existing,
    }, { status: 409 });
  }

  // ── Carry-forward opening balance ───────────────────────────────────────
  // Take the most recent RECONCILED rec on this account whose period_end is
  // strictly before the new period_start. Its closing_balance is the
  // bank-statement balance we are starting from.
  const { data: prior } = await supabase
    .from('bookkeeping_bank_imports')
    .select('id, period_end, closing_balance')
    .eq('account_id', body.account_id)
    .eq('status', 'reconciled')
    .lt('period_end', body.period_start)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  const carriedFromRecId = prior?.id ?? null;
  const carriedOpening   = prior?.closing_balance != null ? Number(prior.closing_balance) : null;

  // First-ever rec on this account: honour the override, default 0.
  const openingBalance = carriedOpening != null
    ? carriedOpening
    : (body.opening_balance_override ?? 0);

  // ── Brought-forward uncleared items ─────────────────────────────────────
  // Splits on this account, dated BEFORE the period starts, that haven't
  // been cleared in any rec yet. We return their ids/refs/dates/amounts so
  // the workspace can list them under a "Brought forward" header — the
  // user usually wants to tick these off too if they finally hit this
  // statement.
  //
  // Pagination + client-side date filter: PostgREST's date filter on an
  // embedded relation (`transaction.date.lt=…`) is brittle, and a first-
  // ever rec on a busy account easily blows past 1000 uncleared splits.
  // Pull all uncleared splits on the account, then filter to "dated before
  // period_start" in JS.
  const BF_PAGE = 1000;
  type BfSplitRow = {
    id: string; transaction_id: string; debit: number; credit: number;
    transaction:
      | { id: string; ref_no: string; date: string; details: string | null; type: string }
      | Array<{ id: string; ref_no: string; date: string; details: string | null; type: string }>;
  };
  const allUncleared: BfSplitRow[] = [];
  for (let from = 0; ; from += BF_PAGE) {
    const { data: batch } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        id, transaction_id, debit, credit,
        transaction:bookkeeping_transactions!inner(id, ref_no, date, details, type)
      `)
      .eq('account_id', body.account_id)
      .is('cleared_in_rec_id', null)
      .range(from, from + BF_PAGE - 1);
    const rows = (batch ?? []) as unknown as BfSplitRow[];
    allUncleared.push(...rows);
    if (rows.length < BF_PAGE) break;
  }
  const bfSplits = allUncleared
    .filter(r => {
      const txn = Array.isArray(r.transaction) ? r.transaction[0] : r.transaction;
      return !!txn && typeof txn.date === 'string' && txn.date < body.period_start;
    })
    .sort((a, b) => {
      const da = (Array.isArray(a.transaction) ? a.transaction[0]?.date : a.transaction?.date) ?? '';
      const db = (Array.isArray(b.transaction) ? b.transaction[0]?.date : b.transaction?.date) ?? '';
      return da.localeCompare(db);
    });

  // ── Auto-label if the user didn't supply one ───────────────────────────
  const label = body.display_label ?? autoLabel(body.period_start, body.period_end);

  // ── Insert the rec ──────────────────────────────────────────────────────
  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_bank_imports')
    .insert({
      book_id: params.id,
      account_id: body.account_id,
      file_name: label,            // legacy column; kept populated for compat
      display_label: label,
      period_start: body.period_start,
      period_end:   body.period_end,
      opening_balance: openingBalance,
      closing_balance: null,       // user supplies this (or CSV/PDF lifts it)
      status: 'pending',
      uploaded_by: ctx.userId,
    })
    .select('*')
    .single();
  if (impErr || !imp) {
    return NextResponse.json({ error: impErr?.message ?? 'Failed to start reconciliation' }, { status: 500 });
  }

  return NextResponse.json({
    import: imp,
    opening_balance: openingBalance,
    opening_source: carriedFromRecId ? 'carried_forward' : 'first_rec',
    carried_from_rec_id: carriedFromRecId,
    brought_forward_splits: bfSplits ?? [],
  });
}

function autoLabel(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
  };
  return `Rec ${fmt(start)} → ${fmt(end)}`;
}
