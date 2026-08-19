import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { BOOK_TEMPLATE_LABEL } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/opening-balances/chat ───────────────────
// "Chat to SMITH" alongside the opening-balances proposal. The accountant can
// interrogate the extraction ("why is the director's account a credit?"),
// correct it in words ("include all the income and expense balances", "that's
// not overdrawn, leave it as a liability") and have SMITH restate the figures.
//
// SMITH PROPOSES, THE USER APPLIES. This route never writes anything: it
// returns a reply plus an optional list of operations. The wizard renders those
// as a diff card the user clicks Apply on, and only then does the client mutate
// its lines (creating any new chart-of-accounts entries through the normal
// POST /accounts route). Nothing reaches the ledger until the user posts the
// opening journal itself, exactly as before.
//
// Every line of the source document — profit & loss nominals included — is in
// the payload with an `included` flag, so "bring the P&L in too" is a matter of
// flipping flags on figures already extracted, not re-reading the document.

export const runtime = 'nodejs';
export const maxDuration = 60;

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const SCOPES = ['bs', 'all', 'pl'] as const;

const LineSchema = z.object({
  key: z.string().min(1).max(40),
  account_id: z.string().nullable(),
  account_display: z.string().max(200),
  label: z.string().max(200),
  section: z.enum(['bs', 'pl']),
  included: z.boolean(),
  debit: z.number(),
  credit: z.number(),
});

const Body = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(8000),
  })).min(1).max(40),
  lines: z.array(LineSchema).max(400),
  openingDate: z.string().nullable().optional(),
  scope: z.enum(SCOPES),
  note: z.string().max(4000).optional(),
});

const money = (n: number) => n.toFixed(2);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id, template_type, vat_registered, first_period_start')
    .eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  const { data: accountRows } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, account_type')
    .eq('book_id', params.id)
    .eq('archived', false)
    .order('ledger', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  const accounts = accountRows ?? [];
  const accountIds = new Set(accounts.map(a => a.id));
  const coaText = accounts.length
    ? accounts.map(a => `- [${a.id}] ${a.ledger ? a.ledger + ': ' : ''}${a.name} (${a.account_type})`).join('\n')
    : '(no accounts set up yet)';
  const ledgers = [...new Set(accounts.map(a => a.ledger).filter(Boolean))];

  // ── Current state, rendered for the model ──────────────────────────────────
  const included = body.lines.filter(l => l.included);
  const excluded = body.lines.filter(l => !l.included);
  const totals = included.reduce((t, l) => ({ debit: t.debit + l.debit, credit: t.credit + l.credit }), { debit: 0, credit: 0 });
  const diff = +(totals.debit - totals.credit).toFixed(2);

  const renderLine = (l: z.infer<typeof LineSchema>) =>
    `  [${l.key}] ${l.account_display || '(no account assigned)'} — "${l.label}" — ${l.debit ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}${l.section === 'pl' ? ' (P&L)' : ''}`;

  const stateText = `CURRENTLY INCLUDED (${included.length} lines):
${included.map(renderLine).join('\n') || '  (none)'}

EXCLUDED — extracted from the document but switched off (${excluded.length} lines):
${excluded.map(renderLine).join('\n') || '  (none)'}

Totals of included lines: Dr ${money(totals.debit)} / Cr ${money(totals.credit)} — ${Math.abs(diff) < 0.005 ? 'balanced' : `OUT OF BALANCE by ${money(Math.abs(diff))}`}
Opening date: ${body.openingDate ?? '(not set)'}
Scope: ${body.scope === 'bs' ? 'balance sheet only' : body.scope === 'all' ? 'full trial balance' : 'profit & loss only'}
${body.note ? `\nExtraction note shown to the user: ${body.note}` : ''}`;

  const tool: Anthropic.Tool = {
    name: 'propose_changes',
    description: 'Propose changes to the opening-balance lines. The user reviews and approves them before anything is applied — never assume a change has taken effect. Only call this when the user has asked for a change; answer questions in plain text instead.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One short sentence describing the change, shown on the approval card.' },
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['include_line', 'exclude_line', 'update_line', 'add_line', 'remove_line', 'set_opening_date', 'set_scope'] },
              key: { type: 'string', description: 'The [key] of an existing line — required for include_line, exclude_line, update_line and remove_line.' },
              account_id: { type: 'string', description: 'Chart-of-accounts id to assign (update_line / add_line).' },
              new_account: {
                type: 'object',
                description: 'Create a new chart-of-accounts entry and use it. Only when no existing account fits — the user approves the creation along with the change.',
                properties: {
                  name: { type: 'string' },
                  ledger: { type: 'string', description: `Must be one of the book's existing ledgers: ${ledgers.join(', ')}` },
                  account_type: { type: 'string', enum: ACCOUNT_TYPES as unknown as string[] },
                },
                required: ['name', 'ledger', 'account_type'],
              },
              label: { type: 'string', description: 'Narrative for the line (update_line / add_line).' },
              debit: { type: 'number', description: 'Debit amount. A line is one-sided — set debit or credit, not both.' },
              credit: { type: 'number', description: 'Credit amount.' },
              section: { type: 'string', enum: ['bs', 'pl'], description: 'Which half of the trial balance an added line belongs to.' },
              date: { type: 'string', description: 'YYYY-MM-DD, for set_opening_date.' },
              scope: { type: 'string', enum: SCOPES as unknown as string[], description: 'For set_scope: bs = balance sheet only, all = full trial balance, pl = profit & loss only.' },
            },
            required: ['op'],
          },
        },
      },
      required: ['summary', 'ops'],
    },
  };

  const systemPrompt = `You are SMITH, an expert UK bookkeeper, helping an accountant review a set of OPENING BALANCES extracted from a client's trial balance or accounts before they are posted as a single opening journal.

You are talking to a qualified accountant. Be brief and direct — a couple of sentences is usually right. No preamble, no restating what they just said. Use plain figures (1,234.56), and dd-mm-yyyy for dates in your prose.

WHAT YOU CAN DO
- Answer questions about the extraction and the accounting treatment.
- Propose changes by calling propose_changes. The user then approves or rejects them; nothing you propose takes effect on its own, so never say a change is done — say what you have proposed.
- When the user answers a query you (or the extraction note) raised, just confirm it and move on. Don't keep asking.

WHAT YOU MUST NOT DO
- Never invent figures. Every amount must come from the lines listed below or from the user's own instruction.
- Never post anything. The user posts the journal themselves.

THE SCOPE RULES — this is the crux of the job
Every line of the source document was extracted, tagged 'bs' or 'pl'. Excluded lines are still there, switched off.
- Balance sheet only ('bs') is the normal migration: the client's books are moving to SMITH, so the opening position is the closing balance sheet. P&L nominals are excluded, and their NET RESULT is carried to retained earnings as one roll-up line — that is what turns the brought-forward reserve into the closing reserve. Without it a full-year trial balance cannot balance.
- Full trial balance ('all') suits the case where the book's first period covers the document's period and the year's trading should live in SMITH.
- P&L only ('pl') needs a contra to retained earnings, since the nominals alone never balance.
If the user asks to include the income and expenses, use set_scope with 'all' — that switches every P&L line back on in one operation and removes the roll-up line, rather than dozens of include_line ops.

BOOK
${book.name} — ${BOOK_TEMPLATE_LABEL[book.template_type as keyof typeof BOOK_TEMPLATE_LABEL] ?? book.template_type}${book.vat_registered ? ' · VAT registered' : ''}${book.first_period_start ? ` · first period starts ${book.first_period_start}` : ''}

CHART OF ACCOUNTS (use these exact ids)
${coaText}

CURRENT PROPOSAL
${stateText}`;

  let anthropic: Anthropic;
  try { anthropic = await getAnthropicForFirm(ctx.firmId); }
  catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] opening-balances chat anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      tools: [tool],
      messages: body.messages.map(m => ({ role: m.role, content: m.content })),
    });
    await supabase.from('ai_logs').insert({
      user_id: ctx.userId, client_id: null, feature: 'opening_balances_chat',
      input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null,
    });
  } catch (err) {
    console.error('[bookkeeping] opening-balances chat failed', err);
    return NextResponse.json({ error: 'SMITH hit a problem answering. Please try again.' }, { status: 500 });
  }

  const reply = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())
    .filter(Boolean)
    .join('\n\n');

  const toolUse = message.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
  const raw = toolUse?.input as { summary?: string; ops?: Array<Record<string, unknown>> } | undefined;

  // ── Validate the proposal against reality ──────────────────────────────────
  // The user only ever sees operations we can actually carry out: real line
  // keys, real account ids, sane amounts. Anything else is dropped rather than
  // shown as an approvable change that would then silently do nothing.
  const lineKeys = new Set(body.lines.map(l => l.key));
  const ops: Array<Record<string, unknown>> = [];
  const num = (v: unknown) => {
    const n = Number(v);
    return isFinite(n) && n > 0 ? +n.toFixed(2) : 0;
  };

  for (const o of raw?.ops ?? []) {
    const op = String(o.op ?? '');
    const key = typeof o.key === 'string' ? o.key : null;
    const needsKey = ['include_line', 'exclude_line', 'update_line', 'remove_line'].includes(op);
    if (needsKey && (!key || !lineKeys.has(key))) continue;

    const accountId = typeof o.account_id === 'string' && accountIds.has(o.account_id) ? o.account_id : null;
    const na = (o.new_account && typeof o.new_account === 'object') ? o.new_account as Record<string, unknown> : null;
    const newAccount = na
      && typeof na.name === 'string' && na.name.trim()
      && typeof na.ledger === 'string' && na.ledger.trim()
      && (ACCOUNT_TYPES as readonly string[]).includes(String(na.account_type))
      ? { name: String(na.name).trim(), ledger: String(na.ledger).trim(), account_type: String(na.account_type) }
      : null;

    // One-sided amounts, mirroring the grid's own rule.
    const debit = num(o.debit);
    const credit = num(o.credit);
    const sided = debit >= credit ? { debit, credit: 0 } : { debit: 0, credit };

    switch (op) {
      case 'include_line':
      case 'exclude_line':
      case 'remove_line':
        ops.push({ op, key });
        break;
      case 'update_line': {
        const patch: Record<string, unknown> = { op, key };
        if (accountId) patch.account_id = accountId;
        if (!accountId && newAccount) patch.new_account = newAccount;
        if (typeof o.label === 'string' && o.label.trim()) patch.label = o.label.trim().slice(0, 200);
        if (debit > 0 || credit > 0) Object.assign(patch, sided);
        // Nothing beyond the key → no actual change.
        if (Object.keys(patch).length > 2) ops.push(patch);
        break;
      }
      case 'add_line': {
        if (debit === 0 && credit === 0) break;
        if (!accountId && !newAccount) break;
        ops.push({
          op, ...sided,
          account_id: accountId,
          new_account: accountId ? null : newAccount,
          label: typeof o.label === 'string' ? o.label.trim().slice(0, 200) : '',
          section: o.section === 'pl' ? 'pl' : 'bs',
        });
        break;
      }
      case 'set_opening_date': {
        const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
        if (date) ops.push({ op, date });
        break;
      }
      case 'set_scope': {
        if ((SCOPES as readonly string[]).includes(String(o.scope))) ops.push({ op, scope: String(o.scope) });
        break;
      }
      default:
        break;
    }
  }

  const proposal = ops.length > 0
    ? { summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 300) : 'Proposed changes', ops }
    : null;

  return NextResponse.json({
    reply: reply || (proposal ? proposal.summary : 'I didn’t catch that — could you rephrase?'),
    proposal,
  });
}
