import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/bookkeeping/books/[id]/vat-return/review ───────────────────────
// AI sanity-check of a VAT return before filing. The client sends the computed
// 9-box figures + a per-rate breakdown summary (no raw rows). We run a few
// DETERMINISTIC arithmetic guards in code, then Claude reviews the figures for
// the kind of things a reviewer eyeballs before submission — effective VAT
// rates that look off, repayment returns, EU/reverse-charge boxes, late
// entries, sales with no output VAT, etc. Advisory only; nothing is filed here.

type Severity = 'high' | 'medium' | 'low';
interface Finding { id: string; severity: Severity; title: string; detail: string; note?: string }

const RateRow = z.object({ rate: z.number(), net: z.number(), vat: z.number(), count: z.number() });
const Side = z.object({ count: z.number(), net: z.number(), vat: z.number(), rates: z.array(RateRow).max(20) });
const Body = z.object({
  from: z.string(),
  to: z.string(),
  vat_scheme: z.string().nullable().optional(),
  vat_registered: z.boolean().optional(),
  boxes: z.object({
    box1: z.number(), box2: z.number(), box3: z.number(), box4: z.number(), box5: z.number(),
    box6: z.number(), box7: z.number(), box8: z.number(), box9: z.number(),
  }),
  late_entry_vat: z.number().default(0),
  outputs: Side,
  inputs: Side,
});

const r2 = (n: number) => +Number(n).toFixed(2);
const gbp = (n: number) => `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Period P&L (for gross/net margin) ─────────────────────────────────────────
interface PeriodPnl { revenue: number; costOfSales: number; grossProfit: number; netProfit: number; gpPct: number | null; npPct: number | null }

async function computePnl(
  supabase: ReturnType<typeof createClient>, bookId: string, from: string, to: string,
): Promise<PeriodPnl> {
  const PAGE = 1000;
  type Row = { debit: number; credit: number; account: { account_type: string; ledger: string | null } | null };
  let revenue = 0, costOfSales = 0, expense = 0, start = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bookkeeping_transaction_splits')
      .select(`debit, credit,
        account:bookkeeping_accounts!inner(account_type, ledger, book_id),
        transaction:bookkeeping_transactions!inner(date, type, book_id)`)
      .eq('account.book_id', bookId)
      .eq('transaction.book_id', bookId)
      .gte('transaction.date', from)
      .lte('transaction.date', to)
      .not('transaction.type', 'in', '(YET)') // exclude year-end close so the P&L shows trading
      .range(start, start + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      if (!r.account) continue;
      const bal = Number(r.debit) - Number(r.credit);
      if (r.account.account_type === 'income') revenue += -bal;
      else if (r.account.account_type === 'expense') {
        expense += bal;
        if ((r.account.ledger ?? '').toLowerCase() === 'cost of sales') costOfSales += bal;
      }
    }
    if (rows.length < PAGE) break;
    start += PAGE;
  }
  revenue = r2(revenue); costOfSales = r2(costOfSales); expense = r2(expense);
  const grossProfit = r2(revenue - costOfSales);
  const netProfit = r2(revenue - expense);
  return {
    revenue, costOfSales, grossProfit, netProfit,
    gpPct: revenue > 0 ? r2((grossProfit / revenue) * 100) : null,
    npPct: revenue > 0 ? r2((netProfit / revenue) * 100) : null,
  };
}

function monthLabel(periodTo: string): string {
  const d = new Date(`${periodTo}T00:00:00Z`);
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${mon} ${String(d.getUTCFullYear()).slice(-2)}`;
}

interface ComparisonPeriod {
  label: string; from: string; to: string;
  sales: number; netVat: number;
  revenue: number; costOfSales: number; grossProfit: number; netProfit: number;
  gpPct: number | null; npPct: number | null; isCurrent: boolean;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id, vat_registered, vat_scheme')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  const b = body.boxes;
  const findings: Finding[] = [];

  // ── Deterministic arithmetic guards ─────────────────────────────────────────
  if (Math.abs(r2(b.box1 + b.box2) - r2(b.box3)) > 0.01) {
    findings.push({ id: 'box3', severity: 'high', title: `Box 3 doesn't equal Box 1 + Box 2`, detail: `Box 3 (${gbp(b.box3)}) should be Box 1 (${gbp(b.box1)}) + Box 2 (${gbp(b.box2)}) = ${gbp(r2(b.box1 + b.box2))}.` });
  }
  if (Math.abs(r2(b.box3 - b.box4) - r2(b.box5)) > 0.01) {
    findings.push({ id: 'box5', severity: 'high', title: `Box 5 doesn't equal Box 3 − Box 4`, detail: `Box 5 (${gbp(b.box5)}) should be Box 3 (${gbp(b.box3)}) − Box 4 (${gbp(b.box4)}) = ${gbp(r2(b.box3 - b.box4))}.` });
  }

  // ── Quarter-on-quarter comparison: this return + up to 3 prior filed returns ─
  const comparison: ComparisonPeriod[] = [];
  try {
    const { data: priors } = await supabase
      .from('bookkeeping_vat_returns')
      .select('period_from, period_to, box5, box6')
      .eq('book_id', params.id)
      .lt('period_to', body.to)
      .order('period_to', { ascending: false })
      .limit(3);
    const ordered = [...(priors ?? [])].reverse(); // oldest first
    for (const p of ordered) {
      const pnl = await computePnl(supabase, params.id, p.period_from as string, p.period_to as string);
      comparison.push({ label: monthLabel(p.period_to as string), from: p.period_from as string, to: p.period_to as string, sales: Number(p.box6), netVat: Number(p.box5), isCurrent: false, ...pnl });
    }
    const cur = await computePnl(supabase, params.id, body.from, body.to);
    comparison.push({ label: monthLabel(body.to), from: body.from, to: body.to, sales: b.box6, netVat: b.box5, isCurrent: true, ...cur });
  } catch (err) {
    console.error('[bookkeeping] vat review comparison failed', err);
  }

  // ── AI review of the figures ────────────────────────────────────────────────
  let overview = '';
  let notes: Record<string, string> = {};
  let observations: string[] = [];
  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const tool: Anthropic.Tool = {
      name: 'return_vat_review',
      description: 'Return a pre-filing review of the VAT return figures.',
      input_schema: {
        type: 'object',
        properties: {
          overview: { type: 'string', description: '2-3 sentence plain-English assessment of whether the return looks reasonable to file.' },
          notes: { type: 'object', description: 'Optional map of detected-finding id → one-sentence note.' },
          findings: {
            type: 'array',
            description: 'Issues or things to verify before filing. Omit if the return looks clean.',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                title: { type: 'string' },
                detail: { type: 'string', description: 'One or two sentences: what looks off and what to check.' },
              },
              required: ['severity', 'title', 'detail'],
            },
          },
          observations: { type: 'array', items: { type: 'string' }, description: 'Up to 3 extra things worth checking.' },
        },
        required: ['overview'],
      },
    };

    const effOut = body.outputs.net > 0 ? r2((b.box1 / body.outputs.net) * 100) : null;
    const effIn = body.inputs.net > 0 ? r2((b.box4 / body.inputs.net) * 100) : null;
    const systemPrompt = `You are a UK VAT specialist reviewing a client's VAT return BEFORE it is filed with HMRC. You are given the computed 9-box figures and a per-rate breakdown. Sanity-check them like an experienced reviewer — do NOT recompute or invent figures.

Look for, where the data supports it:
- Effective output VAT rate (Box 1 ÷ Box 6) or input rate (Box 4 ÷ Box 7) that looks wrong for a standard-rated business (e.g. far below 20% suggests miscoded VAT, zero-rating, or exempt supplies — worth confirming).
- A repayment return (Box 4 > Box 1 / negative Box 5) — flag so the user expects a refund and checks it's genuine.
- Sales with little or no output VAT (Box 6 large, Box 1 ~0) — confirm the zero/exempt treatment is right.
- Non-zero Box 2/8/9 (EU acquisitions/supplies) or reverse-charge — verify these are intended.
- Late entries from earlier periods included (carried VAT) — note they're in this return.
- Unusually round figures, or one rate dominating unexpectedly.
- TRENDS across the quarters (when prior returns are given): movements in sales, net VAT, and especially gross-profit % and net-profit %. Call out a margin that has moved materially (e.g. gross margin down several points) and what it might indicate (pricing, cost creep, miscoding, stock movements). Put the headline trend in the overview.
Be specific and practical, British English. Don't restate the arithmetic guards already listed. Don't raise issues the figures don't support.

Call return_vat_review.`;

    const userPrompt = `Book: ${book.name}
Period: ${body.from} to ${body.to}
VAT scheme: ${body.vat_scheme ?? book.vat_scheme ?? 'standard'}
Boxes: ${JSON.stringify(b)}
Late-entry VAT included: ${body.late_entry_vat}
Effective output rate (Box1/Box6): ${effOut === null ? 'n/a' : effOut + '%'}
Effective input rate (Box4/Box7): ${effIn === null ? 'n/a' : effIn + '%'}
Outputs: ${JSON.stringify(body.outputs)}
Inputs: ${JSON.stringify(body.inputs)}
Arithmetic guards already flagged: ${findings.length ? findings.map(f => f.id).join(', ') : '(none)'}

Quarter-on-quarter (oldest → newest; last row is this return):
${comparison.length > 1
  ? comparison.map(p => `${p.label}${p.isCurrent ? ' (this return)' : ''}: Sales ${gbp(p.sales)} · Revenue ${gbp(p.revenue)} · Gross profit ${gbp(p.grossProfit)} (GP% ${p.gpPct === null ? 'n/a' : p.gpPct + '%'}) · Net profit ${gbp(p.netProfit)} (NP% ${p.npPct === null ? 'n/a' : p.npPct + '%'}) · Net VAT ${gbp(p.netVat)}`).join('\n')
  : '(no prior filed returns to compare against)'}

Review the return.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'return_vat_review' },
      messages: [{ role: 'user', content: userPrompt }],
    });
    await supabase.from('ai_logs').insert({
      user_id: ctx.userId, client_id: null, feature: 'vat_review',
      input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null,
    });
    const tu = message.content.find(x => x.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    const parsed = (tu?.input ?? {}) as { overview?: string; notes?: Record<string, string>; findings?: Finding[]; observations?: string[] };
    overview = parsed.overview ?? '';
    notes = parsed.notes ?? {};
    observations = Array.isArray(parsed.observations) ? parsed.observations.filter(o => typeof o === 'string').slice(0, 3) : [];
    // Merge the AI's own findings in (after the deterministic guards).
    if (Array.isArray(parsed.findings)) {
      parsed.findings.forEach((f, i) => {
        if (f && f.title && f.detail && ['high', 'medium', 'low'].includes(f.severity)) {
          findings.push({ id: `ai${i}`, severity: f.severity, title: String(f.title), detail: String(f.detail) });
        }
      });
    }
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] vat review AI step failed', err);
    // Non-fatal: still return the deterministic guards.
  }

  const enriched = findings
    .map(f => ({ ...f, note: notes[f.id] ?? '' }))
    .sort((a, b2) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b2.severity]));

  return NextResponse.json({
    overview,
    findings: enriched,
    observations,
    comparison,
    generatedAt: new Date().toISOString(),
  });
}
