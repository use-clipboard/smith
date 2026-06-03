import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { loadLedgerSchedule } from '@/lib/bookkeeping/depreciationServer';
import { depreciationNoun } from '@/lib/bookkeeping/fixedAssets';
import type { TransactionType } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/review ──────────────────────────────────
// AI-assisted book health-check. Signals are computed DETERMINISTICALLY in code
// (exact, auditable, linkable to the source row); Claude then adds plain-English
// "why it matters / what to do" notes and an overall assessment. The AI never
// does the arithmetic and nothing is ever auto-posted.
//
// v1 checks: suspense/unallocated balances · possible duplicate transactions ·
// overdrawn bank accounts. Body: { from?, to? } (ISO) — scopes to the period.

type Severity = 'high' | 'medium' | 'low';
type Category = 'suspense' | 'bank' | 'duplicate' | 'depreciation' | 'reconciliation' | 'balances';
interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  /** Source account (for account-based findings) — drives the ledger link. */
  account?: { id: string; name: string; ledger: string | null };
  /** Source transactions (for the duplicate finding) — drives the ref links. */
  refTxns?: { id: string; type: TransactionType; ref_no: string }[];
  /** Linked accounts + amounts (e.g. the customers/suppliers with balances). */
  items?: { account: { id: string; name: string; ledger: string | null }; amount: number }[];
}

const r2 = (n: number) => +n.toFixed(2);
function gbp(n: number): string {
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { from?: string; to?: string };
  const from = body.from && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : null;
  const to = body.to && /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : null;

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, firm_id, vat_registered')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  // ── Aggregate balances per account over the period (mirrors /balances) ──────
  const PAGE = 1000;
  type SplitRow = {
    debit: number; credit: number;
    account: { id: string; name: string; ledger: string | null; account_type: string } | null;
  };
  type Agg = { id: string; name: string; ledger: string | null; account_type: string; debit: number; credit: number };
  const byAccount = new Map<string, Agg>();
  let pageStart = 0;
  while (true) {
    let q = supabase
      .from('bookkeeping_transaction_splits')
      .select(`debit, credit,
        account:bookkeeping_accounts!inner(id, name, ledger, account_type, book_id),
        transaction:bookkeeping_transactions!inner(date, book_id)`)
      .eq('account.book_id', params.id)
      .eq('transaction.book_id', params.id)
      .range(pageStart, pageStart + PAGE - 1);
    if (from) q = q.gte('transaction.date', from);
    if (to) q = q.lte('transaction.date', to);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const row of data as unknown as SplitRow[]) {
      if (!row.account) continue;
      const a = byAccount.get(row.account.id) ?? { id: row.account.id, name: row.account.name, ledger: row.account.ledger, account_type: row.account.account_type, debit: 0, credit: 0 };
      a.debit = r2(a.debit + Number(row.debit));
      a.credit = r2(a.credit + Number(row.credit));
      byAccount.set(row.account.id, a);
    }
    if (data.length < PAGE) break;
    pageStart += PAGE;
  }
  const accounts = [...byAccount.values()].map(a => ({ ...a, balance: r2(a.debit - a.credit) }));

  const findings: Finding[] = [];

  // 1) Suspense / unallocated balances.
  for (const a of accounts) {
    if (/suspense|unalloc/i.test(a.name) && Math.abs(a.balance) >= 0.01) {
      findings.push({
        id: `suspense:${a.id}`, category: 'suspense', severity: 'high',
        title: `${a.ledger ? a.ledger + ': ' : ''}${a.name} has a balance of ${gbp(a.balance)}`,
        detail: `A holding/suspense account should normally clear to nil. ${gbp(a.balance)} is sitting here and likely needs reallocating to the correct account.`,
        account: { id: a.id, name: a.name, ledger: a.ledger },
      });
    }
  }

  // 2) Overdrawn bank accounts.
  for (const a of accounts) {
    if (a.ledger === 'Bank' && a.balance < -0.01) {
      findings.push({
        id: `bank:${a.id}`, category: 'bank', severity: 'high',
        title: `${a.name} is overdrawn by ${gbp(a.balance)}`,
        detail: `This bank account shows a credit (overdrawn) balance of ${gbp(a.balance)} at the period end. Check for missing receipts, a misposted payment, or an unrecorded transfer.`,
        account: { id: a.id, name: a.name, ledger: a.ledger },
      });
    }
  }

  // 3) Possible duplicate transactions (same date + total + payee/details).
  let txQ = supabase
    .from('bookkeeping_transactions')
    .select('id, type, ref_no, date, total, payee_text, details')
    .eq('book_id', params.id)
    .eq('status', 'posted');
  if (from) txQ = txQ.gte('date', from);
  if (to) txQ = txQ.lte('date', to);
  const { data: txns } = await txQ;
  type TxnLite = { id: string; type: TransactionType; ref_no: string; date: string; total: number; payee_text: string | null; details: string | null };
  const groups = new Map<string, { txns: { id: string; type: TransactionType; ref_no: string }[]; total: number; label: string }>();
  for (const t of (txns ?? []) as TxnLite[]) {
    const total = Number(t.total);
    if (!total) continue;
    const label = (t.payee_text || t.details || '').trim();
    const key = `${t.date}|${total.toFixed(2)}|${label.toLowerCase()}`;
    const g = groups.get(key) ?? { txns: [], total, label: label || '(no description)' };
    g.txns.push({ id: t.id, type: t.type, ref_no: t.ref_no });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.txns.length > 1) {
      const refList = g.txns.map(t => t.ref_no).join(', ');
      findings.push({
        id: `dup:${g.txns.map(t => t.ref_no).join(',')}`, category: 'duplicate', severity: 'medium',
        title: `${g.txns.length} identical entries — ${g.label} (${gbp(g.total)})`,
        detail: `${refList} share the same date, amount and description. This is often a genuine repeat, but worth checking it isn't a double-entry.`,
        refTxns: g.txns,
      });
    }
  }

  // 4) Unreconciled bank items — splits on a Bank account not cleared in a rec.
  const bankAccts = accounts.filter(a => a.ledger === 'Bank');
  if (bankAccts.length > 0) {
    const bankIds = bankAccts.map(a => a.id);
    const uncleared = new Map<string, number>();
    let rs = 0;
    while (true) {
      let urq = supabase
        .from('bookkeeping_transaction_splits')
        .select('account_id, transaction:bookkeeping_transactions!inner(date, book_id)')
        .in('account_id', bankIds)
        .is('cleared_in_rec_id', null)
        .eq('transaction.book_id', params.id)
        .range(rs, rs + PAGE - 1);
      if (from) urq = urq.gte('transaction.date', from);
      if (to) urq = urq.lte('transaction.date', to);
      const { data: urd, error: ure } = await urq;
      if (ure || !urd || urd.length === 0) break;
      for (const row of urd as unknown as { account_id: string }[]) {
        uncleared.set(row.account_id, (uncleared.get(row.account_id) ?? 0) + 1);
      }
      if (urd.length < PAGE) break;
      rs += PAGE;
    }
    for (const ba of bankAccts) {
      const n = uncleared.get(ba.id) ?? 0;
      if (n > 0) {
        findings.push({
          id: `rec:${ba.id}`, category: 'reconciliation', severity: 'medium',
          title: `${ba.name}: ${n} transaction${n === 1 ? '' : 's'} not reconciled`,
          detail: `These bank entries haven't been ticked off against a statement. Reconcile them on the Bank tab so the balance is verified.`,
          account: { id: ba.id, name: ba.name, ledger: ba.ledger },
        });
      }
    }
  }

  // 5) Depreciation / amortisation due but not posted (needs a period scope).
  if (from && to) {
    const { data: faAccts } = await supabase
      .from('bookkeeping_accounts').select('ledger').eq('book_id', params.id).like('ledger', 'FA -%');
    const faLedgers = [...new Set((faAccts ?? []).map(a => (a as { ledger: string }).ledger))];
    for (const ledger of faLedgers) {
      try {
        const sched = await loadLedgerSchedule(supabase, params.id, ledger, from, to);
        const chargeable = sched.rows.filter(r => r.periodCharge > 0.005);
        const unposted = chargeable.filter(r => !r.posted);
        if (chargeable.length > 0 && unposted.length > 0) {
          const noun = depreciationNoun(ledger).toLowerCase();
          const due = r2(unposted.reduce((s, r) => s + r.periodCharge, 0));
          findings.push({
            id: `depn:${ledger}`, category: 'depreciation', severity: 'high',
            title: `${ledger}: ${noun} not posted (${unposted.length} of ${chargeable.length} asset${chargeable.length === 1 ? '' : 's'})`,
            detail: `${gbp(due)} of ${noun} is due for this period but hasn't been posted. Post it from the Fixed Assets tab.`,
          });
        }
      } catch (e) {
        console.error('[bookkeeping] review depreciation check failed', ledger, e);
      }
    }
  }

  // 6) Customers / suppliers carrying outstanding balances.
  for (const ledger of ['Customers', 'Suppliers'] as const) {
    const withBal = accounts
      .filter(a => a.ledger === ledger && Math.abs(a.balance) >= 0.01)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    if (withBal.length === 0) continue;
    const net = r2(withBal.reduce((s, a) => s + a.balance, 0));
    const noun = ledger === 'Customers' ? 'customer' : 'supplier';
    findings.push({
      id: `bal:${ledger}`, category: 'balances', severity: 'low',
      title: `${withBal.length} ${noun}${withBal.length === 1 ? '' : 's'} with an outstanding balance (net ${gbp(net)})`,
      detail: `Open ${noun} balances at the period end — cross-check against the aged ${ledger === 'Customers' ? 'debtors' : 'creditors'} report.`,
      items: withBal.map(a => ({ account: { id: a.id, name: a.name, ledger: a.ledger }, amount: a.balance })),
    });
  }

  // ── Book summary for the AI's overall assessment ────────────────────────────
  const sum = (pred: (a: typeof accounts[number]) => boolean) => r2(accounts.filter(pred).reduce((s, a) => s + a.balance, 0));
  const income = sum(a => a.account_type === 'income');
  const expense = sum(a => a.account_type === 'expense');
  const summary = {
    period: from && to ? `${from} to ${to}` : 'whole book',
    netProfit: r2(-income - expense), // income balance is negative (Cr), expense positive (Dr)
    accountsWithActivity: accounts.length,
    vatRegistered: book.vat_registered,
  };

  // ── AI layer: overview + per-finding notes + extra observations ─────────────
  let overview = '';
  let notes: Record<string, string> = {};
  let observations: string[] = [];
  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const systemPrompt = `You are an assistant to a UK accountancy practice reviewing a client's bookkeeping. You are given (a) a set of issues already detected deterministically by the system, and (b) a short summary of the book. Your job is to add professional judgement — NOT to do any arithmetic or invent figures.

Return ONLY valid JSON (no markdown fences) in this shape:
{
  "overview": "2-3 sentence plain-English assessment of the book's health for this period",
  "notes": { "<finding id>": "one sentence: why it matters and the suggested fix" },
  "observations": ["up to 3 extra things worth checking, based ONLY on the summary provided — e.g. unusually thin/large figures. Omit if nothing stands out."]
}
Use British English. Be specific and practical. Do not repeat the finding's title verbatim in its note. Do not invent issues that aren't supported by the data given.`;
    const userPrompt = `Book: ${book.name}
Summary: ${JSON.stringify(summary)}

Detected issues:
${findings.length ? findings.map(f => `- [${f.id}] (${f.severity}) ${f.title}`).join('\n') : '(none detected by the automated checks)'}

Return the JSON.`;
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) as {
      overview?: string; notes?: Record<string, string>; observations?: string[];
    };
    overview = parsed.overview ?? '';
    notes = parsed.notes ?? {};
    observations = Array.isArray(parsed.observations) ? parsed.observations.filter(o => typeof o === 'string') : [];
    await supabase.from('ai_logs').insert({
      user_id: ctx.userId, client_id: null, feature: 'book_review',
      input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null,
    });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    // Non-fatal: still return the deterministic findings without the AI prose.
    console.error('[bookkeeping] book review AI step failed', err);
  }

  // Merge AI notes onto the deterministic findings (notes are advisory only).
  const enriched = findings
    .map(f => ({ ...f, note: notes[f.id] ?? '' }))
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));

  return NextResponse.json({
    overview,
    findings: enriched,
    observations,
    generatedAt: new Date().toISOString(),
    period: summary.period,
  });
}
