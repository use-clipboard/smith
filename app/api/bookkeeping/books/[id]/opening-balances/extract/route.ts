import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { resolveBookAccount } from '@/lib/bookkeeping/fixedAssets';
import { BOOK_TEMPLATE_LABEL } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/opening-balances/extract ────────────────
// AI opening-balances wizard, step 1. The user uploads a prior-year trial
// balance / set of accounts (PDF or image as base64, or pre-parsed CSV/Excel
// text). Claude TRANSCRIBES EVERY line on the document — profit & loss nominals
// included — tagging each 'bs' or 'pl', and maps each to this book's real chart
// of accounts (by id), proposing new accounts where none fit. We validate (real
// ids, single-sided amounts) and hand the lines back for the user to review,
// edit and post as one opening JRN via the existing /transactions endpoint.
// Nothing is posted here.
//
// ─── Why we transcribe the P&L even when the user doesn't want it ────────────
// This route used to instruct the model to DROP P&L nominals outright. That is
// right for the textbook case (start from last year's closing balance sheet)
// but it silently guaranteed an out-of-balance whenever someone fed it a full
// year's trial balance: the reserves line on such a TB is the OPENING reserve,
// and the year's result — the rest of the closing reserve — lives in the very
// nominals we threw away. The user was then invited to plug the gap with a
// balancing line, which is wrong.
//
// So: transcribe everything once, tag it, and let the user choose the scope
// (see `scope` below). Because every line comes back, the wizard can switch
// between scopes client-side with no second AI call.
//
//   'bs'  — balance sheet only (default; the migration case). P&L nominals are
//           excluded and replaced by ONE roll-up line carrying their net result
//           to retained earnings, which is what makes the opening reserve the
//           CLOSING reserve. Suppressed when the BS lines already balance on
//           their own (a post-closing TB whose reserves are already rolled).
//   'all' — the whole trial balance, P&L included. For when the book's first
//           period covers the document's period and you want the year in SMITH.
//   'pl'  — P&L nominals only, with the mirror contra to retained earnings.

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const SCOPES = ['bs', 'all', 'pl'] as const;
type Scope = (typeof SCOPES)[number];

const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
const Body = z.object({
  files: z.array(FileSchema).max(10).optional(),
  /** Pre-parsed CSV/Excel content (parsed client-side). */
  textContent: z.string().max(200_000).nullable().optional(),
  /** Which part of the document to bring in. Advisory — every line is returned
   *  either way; this only sets which ones arrive switched on. */
  scope: z.enum(SCOPES).optional(),
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const r2 = (n: number) => +Number(n).toFixed(2);

interface OBLine {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: { name: string; ledger: string; account_type: string } | null;
  label: string;
  /** Which half of the trial balance this line came from. */
  section: 'bs' | 'pl';
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
    .select('id, name, ledger, account_type, system_role')
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
          description: 'One line per account carrying a balance in the source document — EVERY line, balance sheet and profit & loss alike.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The account label as it appears in the source document.' },
              section: {
                type: 'string',
                enum: ['bs', 'pl'],
                description: 'Which half of the trial balance this line belongs to: "bs" for assets, liabilities, capital and reserves; "pl" for income and expense nominals (sales, purchases, rent, wages, depreciation charge, tax charge…).',
              },
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
              debit: { type: 'number', description: 'Debit balance as shown in the document. 0 if this is a credit balance.' },
              credit: { type: 'number', description: 'Credit balance as shown in the document. 0 if this is a debit balance.' },
            },
            required: ['label', 'section', 'debit', 'credit'],
          },
        },
        detected_date: { type: 'string', description: 'The balance date the figures are stated AS AT (YYYY-MM-DD) — for a trial balance covering a period, this is the period END date.' },
        period_start: { type: 'string', description: 'Start of the period the document covers (YYYY-MM-DD), if stated.' },
        period_end: { type: 'string', description: 'End of the period the document covers (YYYY-MM-DD), if stated.' },
        note: { type: 'string', description: 'One short sentence on anything the user should check (e.g. an unmatched figure, a suspected sign). Say nothing about profit & loss nominals being included or excluded — the user chooses that themselves.' },
      },
      required: ['lines'],
    },
  };

  const systemPrompt = `You are an expert UK bookkeeper reading a client's trial balance or set of accounts so it can be brought into a new set of books.

TRANSCRIBE EVERY LINE that carries a balance — the whole document, both halves of the trial balance — and map each to the book's chart of accounts below, using the EXACT account id. Rules:
- Return profit & loss nominals (sales, purchases, rent, wages, motor, depreciation charge, tax charge…) as well as balance-sheet items. Tag each line with section: "pl" or "bs". Do NOT filter anything out — the user decides afterwards which half to bring in, and dropping lines here would leave them out of balance with no way to see why.
- Each line is single-sided: read the document's own debit and credit columns. Assets, debtors and expenses are debits; liabilities, creditors, equity/reserves and income are credits.
- Map to an existing account id wherever a sensible match exists (match on meaning, not just exact words). Only use new_account when nothing fits, choosing a sensible ledger and account_type.
- Report the figures as they appear. Do not invent, net off, or balance the books yourself — if the source's debits and credits don't tally, return what's there and say so in note.
- Amounts are positive numbers in the debit or credit field.
- A reserves line labelled "brought forward" / "b/fwd" is a balance-sheet line (section "bs"), even though it relates to past profits.

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

  let parsed: { lines?: unknown[]; detected_date?: string; period_start?: string; period_end?: string; note?: string };
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
    const section: 'bs' | 'pl' = l.section === 'pl' ? 'pl' : 'bs';
    // A line is one-sided — keep the larger side if the model returned both.
    const sided = { debit: debit >= credit ? debit : 0, credit: credit > debit ? credit : 0 };

    const acct = typeof l.account_id === 'string' ? accountById.get(l.account_id) : undefined;
    if (acct) {
      lines.push({
        account_id: acct.id, account_name: acct.name, account_ledger: acct.ledger,
        new_account: null, label: label || acct.name, section, ...sided,
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
          new_account: { name, ledger, account_type }, label: label || name, section, ...sided,
        });
        continue;
      }
    }
    // Unmatched figure — surface it with no account so the user can assign one.
    lines.push({
      account_id: null, account_name: label || 'Unmatched balance', account_ledger: null,
      new_account: null, label: label || 'Unmatched balance', section, ...sided,
    });
  }

  const sum = (ls: OBLine[]) => ls.reduce(
    (t, l) => ({ debit: r2(t.debit + l.debit), credit: r2(t.credit + l.credit) }),
    { debit: 0, credit: 0 },
  );
  const bsLines = lines.filter(l => l.section === 'bs');
  const plLines = lines.filter(l => l.section === 'pl');
  const totals = sum(lines);
  const bsTotals = sum(bsLines);
  const plTotals = sum(plLines);

  // ── The retained-earnings roll-up ───────────────────────────────────────────
  // Taking only the balance sheet off a full-year TB leaves the reserves line at
  // its OPENING figure — the year's result is in the P&L nominals we've set
  // aside. One line carrying that net result to retained earnings turns the
  // opening reserve into the closing reserve, which is exactly what a migration
  // needs, and it squares the entry at the same time.
  //
  // net > 0 → profit → credit reserves.  net < 0 → loss → debit reserves.
  const plNet = r2(plTotals.credit - plTotals.debit);
  const bsDiff = r2(bsTotals.debit - bsTotals.credit);
  const retained = resolveBookAccount(accounts, 'retained_earnings', 'Profit and loss account', 'equity');

  const rollup = plLines.length > 0 && Math.abs(plNet) >= 0.005
    ? {
        account_id: retained?.id ?? null,
        account_name: retained?.name ?? 'Profit and loss account',
        account_ledger: retained?.ledger ?? null,
        label: parsed.period_end
          ? `Profit and loss for the period ended ${parsed.period_end}`
          : 'Profit and loss for the period',
        debit: plNet < 0 ? Math.abs(plNet) : 0,
        credit: plNet > 0 ? plNet : 0,
      }
    : null;

  // Suppress the roll-up when the balance sheet already squares without it —
  // that's a post-closing TB whose reserves line is already the closing figure,
  // and adding the result again would double-count the year.
  const rollupNeeded = rollup !== null && Math.abs(bsDiff) >= 0.005;

  const isoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const detectedDate = isoDate(parsed.detected_date);
  const periodStart = isoDate(parsed.period_start);
  const periodEnd = isoDate(parsed.period_end);

  // The document's own balance date wins. Opening balances are stated AS AT a
  // date, and that date is on the paper in front of the user — the book's first
  // period start is only a fallback for a document that doesn't say. (This used
  // to be the other way round, which silently dated a 2024 TB to 2022.)
  const defaultDate = detectedDate ?? periodEnd ?? book.first_period_start ?? new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    lines,
    scope: body.scope ?? 'bs',
    totals,
    sections: {
      bs: { count: bsLines.length, ...bsTotals },
      pl: { count: plLines.length, ...plTotals, net: plNet },
    },
    rollup,
    rollupNeeded,
    retainedEarningsResolved: Boolean(retained),
    detectedDate,
    periodStart,
    periodEnd,
    firstPeriodStart: book.first_period_start ?? null,
    defaultDate,
    note: typeof parsed.note === 'string' ? parsed.note : '',
  });
}
