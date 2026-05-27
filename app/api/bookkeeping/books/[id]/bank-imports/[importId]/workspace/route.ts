import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/bank-imports/[importId]/workspace ──────
// One-shot fetch for the period-first Reconcile workspace.
//
// We deliberately keep PostgREST's job simple:
//   • Header + firm check done in two separate queries (the embedded
//     book-join form was unreliable in practice — bookkeeping_books has
//     several FKs in this module and the auto-relationship picker
//     occasionally returns ambiguous-relationship errors that bubble up
//     as 400s).
//   • Splits are pulled with their parent transaction embedded but the
//     date-range filter is applied in JS, not as `transaction.date.lte=…`
//     on the embedded relation — that filter form is brittle and was the
//     suspect cause of the empty-payload "Loading…" hang the user hit.
//
// Returns:
//   • The rec header (status, opening/closing, period, completed_*, notes)
//   • cleared_splits  — every split with cleared_in_rec_id = importId
//   • open_splits     — splits on the account, uncleared, dated ≤ period_end
//   • lines           — bookkeeping_bank_lines belonging to this rec
//   • totals          — { opening, cleared_total, closing, gap }

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // ── Header (no embed — keep the row trivial for PostgREST) ─────────────
  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_bank_imports')
    .select(`
      id, book_id, account_id, file_name, display_label,
      period_start, period_end, opening_balance, closing_balance,
      status, notes, uploaded_at, uploaded_by,
      reconciled_at, reconciled_by, completed_at, completed_by
    `)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (impErr || !imp) {
    return NextResponse.json({ error: impErr?.message ?? 'Reconciliation not found' }, { status: 404 });
  }

  // ── Belt-and-braces firm gate (RLS does this too) ──────────────────────
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id')
    .eq('id', imp.book_id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const periodEnd = imp.period_end ?? null;

  // ── Shared SplitRow shape used by both queries below ───────────────────
  // `vat_total` is included on the embedded transaction so the client can
  // compute net = abs(gross) − vat_total for display in the manual entry
  // sheet (and the workspace's own "what's the analysis side?" hover later).
  type SplitRow = {
    id: string;
    transaction_id: string;
    account_id: string;
    debit: number;
    credit: number;
    entry_details: string | null;
    notes: string | null;
    cleared_in_rec_id: string | null;
    cleared_at: string | null;
    transaction:
      | { id: string; type: string; ref_no: string; date: string; details: string | null; payee_text: string | null; vat_total: number }
      | Array<{ id: string; type: string; ref_no: string; date: string; details: string | null; payee_text: string | null; vat_total: number }>;
  };

  // ── Cleared splits ─────────────────────────────────────────────────────
  // Cleared = pinned to this rec via cleared_in_rec_id. We don't date-
  // filter cleared splits — once cleared they belong to the rec regardless
  // of date (e.g. brought-forward items the user ticked off). Paginated
  // for the same reason as openAll below.
  const CLEAR_PAGE = 1000;
  const clearedHere: SplitRow[] = [];
  for (let from = 0; ; from += CLEAR_PAGE) {
    const { data: batch, error: clearedErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        id, transaction_id, account_id, debit, credit, entry_details, notes,
        cleared_in_rec_id, cleared_at,
        transaction:bookkeeping_transactions!inner(id, type, ref_no, date, details, payee_text, vat_total)
      `)
      .eq('account_id', imp.account_id)
      .eq('cleared_in_rec_id', params.importId)
      .range(from, from + CLEAR_PAGE - 1);
    if (clearedErr) {
      return NextResponse.json({ error: clearedErr.message }, { status: 500 });
    }
    const rows = (batch ?? []) as unknown as SplitRow[];
    clearedHere.push(...rows);
    if (rows.length < CLEAR_PAGE) break;
  }

  // ── Open (uncleared) splits on this account ────────────────────────────
  // We pull every uncleared split on the account and apply the
  // "dated ≤ period_end" filter client-side. Safer than asking PostgREST
  // to filter on an embedded relation's column.
  //
  // Pagination matters: a busy bank account on its first rec has every
  // transaction ever posted sitting here as "uncleared". With Supabase's
  // 1000-row default cap, a single .select() silently truncates and the
  // user sees an incomplete ledger (this is exactly how the "no REC
  // entries showing up" bug landed). Page through with .range() until the
  // last batch is short.
  const PAGE = 1000;
  const openAll: SplitRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: batch, error: openErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        id, transaction_id, account_id, debit, credit, entry_details, notes,
        cleared_in_rec_id, cleared_at,
        transaction:bookkeeping_transactions!inner(id, type, ref_no, date, details, payee_text, vat_total)
      `)
      .eq('account_id', imp.account_id)
      .is('cleared_in_rec_id', null)
      .range(from, from + PAGE - 1);
    if (openErr) {
      return NextResponse.json({ error: openErr.message }, { status: 500 });
    }
    const rows = (batch ?? []) as unknown as SplitRow[];
    openAll.push(...rows);
    if (rows.length < PAGE) break;
  }
  const openInScope: SplitRow[] = !periodEnd
    ? (openAll ?? [])
    : (openAll ?? []).filter(r => {
        // PostgREST returns the embedded relation as an object (or array
        // depending on cardinality). Always treat it defensively.
        const txn = Array.isArray(r.transaction) ? r.transaction[0] : r.transaction;
        return !!txn && typeof txn.date === 'string' && txn.date <= periodEnd;
      });

  // Sort by date so the UI doesn't have to.
  const byDate = (a: SplitRow, b: SplitRow) => {
    const at = Array.isArray(a.transaction) ? a.transaction[0]?.date ?? '' : a.transaction?.date ?? '';
    const bt = Array.isArray(b.transaction) ? b.transaction[0]?.date ?? '' : b.transaction?.date ?? '';
    return at.localeCompare(bt);
  };
  openInScope.sort(byDate);
  const clearedSorted = (clearedHere ?? []).slice().sort(byDate);

  // ── Bank lines on this rec ─────────────────────────────────────────────
  // Paginated — a year-long CSV can carry thousands of lines.
  const LINE_PAGE = 1000;
  const lines: unknown[] = [];
  for (let from = 0; ; from += LINE_PAGE) {
    const { data: batch } = await supabase
      .from('bookkeeping_bank_lines')
      .select(`
        id, line_no, date, description, amount, statement_balance,
        matched_split_id, reconciled_at, notes
      `)
      .eq('import_id', params.importId)
      .order('line_no', { ascending: true })
      .range(from, from + LINE_PAGE - 1);
    const rows = (batch ?? []) as unknown[];
    lines.push(...rows);
    if (rows.length < LINE_PAGE) break;
  }

  // ── Analysis-side account lookup ───────────────────────────────────────
  // For every bank-side split we return, the client wants to know which
  // analysis account the OTHER leg of the transaction landed on (so the
  // manual entry sheet can show ledger/analysis as context, helping the
  // user pick the same code for a similar entry).
  //
  // We fetch every NON-bank, NON-VAT split for the transactions we've
  // already pulled, then map transaction_id → analysis info. Chunked .in()
  // to stay under the edge URL cap.
  const allTxnIds = Array.from(new Set(
    [...clearedSorted, ...openInScope].map(s => s.transaction_id),
  ));
  type AnalysisInfo = { account_name: string; ledger: string | null };
  const analysisByTxn = new Map<string, AnalysisInfo>();
  if (allTxnIds.length > 0) {
    const IN_CHUNK = 200;
    type OtherSplit = {
      transaction_id: string;
      account_id: string;
      account: { name: string; ledger: string | null } | { name: string; ledger: string | null }[] | null;
    };
    for (let i = 0; i < allTxnIds.length; i += IN_CHUNK) {
      const chunk = allTxnIds.slice(i, i + IN_CHUNK);
      const { data: others } = await supabase
        .from('bookkeeping_transaction_splits')
        .select(`
          transaction_id, account_id,
          account:bookkeeping_accounts!inner(name, ledger)
        `)
        .in('transaction_id', chunk)
        .neq('account_id', imp.account_id);
      for (const o of ((others ?? []) as unknown as OtherSplit[])) {
        const acc = Array.isArray(o.account) ? o.account[0] : o.account;
        if (!acc) continue;
        // Skip VAT routing splits — they're noise from the analysis-side
        // perspective. The "real" analysis account is the expense/income one.
        if (/VAT\s*(Input|Output)/i.test(acc.name)) continue;
        // First non-VAT, non-bank split per transaction wins. For typical
        // PAY/REC there's only one. For multi-leg journals this picks the
        // first which is reasonable as a "main" hint.
        if (analysisByTxn.has(o.transaction_id)) continue;
        analysisByTxn.set(o.transaction_id, {
          account_name: acc.name,
          ledger:       acc.ledger,
        });
      }
    }
  }

  /** Annotate each split with its sibling analysis info + the transaction
   *  vat_total so the client doesn't have to repeat the join. */
  const annotate = (s: SplitRow) => {
    const info = analysisByTxn.get(s.transaction_id);
    return {
      ...s,
      analysis_account_name: info?.account_name ?? null,
      analysis_ledger:       info?.ledger ?? null,
    };
  };
  const clearedAnnotated = clearedSorted.map(annotate);
  const openAnnotated    = openInScope.map(annotate);

  // ── Computed totals ────────────────────────────────────────────────────
  const opening = Number(imp.opening_balance ?? 0);
  const clearedTotal = clearedSorted.reduce(
    (s, r) => s + Number(r.debit) - Number(r.credit), 0,
  );
  const closing = imp.closing_balance != null ? Number(imp.closing_balance) : null;
  const gap = closing != null
    ? Math.round((closing - (opening + clearedTotal)) * 100) / 100
    : null;

  return NextResponse.json({
    import: imp,
    cleared_splits: clearedAnnotated,
    open_splits:    openAnnotated,
    lines,
    totals: {
      opening,
      cleared_total: Math.round(clearedTotal * 100) / 100,
      closing,
      gap,
    },
  });
}
