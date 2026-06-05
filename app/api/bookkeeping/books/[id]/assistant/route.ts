import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { BOOK_TEMPLATE_LABEL, VAT_SCHEME_LABEL } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/assistant ───────────────────────────────
// Conversational bookkeeping adviser. The user describes a scenario ("the
// client sold the business for £100k — how do we account for it?"); Claude
// explains the treatment in plain English and, where appropriate, PROPOSES one
// or more balanced journals via the `propose_journals` tool.
//
// Nothing is ever posted from here. The tool only emits a *proposal* — the
// client renders it as an editable preview card and the user posts it (with a
// click) through the existing, validated POST /transactions choke-point. The
// AI gets no privileged path into the ledger.
//
// Safety rails enforced server-side before a proposal ever reaches the client:
//   · every account_id must be a real account on THIS book
//   · each journal must balance (sum of debits == sum of credits)
// Anything failing these is bounced back to Claude as a tool error to fix
// in-loop, so the user only ever sees valid, real-account proposals.

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  /** Active period bounds — anchor default journal dates to the period end. */
  period: z.object({ from: ISO.nullable(), to: ISO.nullable() }).optional(),
});

// A proposed split references EITHER an existing account by id, OR a new
// account to be created on post. The client resolves new accounts (via
// POST /accounts) before posting the journal.
interface ProposedSplit {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: { name: string; ledger: string; account_type: string } | null;
  debit: number;
  credit: number;
  entry_details: string | null;
}
interface ProposedEntry {
  id: string;
  type: 'JRN' | 'RJN';
  /** For RJN only — the date the auto-reversal posts on. */
  reverses_on_date: string | null;
  date: string;
  narrative: string;
  explanation: string;
  splits: ProposedSplit[];
}

const r2 = (n: number) => +Number(n).toFixed(2);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id, template_type, vat_registered, vat_scheme, year_end_md, period_lock_date, vat_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  // ── Chart of accounts — seeded into the prompt so Claude is grounded in the
  //    book's REAL accounts (and their ids) and can't invent them. ────────────
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

  // ── Tools ────────────────────────────────────────────────────────────────
  const tools: Anthropic.Tool[] = [
    {
      name: 'get_account_balance',
      description: 'Get the current all-time balance of one account on this book. Use when you need a figure to build a journal (e.g. the carrying amount of an asset before disposal). Returns debit_total, credit_total and net balance (debit − credit).',
      input_schema: {
        type: 'object',
        properties: { account_id: { type: 'string', description: 'The account id, from the chart of accounts in the system prompt.' } },
        required: ['account_id'],
      },
    },
    {
      name: 'search_transactions',
      description: 'Search posted transactions on this book to understand existing entries. Optionally filter by account, type or date range. Returns up to 25 recent matches with ref, date, type, details and total.',
      input_schema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Only transactions touching this account.' },
          type: { type: 'string', description: 'Transaction type code, e.g. JRN, PAY, SIN.' },
          date_from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          date_to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
      },
    },
    {
      name: 'propose_journals',
      description: 'Propose one or more balanced journal entries for the user to review and post. This does NOT post anything — it shows the user an editable preview. Use real account ids from the chart of accounts wherever possible; only use new_account when no suitable account exists. Every entry must balance (total debits = total credits). Call this once with ALL the entries needed for the scenario.',
      input_schema: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            description: 'The journal entries to propose.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['JRN', 'RJN'], description: 'JRN for a one-off journal. RJN for a REVERSING journal that should auto-reverse on a future date — use this for accruals, prepayments, deferred income and anything that must unwind in the next period. Defaults to JRN.' },
                reverses_on_date: { type: 'string', description: 'Required when type is RJN: the date the automatic reversal posts on (YYYY-MM-DD). Normally the first day of the next period. Must be after the posting date.' },
                date: { type: 'string', description: 'Posting date, YYYY-MM-DD.' },
                narrative: { type: 'string', description: 'Short description of the journal (the details line).' },
                explanation: { type: 'string', description: 'One or two sentences explaining why this entry is correct, for the user.' },
                splits: {
                  type: 'array',
                  minItems: 2,
                  items: {
                    type: 'object',
                    properties: {
                      account_id: { type: 'string', description: 'Existing account id from the chart of accounts. Omit if using new_account.' },
                      new_account: {
                        type: 'object',
                        description: 'A new account to create, when none of the existing accounts fit. Omit if using account_id.',
                        properties: {
                          name: { type: 'string' },
                          ledger: { type: 'string', description: 'Ledger grouping, e.g. "Expenses", "Income", "FA - plant", "Equity".' },
                          account_type: { type: 'string', enum: ACCOUNT_TYPES as unknown as string[] },
                        },
                        required: ['name', 'ledger', 'account_type'],
                      },
                      debit: { type: 'number', description: 'Debit amount (0 if this is a credit line).' },
                      credit: { type: 'number', description: 'Credit amount (0 if this is a debit line).' },
                      entry_details: { type: 'string', description: 'Optional per-line narrative.' },
                    },
                    required: ['debit', 'credit'],
                  },
                },
              },
              required: ['date', 'narrative', 'explanation', 'splits'],
            },
          },
        },
        required: ['entries'],
      },
    },
  ];

  const today = new Date().toISOString().slice(0, 10);

  // Default journal dating is anchored to the period the user is working in.
  // Period end is the natural posting date for adjustments; the day after is
  // the natural auto-reversal date for accruals/prepayments.
  const addOneDay = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const periodStart = body.period?.from ?? null;
  const periodEnd = body.period?.to ?? null;
  const reversalDefault = periodEnd ? addOneDay(periodEnd) : null;

  const datingPolicy = periodEnd
    ? `DEFAULT DATING — the user is working in the period ${periodStart ?? '(start unknown)'} to ${periodEnd}. Unless they specify otherwise, date EVERY journal (illustrative and proposed) on the PERIOD END, i.e. ${periodEnd}. For reversing journals (RJN), set reverses_on_date to the day AFTER the period end, i.e. ${reversalDefault}. Only use a different date when the user gives one or the entry clearly belongs to another date (e.g. a specific invoice/payment date). Do not default to today.`
    : `DEFAULT DATING — no period is selected. Date adjustments on the book's year end if known, otherwise ask the user which date to use rather than assuming today.`;

  const systemPrompt = `You are SMITH, an expert UK bookkeeping and accounting adviser embedded in a double-entry bookkeeping tool used by a UK accountancy practice. You are helping a qualified bookkeeper or accountant working on a specific client's book.

Your job:
1. Discuss the accounting question and explain the correct treatment under UK GAAP / FRS 105 / FRS 102 as appropriate, in clear British English.
2. Where the user needs to record something, show the double-entry and — when they have real figures and would want to post it — PROPOSE the journal(s) using the propose_journals tool.
3. Be precise about debits and credits. Every journal must balance.

How to present journals (IMPORTANT):
- NEVER draw a journal as a markdown table. NEVER use markdown pipe tables (| ... |), and avoid markdown headings (#, ##, ###) and horizontal rules (---) — they render as raw text here.
- To ILLUSTRATE or explain an entry in your reply, output a fenced code block tagged "journal" containing a single JSON object. The app renders it as a clean double-entry panel. Schema:
  \`\`\`journal
  {"title":"Short label","date":"optional dd/mm/yyyy","lines":[
    {"ledger":"Bank","account":"Current account","debit":100.00},
    {"ledger":"Expenses","account":"Write offs / discounts","credit":100.00}
  ]}
  \`\`\`
  Each line has account (required), optional ledger, and EITHER a numeric "debit" or "credit". When you are explaining direction conceptually and no figure is known, use "dr":true or "cr":true instead of a number. Total debits must equal total credits when figures are given.
- When the user has given concrete figures and the entry is one they'd actually post on THIS book, use the propose_journals tool INSTEAD of a journal code block — that produces an editable, postable card. Don't also draw the same entry as a code block.
- Keep prose tight. Use short paragraphs, **bold** for emphasis and simple "- " bullets. No tables.

${datingPolicy}

Reversing journals (IMPORTANT): for anything that must unwind in the next period — accruals, prepayments, deferred/accrued income, year-end provisions you expect to reverse — propose a REVERSING journal: set the entry's "type" to "RJN" and "reverses_on_date" to the first day of the next period (or the date you'd expect it to unwind). The system posts the reversal automatically on that date, so DON'T tell the user to set a manual reminder to reverse it, and don't propose a separate reversal entry — the RJN handles it. Explain in your prose that you've used a reversing journal and when it will auto-reverse. Use a plain JRN only for permanent entries that should not reverse.

Hard rules:
- You CANNOT post anything to the books. The propose_journals tool only shows the user an editable preview; they review and post it themselves. Never say you have posted, saved or recorded anything — say you have "prepared" or "suggested" it.
- Only ever reference accounts that exist in the chart of accounts below, using their exact id. If a genuinely new account is needed, use the new_account field on the split and explain why.
- You are advising a professional. Be concise and technical; don't over-explain basics. Flag where judgement, valuations or further information (e.g. CGT, the disposal of goodwill, VAT on the sale) would be needed, but stay within bookkeeping — don't give definitive tax advice.
- If a figure is uncertain or the user hasn't given it, ask rather than guess. You can call get_account_balance or search_transactions to look things up.
- Use get_account_balance to confirm carrying amounts before proposing disposals or write-offs.

Book context:
- Name: ${book.name}
- Entity type: ${BOOK_TEMPLATE_LABEL[book.template_type as keyof typeof BOOK_TEMPLATE_LABEL] ?? book.template_type}
- VAT registered: ${book.vat_registered ? `Yes${book.vat_scheme ? ` (${VAT_SCHEME_LABEL[book.vat_scheme as keyof typeof VAT_SCHEME_LABEL] ?? book.vat_scheme})` : ''}` : 'No'}
- Working period: ${periodEnd ? `${periodStart ?? '?'} to ${periodEnd}` : '(none selected)'}
- Book year end: ${book.year_end_md ? book.year_end_md.replace(/^(\d{2})-(\d{2})$/, '$2/$1') : '(not set)'}
- Today's date: ${today}

Chart of accounts (id in brackets — use these exact ids in proposals):
${coaText}`;

  // ── Agentic tool loop ──────────────────────────────────────────────────────
  const messages: Anthropic.MessageParam[] = body.messages.map(m => ({ role: m.role, content: m.content }));
  const proposals: ProposedEntry[] = [];
  let replyText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  let anthropic: Anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] assistant: anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  try {
    const MAX_TURNS = 6;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });
      inputTokens += message.usage?.input_tokens ?? 0;
      outputTokens += message.usage?.output_tokens ?? 0;

      // Collect any prose text from this turn.
      for (const block of message.content) {
        if (block.type === 'text') replyText += (replyText ? '\n\n' : '') + block.text;
      }

      if (message.stop_reason !== 'tool_use') break;

      // Run the tools Claude asked for, gather results for the next turn.
      messages.push({ role: 'assistant', content: message.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of message.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runTool(block, { supabase, bookId: params.id, accountById, proposals });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    console.error('[bookkeeping] assistant loop failed', err);
    return NextResponse.json({ error: 'The AI adviser hit a problem. Please try again.' }, { status: 500 });
  }

  await supabase.from('ai_logs').insert({
    user_id: ctx.userId, client_id: null, feature: 'book_assistant',
    input_tokens: inputTokens || null, output_tokens: outputTokens || null,
  });

  return NextResponse.json({
    reply: replyText.trim() || 'I’ve prepared the suggestion below.',
    proposals,
  });
}

// ── Tool execution ───────────────────────────────────────────────────────────
type ToolCtx = {
  supabase: ReturnType<typeof createClient>;
  bookId: string;
  accountById: Map<string, { id: string; name: string; ledger: string | null; account_type: string }>;
  proposals: ProposedEntry[];
};

async function runTool(
  block: Anthropic.ToolUseBlock,
  { supabase, bookId, accountById, proposals }: ToolCtx,
): Promise<{ content: string; isError: boolean }> {
  const input = (block.input ?? {}) as Record<string, unknown>;

  if (block.name === 'get_account_balance') {
    const accountId = String(input.account_id ?? '');
    const acct = accountById.get(accountId);
    if (!acct) return { content: `No account with id ${accountId} exists on this book.`, isError: true };
    // Sum all splits for this account.
    let debit = 0, credit = 0, pageStart = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('debit, credit, transaction:bookkeeping_transactions!inner(book_id)')
        .eq('account_id', accountId)
        .eq('transaction.book_id', bookId)
        .range(pageStart, pageStart + PAGE - 1);
      if (error) return { content: `Could not read balance: ${error.message}`, isError: true };
      for (const row of (data ?? []) as { debit: number; credit: number }[]) {
        debit += Number(row.debit); credit += Number(row.credit);
      }
      if (!data || data.length < PAGE) break;
      pageStart += PAGE;
    }
    return {
      content: JSON.stringify({
        account: `${acct.ledger ? acct.ledger + ': ' : ''}${acct.name}`,
        debit_total: r2(debit), credit_total: r2(credit), balance: r2(debit - credit),
      }),
      isError: false,
    };
  }

  if (block.name === 'search_transactions') {
    let q = supabase
      .from('bookkeeping_transactions')
      .select('ref_no, type, date, details, payee_text, total')
      .eq('book_id', bookId)
      .order('date', { ascending: false })
      .limit(25);
    if (input.type) q = q.eq('type', String(input.type).toUpperCase());
    if (input.date_from) q = q.gte('date', String(input.date_from));
    if (input.date_to) q = q.lte('date', String(input.date_to));
    // account_id filter requires a split lookup first.
    if (input.account_id) {
      const { data: splitRows } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('transaction_id')
        .eq('account_id', String(input.account_id))
        .limit(500);
      const ids = [...new Set((splitRows ?? []).map(r => r.transaction_id as string))];
      if (ids.length === 0) return { content: JSON.stringify({ transactions: [] }), isError: false };
      q = q.in('id', ids);
    }
    const { data, error } = await q;
    if (error) return { content: `Search failed: ${error.message}`, isError: true };
    return { content: JSON.stringify({ transactions: data ?? [] }), isError: false };
  }

  if (block.name === 'propose_journals') {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    if (entries.length === 0) return { content: 'No entries were provided.', isError: true };

    const validated: ProposedEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as Record<string, unknown>;
      const date = String(e.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { content: `Entry ${i + 1}: date must be YYYY-MM-DD.`, isError: true };

      const type: 'JRN' | 'RJN' = String(e.type ?? 'JRN').toUpperCase() === 'RJN' ? 'RJN' : 'JRN';
      let reversesOnDate: string | null = null;
      if (type === 'RJN') {
        reversesOnDate = String(e.reverses_on_date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(reversesOnDate)) return { content: `Entry ${i + 1}: a reversing journal (RJN) needs reverses_on_date in YYYY-MM-DD.`, isError: true };
        if (reversesOnDate <= date) return { content: `Entry ${i + 1}: reverses_on_date must be after the posting date.`, isError: true };
      }

      const rawSplits = Array.isArray(e.splits) ? e.splits : [];
      if (rawSplits.length < 2) return { content: `Entry ${i + 1}: a journal needs at least two lines.`, isError: true };

      const splits: ProposedSplit[] = [];
      let totalDebit = 0, totalCredit = 0;
      for (let j = 0; j < rawSplits.length; j++) {
        const s = rawSplits[j] as Record<string, unknown>;
        const debit = r2(Number(s.debit ?? 0));
        const credit = r2(Number(s.credit ?? 0));
        if (debit < 0 || credit < 0) return { content: `Entry ${i + 1} line ${j + 1}: amounts cannot be negative.`, isError: true };
        if (debit > 0 && credit > 0) return { content: `Entry ${i + 1} line ${j + 1}: a line is either a debit or a credit, not both.`, isError: true };
        if (debit === 0 && credit === 0) return { content: `Entry ${i + 1} line ${j + 1}: a line must have a debit or a credit.`, isError: true };

        const hasId = typeof s.account_id === 'string' && s.account_id;
        const newAcct = (s.new_account && typeof s.new_account === 'object') ? s.new_account as Record<string, unknown> : null;
        if (hasId && newAcct) return { content: `Entry ${i + 1} line ${j + 1}: provide either account_id or new_account, not both.`, isError: true };
        if (!hasId && !newAcct) return { content: `Entry ${i + 1} line ${j + 1}: provide account_id or new_account.`, isError: true };

        if (hasId) {
          const acct = accountById.get(String(s.account_id));
          if (!acct) return { content: `Entry ${i + 1} line ${j + 1}: account id ${String(s.account_id)} does not exist on this book. Use an id from the chart of accounts or propose a new_account.`, isError: true };
          splits.push({
            account_id: acct.id, account_name: acct.name, account_ledger: acct.ledger,
            new_account: null, debit, credit, entry_details: s.entry_details ? String(s.entry_details) : null,
          });
        } else if (newAcct) {
          const name = String(newAcct.name ?? '').trim();
          const ledger = String(newAcct.ledger ?? '').trim();
          const account_type = String(newAcct.account_type ?? '');
          if (!name || !ledger || !(ACCOUNT_TYPES as readonly string[]).includes(account_type)) {
            return { content: `Entry ${i + 1} line ${j + 1}: new_account needs name, ledger and a valid account_type (${ACCOUNT_TYPES.join('/')}).`, isError: true };
          }
          splits.push({
            account_id: null, account_name: name, account_ledger: ledger,
            new_account: { name, ledger, account_type }, debit, credit,
            entry_details: s.entry_details ? String(s.entry_details) : null,
          });
        }
        totalDebit += debit; totalCredit += credit;
      }

      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        return { content: `Entry ${i + 1} does not balance: debits ${r2(totalDebit)} ≠ credits ${r2(totalCredit)}. Adjust the lines so they're equal.`, isError: true };
      }

      validated.push({
        id: randomUUID(),
        type,
        reverses_on_date: reversesOnDate,
        date,
        narrative: String(e.narrative ?? '').slice(0, 500),
        explanation: String(e.explanation ?? '').slice(0, 1000),
        splits,
      });
    }

    proposals.push(...validated);
    return {
      content: `${validated.length} journal${validated.length === 1 ? '' : 's'} prepared and shown to the user for review. Do not repeat the full journal in your text reply — briefly summarise and let the user know they can review, edit and post it below.`,
      isError: false,
    };
  }

  return { content: `Unknown tool: ${block.name}`, isError: true };
}
