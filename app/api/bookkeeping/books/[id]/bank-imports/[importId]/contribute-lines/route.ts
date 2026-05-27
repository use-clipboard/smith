import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { parseBankCsv } from '@/lib/bookkeeping/bankCsvParser';
import { detectDuplicateLines } from '@/lib/bookkeeping/dupeDetect';

// ── POST /api/bookkeeping/books/[id]/bank-imports/[importId]/contribute-lines
// Attach statement lines to an EXISTING active rec.
//
// Accepts either:
//   { csv: "<raw csv>" }              ← runs the shared parser server-side
//   { lines: [{date, description, amount, statement_balance?}, ...] }
//
// Why this exists separately from POST /bank-imports:
//   The legacy POST creates a sibling bank_imports row.  Under the new
//   period-first model only ONE active rec per account is allowed (DB-
//   enforced via partial unique index), so contributions have to attach to
//   the rec the user already started.  Also lets multiple uploads
//   (e.g. a CSV + a manual entry) feed the same rec.
//
// Side effects on the parent rec:
//   • period_start widens if any new line predates it
//   • period_end widens if any new line postdates it
//   • closing_balance gets auto-filled from the latest line's
//     statement_balance IF the user hasn't typed one yet
//   • status bumps pending → in_progress on first line landed

const BodySchema = z.object({
  csv:   z.string().min(1).max(10_000_000).optional(),
  lines: z.array(z.object({
    date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().max(500).default(''),
    amount:      z.number(),
    statement_balance: z.number().nullable().optional(),
  })).max(10_000).optional(),
  /** Caller has reviewed suspected duplicates and wants to import them
   *  anyway. When false (the default) and dupes are found we return 409
   *  with the list for the UI to display. */
  confirm_duplicates: z.boolean().optional(),
  /** Indices of parsed lines to skip from the import. Used by the
   *  "Skip flagged, add the rest" path. */
  skip_indices: z.array(z.number().int().min(0)).optional(),
}).refine(b => !!b.csv || (b.lines && b.lines.length > 0), {
  message: 'Provide either `csv` or `lines`',
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; importId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── Firm + rec gate ─────────────────────────────────────────────────────
  const { data: imp } = await supabase
    .from('bookkeeping_bank_imports')
    .select(`
      id, book_id, account_id, status, period_start, period_end, closing_balance,
      book:bookkeeping_books!inner(firm_id)
    `)
    .eq('id', params.importId)
    .eq('book_id', params.id)
    .single();
  if (!imp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // @ts-expect-error — !inner guarantees the join
  if (imp.book.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (imp.status === 'reconciled' || imp.status === 'abandoned') {
    return NextResponse.json({
      error: `Cannot contribute to a ${imp.status} reconciliation. Reopen it first.`,
    }, { status: 409 });
  }

  // ── Resolve the source of new lines ─────────────────────────────────────
  let parsedLines: Array<{ date: string; description: string; amount: number; statementBalance: number | null }>;
  let columns: ReturnType<typeof parseBankCsv> extends { ok: true; columns: infer C } ? C : null = null;
  let skipped: { lineNo: number; reason: string }[] = [];

  if (body.csv) {
    const parsed = parseBankCsv(body.csv);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    parsedLines = parsed.lines;
    columns = parsed.columns;
    skipped = parsed.skipped.map(s => ({ lineNo: s.lineNo, reason: s.reason }));
  } else {
    parsedLines = body.lines!.map(l => ({
      date: l.date,
      description: l.description ?? '',
      amount: round2(l.amount),
      statementBalance: l.statement_balance ?? null,
    }));
  }

  if (parsedLines.length === 0) {
    return NextResponse.json({ error: 'No valid lines to contribute.' }, { status: 400 });
  }

  // ── Apply caller's skip list before anything else ──────────────────────
  // skip_indices refers to positions in the parsedLines array (the order
  // the user sees on screen).  We keep a parallel index mapping so we can
  // still return useful messages downstream.
  const skipSet = new Set(body.skip_indices ?? []);
  const indexedLines = parsedLines
    .map((l, originalIndex) => ({ originalIndex, line: l }))
    .filter(x => !skipSet.has(x.originalIndex));
  if (indexedLines.length === 0) {
    return NextResponse.json({ error: 'Every parsed line was skipped — nothing to add.' }, { status: 400 });
  }

  // ── Duplicate detection ────────────────────────────────────────────────
  // We check the lines the caller hasn't already chosen to skip against
  // existing splits on this bank account.  Date ±3 days, signed amount
  // within £0.005.  If we find any AND the caller hasn't confirmed, we
  // return 409 with the suspect list so the UI can show a review screen.
  if (!body.confirm_duplicates) {
    const dupes = await detectDuplicateLines(
      supabase,
      params.id,
      imp.account_id,
      indexedLines.map(x => ({ date: x.line.date, amount: x.line.amount })),
    );
    const flagged = dupes.filter(d => d.match != null);
    if (flagged.length > 0) {
      return NextResponse.json({
        error: 'suspected_duplicates',
        suspected_duplicates: flagged.map(d => ({
          // Surface the ORIGINAL parsed-line index so the UI maps to the
          // row the user saw on their preview screen.
          index: indexedLines[d.index].originalIndex,
          line:  indexedLines[d.index].line,
          match: d.match,
        })),
      }, { status: 409 });
    }
  }

  // ── Existing lines to compute the next line_no without holes ────────────
  // We append rather than re-number — line_no is a stable display order, not
  // a positional id, so a CSV dropped in on top of manual entries just keeps
  // counting up.
  const { data: existing } = await supabase
    .from('bookkeeping_bank_lines')
    .select('line_no')
    .eq('import_id', params.importId)
    .order('line_no', { ascending: false })
    .limit(1);
  const nextLineNo = (existing?.[0]?.line_no ?? 0) + 1;

  // We import only the lines the caller chose to keep (indexedLines —
  // already filtered through skip_indices above).
  const rows = indexedLines.map((x, idx) => ({
    import_id: params.importId,
    book_id:   params.id,
    account_id: imp.account_id,
    line_no:   nextLineNo + idx,
    date:      x.line.date,
    description: x.line.description,
    amount:    x.line.amount,
    statement_balance: x.line.statementBalance,
  }));

  const { error: insErr } = await supabase
    .from('bookkeeping_bank_lines')
    .insert(rows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // ── Update parent rec: extend period, fill closing if missing, bump status
  // (Use indexedLines — the actually-imported set, post-skip.)
  const importedLines = indexedLines.map(x => x.line);
  const dates = importedLines.map(l => l.date).sort();
  const earliestNew = dates[0];
  const latestNew   = dates[dates.length - 1];

  const patch: Record<string, unknown> = {};
  if (!imp.period_start || earliestNew < imp.period_start) patch.period_start = earliestNew;
  if (!imp.period_end   || latestNew   > imp.period_end)   patch.period_end   = latestNew;
  if (imp.closing_balance == null) {
    // Last line in chronological order — use its statement_balance if set.
    const lastByDate = [...importedLines].sort((a, b) => a.date.localeCompare(b.date)).pop();
    if (lastByDate?.statementBalance != null) {
      patch.closing_balance = lastByDate.statementBalance;
    }
  }
  if (imp.status === 'pending') patch.status = 'in_progress';
  if (Object.keys(patch).length > 0) {
    await supabase.from('bookkeeping_bank_imports').update(patch).eq('id', params.importId);
  }

  return NextResponse.json({
    contributed: rows.length,
    skipped,
    columns,
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
