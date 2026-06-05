import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import type { TransactionType } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/imports/csv ─────────────────────────────
// AI-assisted CSV/Excel migration importer. The client parses any provider's
// export (Xero, QuickBooks, Sage, FreeAgent, or our own template) into headers
// + rows. The AI (a) maps the columns to SMITH's journal-line schema and (b)
// maps each distinct account name to this book's chart of accounts. We then
// build transactions deterministically in code and STAGE them into the same
// `bookkeeping_imports` pipeline the VT importer uses — so the user gets the
// identical preview → Post → Rollback flow, and nothing touches the ledger here.
//
// The AI only ever maps STRUCTURE (which column is which, which account is
// which) — never the figures. All parsing/arithmetic is done in code.
//
// Admin-only (mirrors the VT importer).

export const runtime = 'nodejs';
export const maxDuration = 60;

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'PAY', 'CHQ', 'REC', 'SIN', 'SCR', 'PIN', 'PCR', 'JRN', 'TRF', 'RJN', 'WOF', 'WBK', 'YET', 'DVT',
]);

const Body = z.object({
  fileName: z.string().min(1).max(260),
  headers: z.array(z.string()).min(1).max(60),
  rows: z.array(z.array(z.string())).min(1).max(20000),
});

const r2 = (n: number) => +Number(n).toFixed(2);

/** Parse a money cell: strips currency/commas, treats (123) and trailing - as negative. */
function parseAmount(v: string | undefined): number {
  if (!v) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; }
  s = s.replace(/[£$€,\s]/g, '').replace(/-/g, '');
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Parse a date cell to ISO yyyy-mm-dd given a format hint. Returns null if unparseable. */
function parseDate(v: string | undefined, fmt: string): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Excel serial number.
  if (fmt === 'excel' || /^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (isFinite(serial) && serial > 20000 && serial < 80000) {
      const ms = (serial - 25569) * 86400 * 1000; // 25569 = days from 1970 to 1900 epoch
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  // Already ISO.
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  // d/m/y or m/d/y separated by / . or -
  const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (parts) {
    let a = parseInt(parts[1], 10), b = parseInt(parts[2], 10);
    let y = parseInt(parts[3], 10);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day: number, month: number;
    if (fmt === 'MDY') { month = a; day = b; }
    else { day = a; month = b; } // default DMY (UK)
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; } // self-correct obvious swaps
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can run bulk imports.' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, firm_id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: accountRows } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type')
    .eq('book_id', params.id)
    .eq('archived', false);
  const accounts = accountRows ?? [];
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const coaText = accounts.length
    ? accounts.map(a => `- [${a.id}] ${a.ledger ? a.ledger + ': ' : ''}${a.name} (${a.account_type})`).join('\n')
    : '(no accounts set up yet)';

  const { headers, rows } = body;
  const sample = rows.slice(0, 12).map(r => headers.map((h, i) => `${h}=${r[i] ?? ''}`).join(' | '));

  let anthropic: Anthropic;
  try { anthropic = await getAnthropicForFirm(ctx.firmId); }
  catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] csv import anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  let inputTokens = 0, outputTokens = 0;

  // ── AI call 1: map the columns ──────────────────────────────────────────────
  const colTool: Anthropic.Tool = {
    name: 'map_columns',
    description: 'Map the spreadsheet columns to SMITH journal-line fields. Use the EXACT header text for each field, or omit if the file has no such column.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Header of the transaction date column.' },
        reference: { type: 'string', description: 'Header of the column that groups lines into one transaction (a journal/reference/voucher number). Lines sharing a value form one double-entry transaction.' },
        account: { type: 'string', description: 'Header of the account / nominal / category column.' },
        debit: { type: 'string', description: 'Header of the debit column (if debit & credit are separate columns).' },
        credit: { type: 'string', description: 'Header of the credit column.' },
        amount: { type: 'string', description: 'Header of a single signed amount column (use only when there are no separate debit/credit columns). Positive = debit, negative = credit.' },
        details: { type: 'string', description: 'Header of a per-line narrative/description column.' },
        type: { type: 'string', description: 'Header of a transaction-type column, if present.' },
        date_format: { type: 'string', enum: ['DMY', 'MDY', 'YMD', 'excel'], description: 'How dates are written (UK files are usually DMY).' },
        note: { type: 'string', description: 'One short sentence on anything ambiguous the user should check.' },
      },
      required: ['date', 'account'],
    },
  };

  let colMap: Record<string, string | undefined>;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tool_choice: { type: 'tool', name: 'map_columns' },
      tools: [colTool],
      messages: [{
        role: 'user',
        content: `This is an export from an accounting/bookkeeping tool. Map its columns to SMITH's journal-line schema.

Headers: ${headers.join(' | ')}

Sample rows:
${sample.join('\n')}

Map the columns now.`,
      }],
    });
    inputTokens += msg.usage?.input_tokens ?? 0;
    outputTokens += msg.usage?.output_tokens ?? 0;
    const tu = msg.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    if (!tu) throw new Error('no mapping');
    colMap = tu.input as Record<string, string | undefined>;
  } catch (err) {
    console.error('[bookkeeping] csv column map failed', err);
    return NextResponse.json({ error: 'The AI could not interpret that file’s columns. Try the SMITH template.' }, { status: 422 });
  }

  const idx = (header: string | undefined): number => header ? headers.indexOf(header) : -1;
  const iDate = idx(colMap.date);
  const iRef = idx(colMap.reference);
  const iAcct = idx(colMap.account);
  const iDebit = idx(colMap.debit);
  const iCredit = idx(colMap.credit);
  const iAmount = idx(colMap.amount);
  const iDetails = idx(colMap.details);
  const iType = idx(colMap.type);
  const dateFmt = colMap.date_format ?? 'DMY';

  if (iDate < 0 || iAcct < 0) {
    return NextResponse.json({ error: 'Could not find a date and account column. Try the SMITH template.' }, { status: 422 });
  }
  if (iDebit < 0 && iCredit < 0 && iAmount < 0) {
    return NextResponse.json({ error: 'Could not find debit/credit or amount columns. Try the SMITH template.' }, { status: 422 });
  }
  if (iRef < 0) {
    return NextResponse.json({ error: 'No reference/journal column found to group lines into transactions. Add one (each transaction’s lines must share a reference) or use the SMITH template.' }, { status: 422 });
  }

  // ── Parse rows → groups by reference ────────────────────────────────────────
  interface RawLine { accountLabel: string; debit: number; credit: number; details: string | null; sourceRow: number; }
  interface RawTxn { ref: string; date: string | null; type: string | null; details: string | null; lines: RawLine[]; firstRow: number; }
  const groups = new Map<string, RawTxn>();
  const distinctAccounts = new Set<string>();
  let warnings: string[] = [];

  rows.forEach((row, ri) => {
    const sourceRow = ri + 2; // 1-based + header row
    const ref = (row[iRef] ?? '').trim();
    const accountLabel = (row[iAcct] ?? '').trim();
    if (!ref && !accountLabel) return; // blank row
    if (!accountLabel) { warnings.push(`Row ${sourceRow}: no account — skipped.`); return; }
    const key = ref || `__row${sourceRow}`;

    let debit = 0, credit = 0;
    if (iAmount >= 0 && iDebit < 0 && iCredit < 0) {
      const amt = parseAmount(row[iAmount]);
      if (amt >= 0) debit = r2(amt); else credit = r2(-amt);
    } else {
      debit = r2(Math.abs(parseAmount(row[iDebit])));
      credit = r2(Math.abs(parseAmount(row[iCredit])));
    }
    if (debit === 0 && credit === 0) return; // nil line — ignore

    distinctAccounts.add(accountLabel);
    const details = iDetails >= 0 ? ((row[iDetails] ?? '').trim() || null) : null;
    const g = groups.get(key) ?? {
      ref: key,
      date: parseDate(row[iDate], dateFmt),
      type: iType >= 0 ? ((row[iType] ?? '').trim().toUpperCase() || null) : null,
      details,
      lines: [],
      firstRow: sourceRow,
    };
    if (!g.date) g.date = parseDate(row[iDate], dateFmt);
    if (!g.details && details) g.details = details;
    g.lines.push({ accountLabel, debit, credit, details, sourceRow });
    groups.set(key, g);
  });

  if (groups.size === 0) {
    return NextResponse.json({ error: 'No transaction lines found in the file.' }, { status: 422 });
  }

  // ── AI call 2: map distinct account names to the chart of accounts ──────────
  const labels = [...distinctAccounts];
  const acctTool: Anthropic.Tool = {
    name: 'map_accounts',
    description: 'Map each source account label to this book’s chart of accounts.',
    input_schema: {
      type: 'object',
      properties: {
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The source account label, verbatim.' },
              account_id: { type: 'string', description: 'Matching chart-of-accounts id. Omit if none fits.' },
              new_account: {
                type: 'object',
                description: 'A new account to create when nothing fits.',
                properties: {
                  name: { type: 'string' },
                  ledger: { type: 'string' },
                  account_type: { type: 'string', enum: ACCOUNT_TYPES as unknown as string[] },
                },
                required: ['name', 'ledger', 'account_type'],
              },
            },
            required: ['label'],
          },
        },
      },
      required: ['mappings'],
    },
  };

  let mappings: Array<Record<string, unknown>> = [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tool_choice: { type: 'tool', name: 'map_accounts' },
      tools: [acctTool],
      messages: [{
        role: 'user',
        content: `Map each of these source account labels to this book's chart of accounts. Match on meaning. Only propose a new_account when nothing sensible fits, choosing a ledger and account_type consistent with the existing chart.

Source account labels:
${labels.map(l => `- ${l}`).join('\n')}

Chart of accounts:
${coaText}

Map every label.`,
      }],
    });
    inputTokens += msg.usage?.input_tokens ?? 0;
    outputTokens += msg.usage?.output_tokens ?? 0;
    const tu = msg.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    mappings = (tu?.input as { mappings?: Array<Record<string, unknown>> })?.mappings ?? [];
  } catch (err) {
    console.error('[bookkeeping] csv account map failed', err);
    return NextResponse.json({ error: 'The AI adviser hit a problem mapping the accounts. Please try again.' }, { status: 500 });
  }

  await supabase.from('ai_logs').insert({
    user_id: ctx.userId, client_id: null, feature: 'csv_import',
    input_tokens: inputTokens || null, output_tokens: outputTokens || null,
  });

  // Resolve each label → { ledger, accountName, inferredAccountType, existing }.
  interface Resolved { ledger: string; accountName: string; inferredAccountType: typeof ACCOUNT_TYPES[number]; existing: boolean; }
  const resolved = new Map<string, Resolved>();
  for (const m of mappings) {
    const label = String(m.label ?? '');
    if (!label) continue;
    const acct = typeof m.account_id === 'string' ? accountById.get(m.account_id) : undefined;
    if (acct) {
      resolved.set(label, { ledger: acct.ledger ?? 'General', accountName: acct.name, inferredAccountType: acct.account_type as Resolved['inferredAccountType'], existing: true });
      continue;
    }
    const na = (m.new_account && typeof m.new_account === 'object') ? m.new_account as Record<string, unknown> : null;
    if (na && na.name && na.ledger && (ACCOUNT_TYPES as readonly string[]).includes(String(na.account_type))) {
      resolved.set(label, { ledger: String(na.ledger), accountName: String(na.name), inferredAccountType: String(na.account_type) as Resolved['inferredAccountType'], existing: false });
    }
  }
  // Any labels the AI didn't map → a Suspense account so nothing is silently dropped.
  for (const label of labels) {
    if (!resolved.has(label)) {
      resolved.set(label, { ledger: 'Suppliers', accountName: 'Suspense', inferredAccountType: 'liability', existing: accounts.some(a => a.ledger === 'Suppliers' && a.name === 'Suspense') });
      warnings.push(`Account "${label}" could not be mapped — routed to Suppliers: Suspense. Reassign before posting if needed.`);
    }
  }

  // ── Build ParsedTransaction[] (staging shape) ───────────────────────────────
  const byType: Record<string, number> = {};
  let unbalanced = 0;
  let minDate = '', maxDate = '';
  const transactions = [...groups.values()].map((g, gi) => {
    const type: TransactionType = (g.type && KNOWN_TYPES.has(g.type)) ? g.type as TransactionType : 'JRN';
    byType[type] = (byType[type] ?? 0) + 1;
    const splits = g.lines.map((l) => {
      const res = resolved.get(l.accountLabel)!;
      return {
        accountDisplay: `${res.ledger}: ${res.accountName}`,
        ledger: res.ledger,
        accountName: res.accountName,
        entryDetails: l.details,
        debit: l.debit,
        credit: l.credit,
        marker: null as string | null,
        sourceRow: l.sourceRow,
      };
    });
    const sumD = r2(splits.reduce((s, x) => s + x.debit, 0));
    const sumC = r2(splits.reduce((s, x) => s + x.credit, 0));
    const errors: string[] = [];
    if (!g.date) errors.push('No valid date');
    if (Math.abs(sumD - sumC) > 0.005) { errors.push(`Unbalanced: debits ${sumD} ≠ credits ${sumC}`); unbalanced++; }
    if (splits.length < 2) errors.push('Only one line — a journal needs at least two');
    const date = g.date ?? '';
    if (date) { if (!minDate || date < minDate) minDate = date; if (!maxDate || date > maxDate) maxDate = date; }
    return {
      originalRef: g.ref,
      type,
      refSeq: gi + 1,
      refNo: `${type} ${String(gi + 1).padStart(6, '0')}`,
      // Non-null → commit allocates fresh seqs and records provenance in notes.
      originalRefIfRemapped: g.ref.startsWith('__row') ? null : g.ref,
      date,
      details: g.details,
      notes: null as string | null,
      splits,
      errors,
      sourceRowStart: g.firstRow,
    };
  });

  // ── COA detail + summary (identical shape to the VT importer) ───────────────
  const accKey = (ledger: string, name: string) => `${ledger.toLowerCase()}:::${name.toLowerCase()}`;
  const coaMap = new Map<string, { display: string; ledger: string; accountName: string; inferredAccountType: Resolved['inferredAccountType']; existing: boolean }>();
  for (const res of resolved.values()) {
    const k = accKey(res.ledger, res.accountName);
    if (!coaMap.has(k)) coaMap.set(k, { display: `${res.ledger}: ${res.accountName}`, ledger: res.ledger, accountName: res.accountName, inferredAccountType: res.inferredAccountType, existing: res.existing });
  }
  const coaDetail = [...coaMap.values()];
  const coaToCreate = coaDetail.filter(c => !c.existing).length;

  warnings = warnings.slice(0, 100);
  if (colMap.note) warnings.unshift(`Column mapping: ${colMap.note}`);

  const summary = {
    rows: rows.length,
    transactions: transactions.length,
    byType,
    dateRange: { from: minDate, to: maxDate },
    unbalanced,
    coaAccounts: coaDetail.length,
    coa: { existing: coaDetail.length - coaToCreate, to_create: coaToCreate },
    coa_detail: coaDetail,
    warnings,
  };

  const { data: imp, error: impErr } = await supabase
    .from('bookkeeping_imports')
    .insert({
      book_id: params.id,
      uploaded_by: ctx.userId,
      file_name: body.fileName,
      status: 'pending',
      summary,
      parsed_rows: { transactions },
    })
    .select(`id, book_id, file_name, status, summary, created_at, posted_at, rolled_back_at,
      uploaded_by, uploader:users!bookkeeping_imports_uploaded_by_fkey(id, full_name, email)`)
    .single();
  if (impErr || !imp) {
    return NextResponse.json({ error: impErr?.message ?? 'Failed to stage the import' }, { status: 500 });
  }

  return NextResponse.json({ import: imp });
}
