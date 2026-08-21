import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/accounts/[accountId]/entries ─────────────
// All splits that touch this account, returned as one row per split with the
// owning transaction's header data + the split's match status.
//
// Query params:
//   ?date_from=YYYY-MM-DD
//   ?date_to=YYYY-MM-DD
//   ?status=open|all   (default: all)  — open = unmatched splits only
//   ?include_running=true (default true) — compute a running balance column
//
// Response shape:
//   {
//     account: { id, name, ledger, account_type, opening_balance, closing_balance },
//     entries: [
//       {
//         split_id, transaction_id, ref_no, date, details, due_date,
//         debit, credit, running_balance,
//         match_id, match_status     // null when unmatched
//       }
//     ]
//   }

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; accountId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo   = url.searchParams.get('date_to');
  const statusFilter = url.searchParams.get('status') ?? 'all';

  const supabase = createClient();
  // Confirm book + account are in this firm.
  //
  // We avoid the convenience embed `book:bookkeeping_books!inner(...)` here
  // because `bookkeeping_books` now has TWO foreign keys back to accounts
  // (`book_id` and `retained_earnings_account_id`), and PostgREST refuses
  // to auto-pick a relationship when it's ambiguous — the embed silently
  // returns nothing and the !inner join drops the row. Two simple queries
  // are clearer + safer.
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: account, error: accErr } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type')
    .eq('id', params.accountId)
    .eq('book_id', params.id)
    .single();
  if (accErr || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  // Pull every split touching this account, joined to its parent transaction
  // and (optionally) its match. Need everything up to date_to so we can
  // compute the opening balance from history prior to date_from.
  // PostgREST returns the embedded `match_line` as an array because the FK
  // direction is many-to-one (many lines could in theory point at this split,
  // even though our UNIQUE constraint guarantees at most one). The nested
  // `match` join is many-to-one from match_lines to matches, so that one
  // comes back as a single object.
  type SplitRow = {
    id: string;
    transaction_id: string;
    debit: number;
    credit: number;
    entry_details: string | null;
    /** Period-first bank-rec link. When non-null, this split has been
     *  ticked off in the named reconciliation. The embedded `rec` lets us
     *  surface the rec's lifecycle status to the UI so a "reconciled"
     *  split shows the green tick + falls out of the Open filter. */
    cleared_in_rec_id: string | null;
    transaction: {
      id: string;
      ref_no: string;
      date: string;
      details: string | null;
      book_id: string;
      source_doc_url: string | null;
      source_doc_name: string | null;
    } | null;
    match_line: Array<{
      match_id: string;
      match: { id: string; status: 'full' | 'partial' | 'write_off' } | null;
    }>;
    rec:
      | { status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned'; display_label: string | null; file_name: string | null }
      | Array<{ status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned'; display_label: string | null; file_name: string | null }>
      | null;
  };

  // The match join goes through bookkeeping_match_lines → bookkeeping_matches.
  // A split can only be in at most one match (UNIQUE constraint on match_lines).
  //
  // Pagination: Supabase caps a single SELECT at 1000 rows by default. Busy
  // bank accounts blow straight past that — a typical SME has 1500-3000
  // transactions per year on the current account.  When we hit the cap the
  // truncated 646th-onward rows are gone with no error, and the user sees a
  // ledger view that's missing whole transaction types.  Page through with
  // .range() until we've seen every row.
  const PAGE = 1000;
  const rows: SplitRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        id, transaction_id, debit, credit, entry_details, cleared_in_rec_id,
        transaction:bookkeeping_transactions!inner(id, ref_no, date, details, book_id, source_doc_url, source_doc_name),
        match_line:bookkeeping_match_lines(match_id, match:bookkeeping_matches(id, status)),
        rec:bookkeeping_bank_imports!bookkeeping_transaction_splits_cleared_in_rec_id_fkey(status, display_label, file_name)
      `)
      .eq('account_id', params.accountId)
      .eq('transaction.book_id', params.id)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as unknown as SplitRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Sort chronologically client-side. We asked PostgREST to order by the
  // embedded transaction's date but `referencedTable` ordering only sorts
  // WITHIN the embedded join — across the parent splits the rows come back
  // in essentially insertion order, which scrambles the chronology when
  // accounts have been touched out of date order (e.g. invoices posted
  // months apart). Sorting here also keeps the running-balance walk below
  // accurate; without this, the running totals were nonsense too.
  rows.sort((a, b) => {
    const da = a.transaction?.date ?? '';
    const db = b.transaction?.date ?? '';
    if (da !== db) return da < db ? -1 : 1;
    // Same date → fall back to ref_no so the order is stable across reloads.
    const ra = a.transaction?.ref_no ?? '';
    const rb = b.transaction?.ref_no ?? '';
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });

  // ── Sibling-fallback for entry_details ─────────────────────────────────────
  // `entry_details` is captured by the input sheets on the "analysis" leg of
  // a transaction only — e.g. "Lamp" lives on the Expenses split of a PIN,
  // not on the matching Suppliers credit. From the user's perspective the
  // note describes the WHOLE transaction, so we surface it on every account
  // ledger that touches it: when a row's own entry_details is null we look
  // up any sibling split on the same transaction that does have a note.
  const txnIds = Array.from(new Set(rows.map(r => r.transaction_id))).filter(Boolean);
  const txnEntryDetails = new Map<string, string>();
  if (txnIds.length > 0) {
    // Chunk the .in() — at ~38 chars/UUID a single `transaction_id=in.(…)`
    // clause for 1000+ txns blows past the 8 KB URL-length cap edge proxies
    // enforce in front of Supabase. 200 IDs per chunk = ~7.4 KB, safe.
    const IN_CHUNK = 200;
    for (let i = 0; i < txnIds.length; i += IN_CHUNK) {
      const chunk = txnIds.slice(i, i + IN_CHUNK);
      const { data: siblings } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('transaction_id, entry_details')
        .in('transaction_id', chunk)
        .not('entry_details', 'is', null);
      for (const s of (siblings ?? []) as { transaction_id: string; entry_details: string | null }[]) {
        if (!s.entry_details) continue;
        // First non-null sibling wins. Multiple notes on different legs of one
        // transaction are rare; if it happens, the user can still see them all
        // via the Edit modal.
        if (!txnEntryDetails.has(s.transaction_id)) {
          txnEntryDetails.set(s.transaction_id, s.entry_details);
        }
      }
    }
  }

  // Walk chronologically, computing the running balance and bucketing into
  // "before from", "in period", "after to". For first version we don't have
  // a due_date column — return null and we'll add it later if needed.
  type Entry = {
    split_id: string;
    transaction_id: string;
    ref_no: string;
    date: string;
    details: string | null;
    /** Per-split note ("Lamp", "Q3 rent share", …). Lives on the split row
     *  rather than the transaction header so multi-line transactions can
     *  caption each leg differently. */
    entry_details: string | null;
    due_date: string | null;
    debit: number;
    credit: number;
    running_balance: number;
    match_id: string | null;
    match_status: 'full' | 'partial' | 'write_off' | null;
    /** Period-first bank-rec link. Non-null when this split has been
     *  ticked off in a rec. */
    cleared_in_rec_id: string | null;
    /** Lifecycle status of the rec this split is cleared in. The UI
     *  treats `reconciled` as a fully-allocated tick; `in_progress` /
     *  `pending` show a softer indicator since the work isn't final. */
    bank_rec_status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned' | null;
    /** Human label for the rec — used in the tick's tooltip. */
    bank_rec_label: string | null;
    /** Year-end close on a P&L account: a period BOUNDARY, not a movement.
     *  Carries no amounts and doesn't move the running balance — the UI draws
     *  it as a rule rather than a ledger row. See the note below. */
    year_end_marker?: boolean;
    /** Linked source document (Google Drive via Capture/Vault), when set on
     *  the transaction — surfaces the paperclip icon in the ledger row. */
    source_doc_url?: string | null;
    source_doc_name?: string | null;
  };

  // ── How the year-end close behaves in a ledger ──────────────────────────────
  // On a P&L account the YET is mechanical: its only job is to flatten the
  // nominal so the next year starts clean. Treating it as a movement makes a
  // year that genuinely traded £4,605.80 show a closing balance of 0.00 —
  // arithmetically "the balance after closing", but not the number anyone
  // opening the Sales ledger for 2024 wants to see.
  //
  // So on income/expense accounts the close RESETS the running balance instead
  // of moving it, and is emitted as a boundary marker carrying no amounts.
  // That gives the right answer at both ends:
  //   • viewing the closed year   → closing balance is the year's trading
  //   • viewing the year after    → opening balance is nil, because the reset
  //                                 happened while we walked past it
  //   • viewing all entries       → each year's activity reads on its own,
  //                                 rather than accumulating across years
  //
  // On balance-sheet accounts the YET is a real entry — the credit into
  // reserves IS the movement — so it's left completely alone.
  const isPlAccount = account.account_type === 'income' || account.account_type === 'expense';
  const isYearEndRef = (refNo: string | null | undefined) =>
    (refNo ?? '').trim().toUpperCase().startsWith('YET');

  let runningBalance = 0;
  let openingBalance = 0;
  // Null until an in-period row sets it, so a period containing no movement
  // (or only the year-end marker) reports its opening balance as the closing
  // one rather than a misleading zero.
  let closingBalance: number | null = null;
  const entries: Entry[] = [];

  for (const r of rows) {
    if (!r.transaction) continue;
    const debit  = Number(r.debit);
    const credit = Number(r.credit);
    const plYearEnd = isPlAccount && isYearEndRef(r.transaction.ref_no);

    if (plYearEnd) {
      runningBalance = 0;
      if (dateFrom && r.transaction.date < dateFrom) { openingBalance = 0; continue; }
      if (dateTo && r.transaction.date > dateTo) continue;
      entries.push({
        split_id: r.id,
        transaction_id: r.transaction.id,
        ref_no: r.transaction.ref_no,
        date: r.transaction.date,
        details: r.transaction.details,
        entry_details: null,
        due_date: null,
        debit: 0,
        credit: 0,
        running_balance: 0,
        match_id: null,
        match_status: null,
        cleared_in_rec_id: null,
        bank_rec_status: null,
        bank_rec_label: null,
        year_end_marker: true,
      });
      // Deliberately does NOT touch closingBalance — the year's trading is the
      // figure to carry forward on screen, not the post-close nil.
      continue;
    }

    runningBalance = +(runningBalance + debit - credit).toFixed(2);

    if (dateFrom && r.transaction.date < dateFrom) {
      openingBalance = runningBalance;
      continue;
    }
    if (dateTo && r.transaction.date > dateTo) {
      continue;
    }

    const matchLine = r.match_line && r.match_line.length > 0 ? r.match_line[0] : null;
    // PostgREST cardinality: the embed comes back as an object when the FK
    // is one-to-one in practice, but can occasionally arrive wrapped in an
    // array depending on hint shape. Normalise both.
    const recRaw = r.rec;
    const rec = Array.isArray(recRaw) ? (recRaw[0] ?? null) : recRaw;
    entries.push({
      split_id: r.id,
      transaction_id: r.transaction.id,
      ref_no: r.transaction.ref_no,
      date: r.transaction.date,
      details: r.transaction.details,
      entry_details: r.entry_details ?? txnEntryDetails.get(r.transaction_id) ?? null,
      due_date: null,
      debit,
      credit,
      running_balance: runningBalance,
      match_id: matchLine?.match_id ?? null,
      match_status: matchLine?.match?.status ?? null,
      cleared_in_rec_id: r.cleared_in_rec_id ?? null,
      bank_rec_status: rec?.status ?? null,
      bank_rec_label: rec?.display_label ?? rec?.file_name ?? null,
      source_doc_url: r.transaction.source_doc_url ?? null,
      source_doc_name: r.transaction.source_doc_name ?? null,
    });
    closingBalance = runningBalance;
  }

  // Apply status filter. A split is "open" only when it has neither been
  // included in a match nor ticked off in a bank rec — the two clearing
  // mechanisms are independent (legacy match-based vs period-first rec).
  // Without the cleared_in_rec_id check, splits that have been reconciled
  // via a bank import would keep appearing in the Open tab and look unmatched.
  // The year-end marker isn't an open item — it's a rule drawn between years —
  // so it never survives the Open filter.
  const filtered = statusFilter === 'open'
    ? entries.filter(e => !e.year_end_marker && e.match_id === null && e.cleared_in_rec_id === null)
    : entries;

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      ledger: account.ledger,
      account_type: account.account_type,
      opening_balance: openingBalance,
      closing_balance: closingBalance ?? openingBalance,
    },
    entries: filtered,
  });
}
