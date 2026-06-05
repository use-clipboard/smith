import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { BOOK_TEMPLATE_LABEL } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/opening-balances/extract ────────────────
// AI opening-balances wizard, step 1. The user uploads a prior-year trial
// balance / set of accounts (PDF or image as base64, or pre-parsed CSV/Excel
// text). Claude reads it, extracts the balance-sheet opening figures and MAPS
// each to this book's real chart of accounts (by id), proposing new accounts
// where none fit. We validate (real ids, single-sided amounts) and hand the
// lines back for the user to review, edit and post as one opening JRN through
// the existing /transactions endpoint. Nothing is posted here.

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
const Body = z.object({
  files: z.array(FileSchema).max(10).optional(),
  /** Pre-parsed CSV/Excel content (parsed client-side). */
  textContent: z.string().max(200_000).nullable().optional(),
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const r2 = (n: number) => +Number(n).toFixed(2);

interface OBLine {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: { name: string; ledger: string; account_type: string } | null;
  label: string;
  debit: number;
  credit: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (!body.files?.length && !body.textContent?.trim()) {
    return NextResponse.json({ error: 'Upload a trial balance or set of accounts to extract from.' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id, template_type, vat_registered, first_period_start, year_end_md')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  const { data: accountRows } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type')
    .eq('book_id', params.id)
    .eq('archived', false)
    .order('ledger', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  const accounts = accountRows ?? [];
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const coaText = accounts.length
    ? accounts.map(a => `- [${a.id}] ${a.ledger ? a.ledger + ': ' : ''}${a.name} (${a.account_type})`).join('\n')
    : '(no accounts set up yet)';

  // ── Build the document/image content blocks (mirrors /api/analyse). ─────────
  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  for (const f of body.files ?? []) {
    if (f.mimeType === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
    } else if (IMAGE_TYPES.has(f.mimeType)) {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } });
    }
  }
  if (body.textContent?.trim()) {
    contentBlocks.push({ type: 'text', text: `Spreadsheet / CSV contents:\n\n${body.textContent.trim()}` });
  }
  if (contentBlocks.length === 0) {
    return NextResponse.json({ error: 'No readable trial balance found — supported formats: PDF, JPG, PNG, CSV, Excel.' }, { status: 400 });
  }

  const tool: Anthropic.Tool = {
    name: 'return_opening_balances',
    description: 'Return the extracted opening balances mapped to the chart of accounts.',
    input_schema: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          description: 'One line per balance-sheet account carrying an opening balance.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The account label as it appears in the source document.' },
              account_id: { type: 'string', description: 'Matching chart-of-accounts id. Omit if no existing account fits.' },
              new_account: {
                type: 'object',
                description: 'A new account to create when none of the existing accounts fit.',
                properties: {
                  name: { type: 'string' },
                  ledger: { type: 'string' },
                  account_type: { type: 'string', enum: ACCOUNT_TYPES as unknown as string[] },
                },
                required: ['name', 'ledger', 'account_type'],
              },
              debit: { type: 'number', description: 'Opening debit balance (assets, and debit-balance items). 0 if a credit.' },
              credit: { type: 'number', description: 'Opening credit balance (liabilities, equity). 0 if a debit.' },
            },
            required: ['label', 'debit', 'credit'],
          },
        },
        detected_date: { type: 'string', description: 'The balance date shown on the document (YYYY-MM-DD), if visible.' },
        note: { type: 'string', description: 'One short sentence on anything the user should check (e.g. an unmatched figure, a suspected sign).' },
      },
      required: ['lines'],
    },
  };

  const systemPrompt = `You are an expert UK bookkeeper setting up the OPENING BALANCES for a new set of books from a client's prior-year accounts or trial balance.

Extract the opening balances and map each to the book's chart of accounts below, using the EXACT account id. Rules:
- Only BALANCE-SHEET items carry opening balances: assets, liabilities and equity. Do NOT bring across profit & loss nominals (income/expenses) — accumulated reserves belong on the equity "Profit and loss account / Brought forward" account.
- Each line is single-sided: assets and debtors are debits; liabilities, creditors and equity/reserves are credits. Read the document's own debit/credit columns where present.
- Map to an existing account id wherever a sensible match exists (match on meaning, not just exact words). Only use new_account when nothing fits, choosing a sensible ledger and account_type.
- Use the figures in the document. Do not invent or balance the books yourself — if the source's debits and credits don't tally, return what's there and mention it in note.
- Amounts are positive numbers in the debit or credit field.

Book: ${book.name} — ${BOOK_TEMPLATE_LABEL[book.template_type as keyof typeof BOOK_TEMPLATE_LABEL] ?? book.template_type}${book.vat_registered ? ' · VAT registered' : ''}

Chart of accounts (use these exact ids):
${coaText}

Call return_opening_balances with the result.`;

  let anthropic: Anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] opening-balances anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  let parsed: { lines?: unknown[]; detected_date?: string; note?: string };
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'return_opening_balances' },
      messages: [{ role: 'user', content: contentBlocks }],
    });
    await supabase.from('ai_logs').insert({
      user_id: ctx.userId, client_id: null, feature: 'opening_balances',
      input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null,
    });
    const toolUse = message.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    if (!toolUse) return NextResponse.json({ error: 'The AI could not read a trial balance from that document. Try a clearer file.' }, { status: 422 });
    parsed = toolUse.input as typeof parsed;
  } catch (err) {
    console.error('[bookkeeping] opening-balances extract failed', err);
    return NextResponse.json({ error: 'The AI adviser hit a problem reading the document. Please try again.' }, { status: 500 });
  }

  // ── Validate + resolve the lines against the real chart of accounts. ────────
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const lines: OBLine[] = [];
  for (const raw of rawLines) {
    const l = raw as Record<string, unknown>;
    const debit = r2(Math.max(0, Number(l.debit ?? 0)));
    const credit = r2(Math.max(0, Number(l.credit ?? 0)));
    if (debit === 0 && credit === 0) continue;
    const label = String(l.label ?? '').slice(0, 160);

    const acct = typeof l.account_id === 'string' ? accountById.get(l.account_id) : undefined;
    if (acct) {
      lines.push({
        account_id: acct.id, account_name: acct.name, account_ledger: acct.ledger,
        new_account: null, label: label || acct.name,
        // A line is one-sided — keep the larger side if the model returned both.
        debit: debit >= credit ? debit : 0, credit: credit > debit ? credit : 0,
      });
      continue;
    }
    const na = (l.new_account && typeof l.new_account === 'object') ? l.new_account as Record<string, unknown> : null;
    if (na) {
      const name = String(na.name ?? '').trim();
      const ledger = String(na.ledger ?? '').trim();
      const account_type = String(na.account_type ?? '');
      if (name && ledger && (ACCOUNT_TYPES as readonly string[]).includes(account_type)) {
        lines.push({
          account_id: null, account_name: name, account_ledger: ledger,
          new_account: { name, ledger, account_type }, label: label || name,
          debit: debit >= credit ? debit : 0, credit: credit > debit ? credit : 0,
        });
        continue;
      }
    }
    // Unmatched figure — surface it with no account so the user can assign one.
    lines.push({
      account_id: null, account_name: label || 'Unmatched balance', account_ledger: null,
      new_account: null, label: label || 'Unmatched balance',
      debit: debit >= credit ? debit : 0, credit: credit > debit ? credit : 0,
    });
  }

  const totals = lines.reduce(
    (t, l) => ({ debit: r2(t.debit + l.debit), credit: r2(t.credit + l.credit) }),
    { debit: 0, credit: 0 },
  );

  const detectedDate = typeof parsed.detected_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.detected_date)
    ? parsed.detected_date : null;
  const defaultDate = book.first_period_start ?? detectedDate ?? new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    lines,
    totals,
    detectedDate,
    defaultDate,
    note: typeof parsed.note === 'string' ? parsed.note : '',
  });
}
