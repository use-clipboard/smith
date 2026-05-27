import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { parseBankCsv } from '@/lib/bookkeeping/bankCsvParser';

// ── /api/bookkeeping/books/[id]/bank-imports ────────────────────────────────
// GET  → list every import for the book (newest first), optionally filtered
//        by account.
// POST → parse a CSV upload, create a bookkeeping_bank_imports row + one
//        bookkeeping_bank_lines row per parsed line.
//
// Per Bank Rec design decision: CSV-only for v1 (most UK bank exports). OFX
// and PDF are deliberately deferred — adding them later is a parser-layer
// change, the API & UI don't need to know.

const SELECT_IMPORT = `
  id, book_id, account_id, file_name, display_label,
  period_start, period_end, opening_balance, closing_balance,
  status, uploaded_by, uploaded_at, reconciled_at, reconciled_by
`;

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const accountId = url.searchParams.get('account_id');
  const statusFilter = url.searchParams.get('status'); // optional

  const supabase = createClient();
  // Belt-and-braces firm gate on top of RLS
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let q = supabase
    .from('bookkeeping_bank_imports')
    .select(SELECT_IMPORT)
    .eq('book_id', params.id)
    .order('uploaded_at', { ascending: false });

  if (accountId) q = q.eq('account_id', accountId);
  if (statusFilter) q = q.eq('status', statusFilter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ imports: data ?? [] });
}

// ── POST ────────────────────────────────────────────────────────────────────
// Accepts JSON: { account_id, file_name, display_label?, csv: string }
// We pass the file contents in the body rather than multipart upload — the
// parser is pure-text and this keeps the route handler simple. The dashboard's
// "Bank to CSV" tool already uses the same pattern.
const PostBody = z.object({
  account_id: z.string().uuid(),
  file_name:  z.string().min(1).max(200),
  display_label: z.string().max(80).optional(),
  csv: z.string().min(1).max(10_000_000), // ~10MB cap — plenty for a single statement
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PostBody>;
  try { body = PostBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // 1) Confirm the book and target account belong to this firm. Two queries
  //    rather than an embed because `bookkeeping_books` now has two FKs back
  //    to accounts (book_id + retained_earnings_account_id), which makes
  //    PostgREST's auto-relationship picker bail.
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
    .eq('id', body.account_id)
    .eq('book_id', params.id)
    .single();
  if (accErr || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  // 2) Soft check the account is one we'd actually reconcile against. We
  //    don't hard-fail here (the user might keep cash-equivalent accounts
  //    under a custom ledger), but we warn in the response so the UI can
  //    show a nudge.
  const isBankish = (account.ledger ?? '').toLowerCase().includes('bank')
    || (account.account_type ?? '').toLowerCase().includes('bank')
    || (account.name ?? '').toLowerCase().includes('cash')
    || (account.name ?? '').toLowerCase().includes('bank');

  // 3) Parse the CSV.
  const parsed = parseBankCsv(body.csv);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 4) Derive period + opening/closing from the parsed lines themselves
  //    (most CSVs don't carry opening/closing balances explicitly).
  const dates = parsed.lines.map(l => l.date).sort();
  const periodStart = dates[0] ?? null;
  const periodEnd   = dates[dates.length - 1] ?? null;

  // Statement-balance based opening/closing if the parser found a balance
  // column. The earliest-date row's balance is treated as the closing
  // balance AT that point, so opening = balance - amount. Best-effort.
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const first = parsed.lines.find(l => l.statementBalance != null);
  const last  = [...parsed.lines].reverse().find(l => l.statementBalance != null);
  if (first?.statementBalance != null) {
    openingBalance = round2(first.statementBalance - first.amount);
  }
  if (last?.statementBalance != null) {
    closingBalance = last.statementBalance;
  }

  // 5) Insert the import row.
  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_bank_imports')
    .insert({
      book_id: params.id,
      account_id: body.account_id,
      file_name: body.file_name,
      display_label: body.display_label ?? null,
      period_start: periodStart,
      period_end:   periodEnd,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      status: 'pending',
      uploaded_by: ctx.userId,
    })
    .select(SELECT_IMPORT)
    .single();
  if (impErr || !imp) return NextResponse.json({ error: impErr?.message ?? 'Failed to create import' }, { status: 500 });

  // 6) Insert lines in bulk.
  const linesPayload = parsed.lines.map((l, idx) => ({
    import_id: imp.id,
    book_id: params.id,
    account_id: body.account_id,
    line_no: idx + 1,
    date: l.date,
    description: l.description,
    amount: l.amount,
    statement_balance: l.statementBalance,
  }));
  const { error: linesErr } = await supabase
    .from('bookkeeping_bank_lines')
    .insert(linesPayload);
  if (linesErr) {
    // Roll back the parent import so we don't leave orphan headers.
    await supabase.from('bookkeeping_bank_imports').delete().eq('id', imp.id);
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  return NextResponse.json({
    import: imp,
    lines_imported: linesPayload.length,
    lines_skipped:  parsed.skipped,
    columns:        parsed.columns,
    warning: isBankish ? null : 'This account doesn’t look like a Bank or Cash account — double-check you’ve picked the right one before reconciling.',
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
