import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── POST /api/bookkeeping/books/[id]/years/[yearId]/close ────────────────────
// Formally close a financial year (VT-style). Posts ONE year-end journal (YET)
// dated on the FY end-date that zeroes every P&L account into the book's
// Retained earnings (equity) account, then marks the FY row closed and pushes
// the book's period-lock date forward to the year-end.
//
// This is the moment the current year's profit is carried into reserves. Until
// a year is closed, the Balance Sheet surfaces the profit as a derived
// "Profit/(loss) for the financial year" line (dynamic carry); once closed, the
// posted YET makes that line net to zero and the reserve holds the figure.
//
// Admin-only. Idempotent guard: refuses if the year is already closed, or if a
// LATER year is already closed (closing out of order would leave a gap).

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ISO yyyy-mm-dd → dd/mm/yyyy (UK display) for journal descriptions. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; yearId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can close a financial year.' }, { status: 403 });
  }

  // Preview mode: compute the exact journal we'd post and return it for the
  // approval lightbox, WITHOUT touching the ledger or allocating a ref.
  const sp = new URL(req.url).searchParams;
  const preview = sp.get('preview') === 'true';
  // No-journal close: for years already closed in previous software (VT etc.),
  // where the profit is already baked into the imported brought-forward
  // reserve. Marks the FY closed (so later years can close in order) WITHOUT
  // posting a duplicate year-end transfer — leaving b/fwd figures untouched.
  const skipJournal = sp.get('journal') === 'skip';

  const supabase = createClient();

  // Book + RE pointer.
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date, retained_earnings_account_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // FY to close.
  const { data: fy, error: fyErr } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, book_id, start_date, end_date, status, closing_journal_id')
    .eq('id', params.yearId)
    .eq('book_id', params.id)
    .single();
  if (fyErr || !fy) return NextResponse.json({ error: 'Financial year not found' }, { status: 404 });

  if (fy.status === 'closed') {
    return NextResponse.json({ error: 'This financial year is already closed.' }, { status: 400 });
  }

  // Don't allow closing out of order — a later year must not already be closed.
  const { data: laterClosed } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, end_date')
    .eq('book_id', params.id)
    .eq('status', 'closed')
    .gt('start_date', fy.start_date)
    .limit(1);
  if (laterClosed && laterClosed.length > 0) {
    return NextResponse.json(
      { error: 'A later financial year is already closed. Reopen it before closing this one — years close in order.' },
      { status: 400 },
    );
  }

  // ── No-journal close (year already closed in previous software) ─────────
  // Mark the FY closed without posting anything. The profit for these years is
  // already in the imported brought-forward reserve, so posting a YET would
  // double-count it. Skipped entirely in preview mode.
  if (!preview && skipJournal) {
    const { data: updated, error: updErr } = await supabase
      .from('bookkeeping_financial_years')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: ctx.userId,
        closing_journal_id: null,
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fy.id)
      .select('id, status')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await maybeAdvanceLock(supabase, book, fy.end_date);
    await supabase.from('bookkeeping_audit').insert({
      book_id: params.id, user_id: ctx.userId, entity_type: 'financial_year',
      entity_id: fy.id, action: 'close',
      diff: {
        kind: 'year_end_close',
        period: { from: fy.start_date, to: fy.end_date },
        net_profit: null,
        journal: null,
        note: 'closed_without_journal',
      },
    });
    return NextResponse.json({ closed: true, skipped: true, net_profit: null, ref_no: null, transaction_id: null, year: updated });
  }

  // ── Resolve the Retained earnings (equity) account ──────────────────────
  // Prefer the book's configured pointer; otherwise fall back to the equity
  // account in the "Profit and loss account" ledger (preferring a
  // "Brought forward" account), and persist that choice for next time.
  const { data: accts, error: acctErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type, archived')
    .eq('book_id', params.id);
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
  const allAccounts = accts ?? [];

  let reAccountId = book.retained_earnings_account_id as string | null;
  if (reAccountId && !allAccounts.some(a => a.id === reAccountId)) reAccountId = null;
  if (!reAccountId) {
    const equity = allAccounts.filter(a => a.account_type === 'equity' && !a.archived);
    const inPlLedger = equity.filter(a => (a.ledger ?? '').toLowerCase() === 'profit and loss account');
    const pool = inPlLedger.length > 0 ? inPlLedger : equity;
    const chosen =
      pool.find(a => a.name.toLowerCase().includes('brought forward')) ?? pool[0] ?? null;
    if (!chosen) {
      return NextResponse.json(
        { error: 'No Retained earnings (equity) account found. Add a "Profit and loss account" equity account, then try again.' },
        { status: 400 },
      );
    }
    reAccountId = chosen.id;
    // Persist so future closes are deterministic. Non-fatal if it fails.
    await supabase
      .from('bookkeeping_books')
      .update({ retained_earnings_account_id: reAccountId })
      .eq('id', params.id);
  }
  // Resolved above (or returned with an error) — safe to treat as non-null.
  const retainedEarningsId = reAccountId as string;

  // ── Aggregate each P&L account's net movement over the FY (exclude YET) ──
  const PAGE_SIZE = 1000;
  type SplitRow = {
    debit: number;
    credit: number;
    account: { id: string; name: string; account_type: string } | null;
  };
  const byAccount = new Map<string, { id: string; name: string; debit: number; credit: number }>();
  let pageStart = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        debit, credit,
        account:bookkeeping_accounts!inner(id, name, account_type, book_id),
        transaction:bookkeeping_transactions!inner(date, type, book_id)
      `)
      .eq('account.book_id', params.id)
      .eq('transaction.book_id', params.id)
      .gte('transaction.date', fy.start_date)
      .lte('transaction.date', fy.end_date)
      .not('transaction.type', 'in', '(YET)')
      .in('account.account_type', ['income', 'expense'])
      .range(pageStart, pageStart + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as SplitRow[];
    for (const r of rows) {
      if (!r.account) continue;
      const a = byAccount.get(r.account.id) ?? { id: r.account.id, name: r.account.name, debit: 0, credit: 0 };
      a.debit = round2(a.debit + Number(r.debit));
      a.credit = round2(a.credit + Number(r.credit));
      byAccount.set(r.account.id, a);
    }
    if (rows.length < PAGE_SIZE) break;
    pageStart += PAGE_SIZE;
  }

  // Closing split per P&L account: post the opposite of its net balance to
  // flatten it to zero. netBalance = debit - credit.
  //   • net debit (expense)  → credit the account by the balance
  //   • net credit (income)  → debit  the account by |balance|
  type Split = { account_id: string; debit: number; credit: number; entry_details: string };
  const splits: Split[] = [];
  let closeDebits = 0;
  let closeCredits = 0;
  const detail = `Year-end close (${fmtDate(fy.start_date)} to ${fmtDate(fy.end_date)})`;
  for (const a of byAccount.values()) {
    const bal = round2(a.debit - a.credit);
    if (Math.abs(bal) < 0.005) continue;
    if (bal > 0) {
      splits.push({ account_id: a.id, debit: 0, credit: bal, entry_details: detail });
      closeCredits = round2(closeCredits + bal);
    } else {
      splits.push({ account_id: a.id, debit: -bal, credit: 0, entry_details: detail });
      closeDebits = round2(closeDebits + -bal);
    }
  }

  // Net profit (positive = profit) = total income credits - total expense
  // debits = closeDebits (income side) - closeCredits (expense side).
  const netProfit = round2(closeDebits - closeCredits);
  const nilProfit = splits.length === 0 || Math.abs(netProfit) < 0.005;
  const reName = allAccounts.find(a => a.id === retainedEarningsId)?.name ?? 'Retained earnings';
  const reLedger = allAccounts.find(a => a.id === retainedEarningsId)?.ledger ?? null;

  // ── Preview: return the proposed journal lines without posting ──────────
  if (preview) {
    // Detect any YET already dated within this FY — a strong signal the year
    // was closed in previous software and an imported year-end transfer is
    // already present, so posting another would double-count.
    const { data: yets } = await supabase
      .from('bookkeeping_transactions')
      .select('id, ref_no, date, total')
      .eq('book_id', params.id)
      .eq('type', 'YET')
      .gte('date', fy.start_date)
      .lte('date', fy.end_date)
      .order('date', { ascending: true });
    const existingYets = (yets ?? []).map(y => ({
      id: y.id, ref_no: y.ref_no, date: y.date, total: Number(y.total),
    }));

    const nameOf = (id: string) => allAccounts.find(a => a.id === id)?.name ?? id;
    const ledgerOf = (id: string) => allAccounts.find(a => a.id === id)?.ledger ?? null;
    const previewSplits = [...splits];
    if (!nilProfit) {
      previewSplits.push({
        account_id: retainedEarningsId,
        debit: netProfit < 0 ? -netProfit : 0,
        credit: netProfit > 0 ? netProfit : 0,
        entry_details: 'Profit/(loss) for the year carried to reserves',
      });
    }
    return NextResponse.json({
      preview: true,
      period: { from: fy.start_date, to: fy.end_date },
      net_profit: netProfit,
      nil_profit: nilProfit,
      existing_yets: existingYets,
      retained_earnings: { id: retainedEarningsId, name: reName, ledger: reLedger },
      total: round2(closeDebits + (netProfit < 0 ? -netProfit : 0)),
      lines: previewSplits.map(s => ({
        account_id: s.account_id,
        account_name: nameOf(s.account_id),
        ledger: ledgerOf(s.account_id),
        debit: s.debit,
        credit: s.credit,
      })),
    });
  }

  if (nilProfit) {
    // Nothing to carry — still mark the year closed (a nil-profit year is a
    // valid close) but without a journal.
    const { data: updated, error: updErr } = await supabase
      .from('bookkeeping_financial_years')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: ctx.userId,
        closing_journal_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fy.id)
      .select('id, status')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await maybeAdvanceLock(supabase, book, fy.end_date);
    await supabase.from('bookkeeping_audit').insert({
      book_id: params.id, user_id: ctx.userId, entity_type: 'financial_year',
      entity_id: fy.id, action: 'close',
      diff: { kind: 'year_end_close', period: { from: fy.start_date, to: fy.end_date }, net_profit: 0, journal: null },
    });
    return NextResponse.json({ closed: true, net_profit: 0, ref_no: null, transaction_id: null, year: updated });
  }

  // Balancing entry to Retained earnings: profit → credit RE; loss → debit RE.
  splits.push({
    account_id: retainedEarningsId,
    debit: netProfit < 0 ? -netProfit : 0,
    credit: netProfit > 0 ? netProfit : 0,
    entry_details: `Profit/(loss) for the year carried to reserves`,
  });

  // ── Allocate the YET ref + post the journal ─────────────────────────────
  const { data: seq, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: params.id, p_type: 'YET' });
  if (seqErr || typeof seq !== 'number') {
    return NextResponse.json({ error: seqErr?.message ?? 'Could not allocate ref' }, { status: 500 });
  }
  const refNo = `YET ${String(seq).padStart(6, '0')}`;
  const total = round2(closeDebits + (netProfit < 0 ? -netProfit : 0)); // total debit side

  const { data: txn, error: txnErr } = await supabase
    .from('bookkeeping_transactions')
    .insert({
      book_id: params.id,
      type: 'YET',
      ref_no: refNo,
      ref_seq: seq,
      date: fy.end_date,
      payee_text: null,
      details: detail,
      total,
      vat_total: 0,
      status: 'posted',
      created_by: ctx.userId,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (txnErr || !txn) {
    return NextResponse.json({ error: txnErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  const { error: splitsErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .insert(splits.map((s, i) => ({
      transaction_id: txn.id,
      line_no: i + 1,
      account_id: s.account_id,
      debit: s.debit,
      credit: s.credit,
      entry_details: s.entry_details,
    })));
  if (splitsErr) {
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: splitsErr.message }, { status: 500 });
  }

  // Mark the FY closed + link the journal.
  const { data: updated, error: updErr } = await supabase
    .from('bookkeeping_financial_years')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: ctx.userId,
      closing_journal_id: txn.id,
      // Clear any prior reopen audit — this is a fresh close.
      reopened_at: null,
      reopened_by: null,
      reopen_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fy.id)
    .select('id, status, closing_journal_id')
    .single();
  if (updErr) {
    // Roll back the journal so we never leave an orphan close.
    await supabase.from('bookkeeping_transactions').delete().eq('id', txn.id);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await maybeAdvanceLock(supabase, book, fy.end_date);

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'financial_year',
    entity_id: fy.id,
    action: 'close',
    diff: {
      kind: 'year_end_close',
      period: { from: fy.start_date, to: fy.end_date },
      net_profit: netProfit,
      ref_no: refNo,
      journal: txn.id,
      retained_earnings_account_id: reAccountId,
    },
  });

  return NextResponse.json({
    closed: true,
    net_profit: netProfit,
    ref_no: refNo,
    transaction_id: txn.id,
    year: updated,
  });
}

// Push the book's period lock forward to the FY end-date (never backwards).
async function maybeAdvanceLock(
  supabase: ReturnType<typeof createClient>,
  book: { id: string; period_lock_date: string | null },
  fyEnd: string,
) {
  if (!book.period_lock_date || fyEnd > book.period_lock_date) {
    await supabase
      .from('bookkeeping_books')
      .update({ period_lock_date: fyEnd })
      .eq('id', book.id);
  }
}
