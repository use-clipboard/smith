import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { parseVtTransactionReport, type ParseResult } from '@/lib/bookkeeping/vtTransactionReportParser';

// ── /api/bookkeeping/books/[id]/imports ─────────────────────────────────────
// GET  → list every import for the book (newest first). Used by the import
//        history list on the import page.
// POST → multipart upload of a VT transaction-report .xlsx. Parses the file
//        and creates ONE bookkeeping_imports row in status='pending' carrying
//        the parsed rows in JSONB. The user then reviews + clicks Post on the
//        per-import page, which is handled by `[importId]/route.ts`.
//
// This route does NOT post any transactions to the live ledger — that step
// is split into the per-import POST so the user can cancel after seeing the
// preview if anything looks wrong.
//
// Admin-only: the importer can create whole COA accounts and post hundreds
// of transactions at once, both of which are admin-shaped operations.

export const runtime = 'nodejs';

const SELECT_LIST = `
  id, book_id, file_name, status, summary, created_at, posted_at, rolled_back_at,
  uploaded_by, uploader:users!bookkeeping_imports_uploaded_by_fkey(id, full_name, email)
`;

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_imports')
    .select(SELECT_LIST)
    .eq('book_id', params.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data ?? [] });
}

// ── POST ────────────────────────────────────────────────────────────────────
// multipart/form-data: { file: <xlsx> }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can run bulk imports.' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, admin_locked').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Pull the file out of the multipart body.
  let form: FormData;
  try { form = await req.formData(); }
  catch (e) { return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.', detail: String(e) }, { status: 400 }); }
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
  // 25 MB cap — easily 100k+ rows. If anyone needs more we can chunk on the
  // server, but the staging JSONB column starts to feel slow well before that.
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large — 25 MB max.' }, { status: 413 });
  }

  // Parse on the server. The parser is pure — no DB calls inside.
  let parsed: ParseResult;
  try {
    const buf = await file.arrayBuffer();
    parsed = parseVtTransactionReport(buf);
  } catch (e) {
    return NextResponse.json({ error: 'Couldn’t parse the spreadsheet.', detail: String(e) }, { status: 400 });
  }

  if (parsed.fatalErrors.length > 0) {
    return NextResponse.json({ error: parsed.fatalErrors.join('; ') }, { status: 400 });
  }

  // Compute COA mapping summary so the preview screen can show "existing vs
  // to-create" without a second round trip.
  const { data: existingAccounts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger')
    .eq('book_id', params.id);
  const existingSet = new Set(
    (existingAccounts ?? []).map(a => `${a.ledger ?? ''}: ${a.name}`),
  );
  const coaWithStatus = parsed.coa.map(c => ({
    ...c,
    existing: existingSet.has(c.display),
  }));
  const coaToCreate = coaWithStatus.filter(c => !c.existing).length;
  const coaExisting = coaWithStatus.length - coaToCreate;

  const summary = {
    ...parsed.summary,
    coa: { existing: coaExisting, to_create: coaToCreate },
    warnings: parsed.warnings.slice(0, 100), // cap so the JSONB doesn't bloat
  };

  // Persist the staging row. We keep parsed.transactions in parsed_rows so
  // the POST step doesn't have to re-parse; coa is in summary for the UI.
  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_imports')
    .insert({
      book_id: params.id,
      uploaded_by: ctx.userId,
      file_name: file.name,
      status: 'pending',
      summary: { ...summary, coa_detail: coaWithStatus },
      parsed_rows: { transactions: parsed.transactions },
    })
    .select(SELECT_LIST)
    .single();
  if (impErr || !imp) {
    return NextResponse.json({ error: impErr?.message ?? 'Failed to create import' }, { status: 500 });
  }

  return NextResponse.json({ import: imp });
}
