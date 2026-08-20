import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/tax-studio/ct600/accounts-chat ─────────────────────────────────
// "Import from Accounts Studio" — chat to SMITH alongside the mapping of a
// limited company's statutory accounts into the CT600 trading-profits
// computation. The accountant can interrogate the figures ("why add back the
// depreciation?"), correct them in words ("the entertaining is all client
// entertaining — disallow it") and have SMITH restate the mapping.
//
// SMITH PROPOSES, THE USER APPLIES. This route never writes anything: it returns
// a reply plus an optional proposal (a set of {field, value} changes). The modal
// renders the proposal as an approval card; only on the user's click does the
// mapping change, and only "Apply to return" writes it into the CT600.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The Ct600Trading keys SMITH may map into. Kept in lock-step with the
// Ct600Trading interface in components/features/tax-studio/types.ts.
const TRADING_FIELDS = [
  'turnover', 'profitPerAccount', 'addBack', 'adjustments', 'disallowableExpenses',
  'rdOrFilmsExpenditure', 'incomeNotCredited', 'balancingCharges', 'rdec', 'avec',
  'vgec', 'incomeNotAssessed', 'expenditureNotInAccounts', 'rdOrFilmsRelief',
  'capitalAllowances', 'rdFilmsTaxCreditSurrender',
] as const;
type TradingField = (typeof TRADING_FIELDS)[number];
const TRADING_FIELD_SET = new Set<string>(TRADING_FIELDS);

const FIELD_LABELS: Record<TradingField, string> = {
  turnover: 'Turnover',
  profitPerAccount: 'Profit/(loss) per account',
  addBack: 'Add Back',
  adjustments: 'Adjustments',
  disallowableExpenses: 'Disallowable Expenses',
  rdOrFilmsExpenditure: 'R&D or Films Expenditure',
  incomeNotCredited: 'Income not credited to profit but assessable',
  balancingCharges: 'Balancing Charges',
  rdec: 'Taxable R&D Expenditure Credit (RDEC)',
  avec: 'Taxable Audio Visual Expenditure Credit (AVEC)',
  vgec: 'Taxable Video Games Expenditure Credit (VGEC)',
  incomeNotAssessed: 'Income/(deficit) not assessed under trading profits',
  expenditureNotInAccounts: 'Expenditure not in accounts but allowable',
  rdOrFilmsRelief: 'R&D or Films Relief',
  capitalAllowances: 'Capital Allowances',
  rdFilmsTaxCreditSurrender: 'R&D/Films Tax Credit — amount to surrender',
};

const Body = z.object({
  accounts: z.object({
    turnover: z.number(),
    netProfit: z.number(),
    periodStart: z.string(),
    periodEnd: z.string(),
    lines: z.array(z.object({
      label: z.string(),
      amount: z.number(),
      section: z.enum(['income', 'expense']),
    })).max(400),
  }),
  mapping: z.record(z.string(), z.number()),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(8000),
  })).min(1).max(30),
});

const money = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) {
    return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const { accounts, mapping } = body;

  // ── Render the accounts + current mapping for the model ─────────────────────
  const incomeLines = accounts.lines.filter(l => l.section === 'income');
  const expenseLines = accounts.lines.filter(l => l.section === 'expense');
  const renderLines = (lines: typeof accounts.lines) =>
    lines.length ? lines.map(l => `  - ${l.label}: ${money(l.amount)}`).join('\n') : '  (none)';

  const mappingText = TRADING_FIELDS
    .map(f => `  - ${FIELD_LABELS[f]} (${f}): ${money(mapping[f] ?? 0)}`)
    .join('\n');

  const accountsText = `ACCOUNTS PERIOD: ${accounts.periodStart} to ${accounts.periodEnd}
Turnover: ${money(accounts.turnover)}
Net profit per accounts: ${money(accounts.netProfit)}

INCOME LINES:
${renderLines(incomeLines)}

EXPENSE LINES:
${renderLines(expenseLines)}

CURRENT MAPPING INTO THE CT600 TRADING BOXES:
${mappingText}`;

  const tool: Anthropic.Tool = {
    name: 'propose_changes',
    description: 'Propose changes to the CT600 trading-box mapping. The user reviews and approves them before anything is applied — never assume a change has taken effect. Only call this when the user has asked for a change; answer questions in plain text otherwise.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One short sentence describing the change, shown on the approval card.' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: TRADING_FIELDS as unknown as string[], description: 'The CT600 trading box to set.' },
              value: { type: 'number', description: 'The amount to set the box to.' },
            },
            required: ['field', 'value'],
          },
        },
      },
      required: ['summary', 'changes'],
    },
  };

  const systemPrompt = `You are SMITH, a UK corporation-tax specialist, helping an accountant map a limited company's statutory accounts into the CT600 trading-profits computation.

You are talking to a qualified accountant. Be brief and direct — a couple of sentences is usually right. No preamble, no restating what they just said. Use plain figures (1,234.56), and dd-mm-yyyy for dates in your prose.

THE COMPUTATION
Taxable trading profit = profit per accounts + add-backs (disallowable expenses such as depreciation, client entertaining, non-deductible provisions, and other items not allowable for tax) − capital allowances. The accounts figures are the starting point; the tax adjustments turn them into the taxable trading profit.

WHAT YOU CAN DO
- Answer questions about the figures and the tax treatment.
- Propose changes by calling propose_changes. The user then approves or rejects them; nothing you propose takes effect on its own, so never say a change is done — say what you have proposed.
- Ask about anything ambiguous. For example: if there is depreciation in the expenses, ask whether to add it back as a disallowable; flag that capital allowances need the separate capital-allowances calculation and should not simply be guessed.

WHAT YOU MUST NOT DO
- Never invent figures. Every amount must come from the accounts lines above or from the user's own instruction.
- Never apply or post anything. The user approves each change and applies it themselves.

${accountsText}`;

  let anthropic: Anthropic;
  try { anthropic = await getAnthropicForFirm(ctx.firmId); }
  catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[tax-studio] ct600 accounts-chat anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  const supabase = createServiceClient();

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
      user_id: ctx.userId, client_id: null, feature: 'ct600_accounts_chat',
      input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null,
    });
  } catch (err) {
    console.error('[tax-studio] ct600 accounts-chat failed', err);
    return NextResponse.json({ error: 'SMITH hit a problem answering. Please try again.' }, { status: 500 });
  }

  const reply = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())
    .filter(Boolean)
    .join('\n\n');

  const toolUse = message.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
  const raw = toolUse?.input as { summary?: string; changes?: Array<Record<string, unknown>> } | undefined;

  // ── Validate the proposal against reality ───────────────────────────────────
  // Only surface changes we can actually carry out: known Ct600Trading keys with
  // finite numeric values. Anything else is dropped rather than shown as an
  // approvable change that would then silently do nothing.
  const changes: Array<{ field: TradingField; value: number }> = [];
  for (const c of raw?.changes ?? []) {
    const field = typeof c.field === 'string' ? c.field : '';
    if (!TRADING_FIELD_SET.has(field)) continue;
    const value = Number(c.value);
    if (!Number.isFinite(value)) continue;
    changes.push({ field: field as TradingField, value: +value.toFixed(2) });
  }

  const proposal = changes.length > 0
    ? { summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 300) : 'Proposed changes', changes }
    : null;

  return NextResponse.json({
    reply: reply || (proposal ? proposal.summary : 'I didn’t catch that — could you rephrase?'),
    proposal,
  });
}
