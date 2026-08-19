import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { buildCaptureTransaction, type CaptureRow, type AccountRef } from '@/lib/bookkeeping/captureImport';
import type { ParsedTransaction } from '@/lib/bookkeeping/vtTransactionReportParser';

// ── POST /api/bookkeeping/books/[id]/imports/from-capture ────────────────────
// Stage a Capture (SMITH-format) analysis directly into the bookkeeping import
// pipeline. Builds ParsedTransaction[] + a coa_detail summary, then inserts ONE
// bookkeeping_imports row (status 'pending') — so it gets the SAME preview →
// Post → rollback flow as every other import. Nothing posts here.
//
// Body: { output_id } — a saved full_analysis output with target_software 'smith'.

export const runtime = 'nodejs';

const Body = z.object({ output_id: z.string().uuid() });

const VALID_TYPES = new Set(['PIN', 'SIN', 'PAY', 'REC', 'PCR', 'SCR']);
const CONTACT_LEDGER: Record<string, string> = {
  PIN: 'Suppliers', PCR: 'Suppliers', SIN: 'Customers', SCR: 'Customers', PAY: 'Bank', REC: 'Bank',
};
const nrm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const r2 = (n: number) => +(n || 0).toFixed(2);

interface SmithRow {
  type?: string; date?: string; contactName?: string; reference?: string; description?: string;
  analysisAccount?: string;
  netAmount?: number; vatAmount?: number; grossAmount?: number; vatTreatment?: string; fileName?: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, firm_id, vat_registered, client_id, admin_locked')
    .eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: output } = await supabase
    .from('outputs').select('id, client_id, target_software, result_data')
    .eq('id', body.output_id).eq('firm_id', ctx.firmId).eq('feature', 'full_analysis').maybeSingle();
  if (!output) return NextResponse.json({ error: 'Capture analysis not found' }, { status: 404 });
  if (output.target_software !== 'smith') {
    return NextResponse.json({ error: 'This analysis isn’t in SMITH Bookkeeping format. Re-run Capture choosing “SMITH Bookkeeping”.' }, { status: 400 });
  }
  const smithRows = ((output.result_data as { transactions?: SmithRow[] } | null)?.transactions ?? [])
    .filter(t => VALID_TYPES.has((t.type ?? '').toUpperCase()));
  if (smithRows.length === 0) {
    return NextResponse.json({ error: 'No valid SMITH transactions in this analysis.' }, { status: 400 });
  }

  // Live book accounts.
  const { data: accts } = await supabase
    .from('bookkeeping_accounts').select('name, ledger, account_type, system_role')
    .eq('book_id', params.id).eq('archived', false);
  const allAccts = accts ?? [];

  // name → account (prefer income/expense for analysis matching).
  const byName = new Map<string, { ledger: string; name: string; account_type: string }>();
  for (const a of allAccts) {
    if (!a.name) continue;
    const key = nrm(a.name as string);
    const existing = byName.get(key);
    const isPL = a.account_type === 'income' || a.account_type === 'expense';
    if (!existing || isPL) byName.set(key, { ledger: (a.ledger as string) ?? '', name: a.name as string, account_type: a.account_type as string });
  }
  const roleAcct = (role: string): AccountRef | null => {
    const a = allAccts.find(x => x.system_role === role);
    return a ? { ledger: (a.ledger as string) ?? '', name: a.name as string } : null;
  };
  const vatInput = roleAcct('vat_input');
  const vatOutput = roleAcct('vat_output');
  const bankAcct = allAccts.find(a => a.ledger === 'Bank');
  const bankRef: AccountRef = bankAcct ? { ledger: 'Bank', name: bankAcct.name as string } : { ledger: 'Bank', name: 'Current account' };
  const SUSPENSE: AccountRef = { ledger: 'Suppliers', name: 'Suspense' };

  // Source-document Drive links by file name (from Capture's Drive saves).
  const driveByFile = new Map<string, { url: string; name: string }>();
  const docClient = output.client_id ?? book.client_id;
  if (docClient) {
    const { data: docs } = await supabase
      .from('documents').select('file_name, file_url, created_at')
      .eq('client_id', docClient).eq('document_type', 'full_analysis')
      .order('created_at', { ascending: false });
    for (const d of docs ?? []) {
      const fn = d.file_name as string | null;
      if (fn && d.file_url && !driveByFile.has(fn)) driveByFile.set(fn, { url: d.file_url as string, name: fn });
    }
  }

  // Build ParsedTransaction[].
  const txns: ParsedTransaction[] = [];
  const warnings: string[] = [];
  smithRows.forEach((s, i) => {
    const type = (s.type ?? 'PIN').toUpperCase();
    const contactName = (s.contactName ?? '').trim() || 'Unknown contact';
    const isBank = type === 'PAY' || type === 'REC';
    const primary: AccountRef = isBank ? bankRef : { ledger: CONTACT_LEDGER[type], name: contactName };

    // Analysis account — exact name match against the book COA, else Suspense.
    let analysis: AccountRef;
    const match = s.analysisAccount ? byName.get(nrm(s.analysisAccount)) : undefined;
    if (match) analysis = { ledger: match.ledger, name: match.name };
    else { analysis = SUSPENSE; warnings.push(`"${s.analysisAccount ?? '—'}" didn't match an account — routed to Suspense.`); }

    const vat = r2(s.vatAmount ?? 0);
    let vatAccount: AccountRef | null = null;
    if (book.vat_registered && vat > 0) {
      vatAccount = (type === 'SIN' || type === 'SCR' || type === 'REC') ? vatOutput : vatInput;
    }

    const doc = s.fileName ? driveByFile.get(s.fileName) : undefined;

    const row: CaptureRow = {
      type, date: s.date ?? new Date().toISOString().slice(0, 10),
      contactName, reference: s.reference ?? '', description: s.description ?? '',
      net: r2(s.netAmount ?? 0), vat, gross: r2(s.grossAmount ?? s.netAmount ?? 0),
      vatTreatment: s.vatTreatment ?? 'no_vat',
      primary, analysis, vatAccount,
      sourceDocUrl: doc?.url ?? null, sourceDocName: doc?.name ?? null,
      index: i,
    };
    const { txn, warnings: w } = buildCaptureTransaction(row);
    txns.push(txn);
    warnings.push(...w);
  });

  // coa_detail — distinct (ledger, account) referenced, with existing + type.
  const existingKeys = new Set(allAccts.map(a => `${nrm(a.ledger as string)}:::${nrm(a.name as string)}`));
  const inferType = (ledger: string, name: string): string => {
    const found = allAccts.find(a => nrm(a.ledger as string) === nrm(ledger) && nrm(a.name as string) === nrm(name));
    if (found) return found.account_type as string;
    if (ledger === 'Customers' || ledger === 'Bank') return 'asset';
    if (ledger === 'Suppliers' || ledger === 'Creditors') return 'liability';
    return 'expense';
  };
  const coaMap = new Map<string, { display: string; ledger: string; accountName: string; inferredAccountType: string; existing: boolean }>();
  for (const t of txns) {
    for (const sp of t.splits) {
      const key = `${nrm(sp.ledger)}:::${nrm(sp.accountName)}`;
      if (!coaMap.has(key)) {
        coaMap.set(key, {
          display: sp.accountDisplay, ledger: sp.ledger, accountName: sp.accountName,
          inferredAccountType: inferType(sp.ledger, sp.accountName),
          existing: existingKeys.has(key),
        });
      }
    }
  }
  const coaDetail = [...coaMap.values()];

  // Summary for the preview card.
  const byType: Record<string, number> = {};
  for (const t of txns) byType[t.type] = (byType[t.type] ?? 0) + 1;
  const dates = txns.map(t => t.date).filter(Boolean).sort();
  const summary = {
    transactions: txns.length,
    rows: smithRows.length,
    byType,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    unbalanced: 0,
    // snake_case `to_create` to match the VT + CSV importers — the shared
    // preview card reads summary.coa.to_create.
    coa: { existing: coaDetail.filter(c => c.existing).length, to_create: coaDetail.filter(c => !c.existing).length },
    coaAccounts: coaDetail.length,
    warnings,
    coa_detail: coaDetail,
    source: 'capture',
    source_output_id: output.id,
  };

  const { data: imp, error } = await supabase
    .from('bookkeeping_imports')
    .insert({
      book_id: params.id,
      uploaded_by: ctx.userId,
      file_name: `Capture analysis — ${txns.length} transaction${txns.length === 1 ? '' : 's'}`,
      status: 'pending',
      summary,
      parsed_rows: { transactions: txns },
    })
    .select('id, file_name, status, summary, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ import: imp, warnings });
}
