import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/bookkeeping/books/[id]/auto-allocate ─────────────────────────
// Suggests an analysis-side account for each row the user is about to post
// from a CSV import (or manual sheet). Pure rule-based for v1 — AI fallback
// lands in phase 3.
//
// Rule chain, in order of confidence:
//
//   1. Open Supplier/Customer balance match
//      For PAY  → search Suppliers with positive (creditor) balance whose
//                 name overlaps the payee text. If the outstanding balance
//                 matches the row's gross amount → high confidence; if a
//                 named match exists but amount differs → medium.
//      For REC  → same but Customers (debtor balance).
//
//   2. Past-payee match (most-recent-wins)
//      Scan transactions on this bank account from the last 12 months.
//      Group by normalised payee → take the analysis account of the most
//      recent entry whose payee matches the row's payee.
//        • Exact normalised payee  → high
//        • Fuzzy (token overlap)   → medium
//        • Amount-only fallback     → low (only when nothing else matched
//                                     and the amount has only ever been
//                                     posted to one analysis account)
//
//   3. Unallocated — caller flags for manual entry.
//
// Response is one allocation per row; the caller applies them to drafts and
// shows per-row confidence indicators.

const RowSchema = z.object({
  row_id: z.string(),
  type:   z.enum(['PAY', 'REC', 'CHQ', 'TRF']),
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee:  z.string(),
  /** Signed amount, positive = money in. */
  amount: z.number(),
});

const Body = z.object({
  account_id: z.string().uuid(),
  rows:       z.array(RowSchema).min(1).max(500),
});

interface Allocation {
  row_id: string;
  analysis_account_id:   string | null;
  analysis_account_name: string | null;
  analysis_ledger:       string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  source: 'supplier_match' | 'customer_match' | 'past_payee' | 'amount_only' | 'ai' | 'unallocated';
  reasoning: string | null;
}

// ── Name-similarity helpers ────────────────────────────────────────────────
function normalize(s: string): string {
  return (s ?? '').toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenize(s: string): string[] {
  return normalize(s).split(/\s+/).filter(t => t.length >= 2);
}
/** 0-1 score. 1.0 = exact normalised match; ≥0.5 = strong overlap;
 *  ≥0.3 = weak overlap; lower = ignore. */
function nameScore(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.includes(na) || na.includes(nb)) return 0.85;
  const tokensA = tokenize(a);
  const tokensB = new Set(tokenize(b));
  if (tokensA.length === 0) return 0;
  let hits = 0;
  for (const t of tokensA) if (tokensB.has(t)) hits++;
  return hits / tokensA.length;
}

const IN_CHUNK = 200;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // ── Book + account gate ────────────────────────────────────────────────
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Fetch Suppliers + Customers accounts ──────────────────────────────
  const { data: scAccounts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger')
    .eq('book_id', params.id)
    .in('ledger', ['Suppliers', 'Customers']);

  // Skip our own bank-side splits when computing balances — those exist on
  // bank ledger accounts, not Suppliers/Customers, so the filter below is
  // sufficient. We also use the Set for fast lookup later.
  const scIds = (scAccounts ?? []).map(a => a.id);
  const scById = new Map<string, { id: string; name: string; ledger: string | null }>();
  for (const a of (scAccounts ?? [])) scById.set(a.id, a);

  // Aggregate balance per Suppliers/Customers account. Convention:
  // balanceRaw = sum(debit) - sum(credit). For Suppliers an account with
  // negative balanceRaw is a CREDITOR balance (we owe them); for Customers
  // a positive balanceRaw is a DEBTOR balance (they owe us). We normalise
  // to "outstanding" magnitude per ledger below.
  const balanceRaw = new Map<string, number>();
  for (let i = 0; i < scIds.length; i += IN_CHUNK) {
    const chunk = scIds.slice(i, i + IN_CHUNK);
    if (chunk.length === 0) break;
    // Paginate within the chunk too — a single account can have thousands
    // of splits, and Supabase caps single SELECTs at 1000 rows.
    for (let from = 0; ; from += 1000) {
      const { data: splits } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('account_id, debit, credit')
        .in('account_id', chunk)
        .range(from, from + 999);
      if (!splits || splits.length === 0) break;
      for (const s of splits) {
        const prev = balanceRaw.get(s.account_id as string) ?? 0;
        balanceRaw.set(s.account_id as string, prev + Number(s.debit) - Number(s.credit));
      }
      if (splits.length < 1000) break;
    }
  }
  /** Outstanding owed by the firm (Suppliers) or to the firm (Customers).
   *  Always returned as a positive magnitude — sign is implied by ledger. */
  function outstanding(accountId: string): number {
    const acc = scById.get(accountId);
    const raw = balanceRaw.get(accountId) ?? 0;
    if (!acc) return 0;
    if (acc.ledger === 'Suppliers') return -raw;      // creditor balance
    if (acc.ledger === 'Customers') return raw;        // debtor balance
    return 0;
  }

  // ── Build past-payee map ──────────────────────────────────────────────
  // Pull every split on the bank account from the last 12 months, then
  // resolve each transaction's analysis-side account. We do it in three
  // queries to stay defensive against PostgREST embed-filter quirks:
  //   Q1 — bank splits in the window (account_id + cleared_in_rec_id-
  //        agnostic; we want all past entries regardless of rec state)
  //   Q2 — those transactions' header info (payee_text, date)
  //   Q3 — those transactions' OTHER splits (to find the analysis side)
  const today = new Date();
  const cutoff = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
    .toISOString().slice(0, 10);

  // Q1 — bank splits (we just need their transaction_id list).
  const bankTxnIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: bankSplits } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('transaction_id')
      .eq('account_id', body.account_id)
      .range(from, from + 999);
    if (!bankSplits || bankSplits.length === 0) break;
    for (const s of bankSplits) bankTxnIds.add(s.transaction_id as string);
    if (bankSplits.length < 1000) break;
  }

  // Q2 — transactions in window, filtered to those we found above.
  type TxnRow = {
    id: string; payee_text: string | null; date: string; type: string; details: string | null;
  };
  const txnsByid = new Map<string, TxnRow>();
  const txnIdsArr = [...bankTxnIds];
  for (let i = 0; i < txnIdsArr.length; i += IN_CHUNK) {
    const chunk = txnIdsArr.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += 1000) {
      const { data: txns } = await supabase
        .from('bookkeeping_transactions')
        .select('id, payee_text, date, type, details')
        .eq('book_id', params.id)
        .in('id', chunk)
        .gte('date', cutoff)
        .range(from, from + 999);
      if (!txns || txns.length === 0) break;
      for (const t of (txns as TxnRow[])) txnsByid.set(t.id, t);
      if (txns.length < 1000) break;
    }
  }

  // Q3 — non-bank splits on those transactions; pick the one that's not on
  // a VAT routing account. That's the analysis side.
  type SplitRow = {
    transaction_id: string; account_id: string;
    account: { name: string; ledger: string | null } | { name: string; ledger: string | null }[] | null;
  };
  const analysisByTxn = new Map<string, { account_id: string; account_name: string; ledger: string | null }>();
  const txnsToScan = [...txnsByid.keys()];
  for (let i = 0; i < txnsToScan.length; i += IN_CHUNK) {
    const chunk = txnsToScan.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += 1000) {
      const { data: others } = await supabase
        .from('bookkeeping_transaction_splits')
        .select(`
          transaction_id, account_id,
          account:bookkeeping_accounts!inner(name, ledger)
        `)
        .neq('account_id', body.account_id)
        .in('transaction_id', chunk)
        .range(from, from + 999);
      if (!others || others.length === 0) break;
      for (const o of (others as unknown as SplitRow[])) {
        const acc = Array.isArray(o.account) ? o.account[0] : o.account;
        if (!acc) continue;
        if (/VAT\s*(Input|Output)/i.test(acc.name)) continue;
        if (analysisByTxn.has(o.transaction_id)) continue;
        analysisByTxn.set(o.transaction_id, {
          account_id: o.account_id, account_name: acc.name, ledger: acc.ledger,
        });
      }
      if (others.length < 1000) break;
    }
  }

  // Build payee → ordered list of (date, analysis) entries. Sorted newest
  // first so "most-recent-wins" is just .find().
  const payeeIndex = new Map<string, Array<{
    date: string;
    payeeOriginal: string;
    analysis_account_id: string;
    analysis_account_name: string;
    analysis_ledger: string | null;
    txn_type: string;
  }>>();
  // Also a global "amount-only" index for the fallback: amount string →
  // analysis info. Only useful when an amount has been posted to exactly
  // one account historically.
  const amountIndex = new Map<string, { account_id: string; name: string; ledger: string | null }[]>();
  // Need the gross amounts → fetch from txns. We don't have them on the
  // header; but we can derive abs(debit) of the bank-side split.
  // Easier: requery bank splits with debit/credit and merge.
  for (let from = 0; ; from += 1000) {
    const { data: bankSplits } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('transaction_id, debit, credit')
      .eq('account_id', body.account_id)
      .range(from, from + 999);
    if (!bankSplits || bankSplits.length === 0) break;
    for (const bs of bankSplits) {
      const txn = txnsByid.get(bs.transaction_id as string);
      if (!txn) continue;
      const analysis = analysisByTxn.get(bs.transaction_id as string);
      if (!analysis) continue;
      const payeeKey = normalize(txn.payee_text ?? txn.details ?? '');
      if (payeeKey) {
        if (!payeeIndex.has(payeeKey)) payeeIndex.set(payeeKey, []);
        payeeIndex.get(payeeKey)!.push({
          date: txn.date,
          payeeOriginal: txn.payee_text ?? '',
          analysis_account_id: analysis.account_id,
          analysis_account_name: analysis.account_name,
          analysis_ledger: analysis.ledger,
          txn_type: txn.type,
        });
      }
      const amt = (Number(bs.debit) - Number(bs.credit)).toFixed(2);
      if (!amountIndex.has(amt)) amountIndex.set(amt, []);
      amountIndex.get(amt)!.push({
        account_id: analysis.account_id, name: analysis.account_name, ledger: analysis.ledger,
      });
    }
    if (bankSplits.length < 1000) break;
  }
  // Sort each payee list newest first.
  for (const arr of payeeIndex.values()) arr.sort((a, b) => b.date.localeCompare(a.date));

  // ── Run per-row allocation rules ──────────────────────────────────────
  const allocations: Allocation[] = body.rows.map(row => {
    const isOut = row.amount < 0;
    const grossAbs = Math.abs(row.amount);

    // Rule 1: open supplier (PAY) or customer (REC) balance match
    if (isOut || !isOut) {
      const targetLedger = isOut ? 'Suppliers' : 'Customers';
      let best: { acc: { id: string; name: string; ledger: string | null }; score: number; amtMatch: boolean } | null = null;
      for (const acc of (scAccounts ?? [])) {
        if (acc.ledger !== targetLedger) continue;
        const balance = outstanding(acc.id);
        if (balance <= 0.005) continue;                       // no open balance
        const score = nameScore(acc.name, row.payee);
        if (score < 0.5) continue;                            // weak name match
        const amtMatch = Math.abs(balance - grossAbs) < 0.005;
        if (!best || score > best.score || (score === best.score && amtMatch && !best.amtMatch)) {
          best = { acc, score, amtMatch };
        }
      }
      if (best) {
        return {
          row_id: row.row_id,
          analysis_account_id:   best.acc.id,
          analysis_account_name: best.acc.name,
          analysis_ledger:       best.acc.ledger,
          confidence: best.amtMatch && best.score >= 0.8 ? 'high'
                    : best.score >= 0.7              ? 'medium'
                    : 'low',
          source: isOut ? 'supplier_match' : 'customer_match',
          reasoning: `Matches ${best.acc.name} (open balance ${outstanding(best.acc.id).toFixed(2)}${best.amtMatch ? ', exact amount' : ''})`,
        };
      }
    }

    // Rule 2: past-payee match (most-recent-wins). Try exact normalised
    // match first, then fuzzy.
    const payeeKey = normalize(row.payee);
    if (payeeKey) {
      const exact = payeeIndex.get(payeeKey);
      if (exact && exact.length > 0) {
        const m = exact[0]; // newest
        return {
          row_id: row.row_id,
          analysis_account_id:   m.analysis_account_id,
          analysis_account_name: m.analysis_account_name,
          analysis_ledger:       m.analysis_ledger,
          confidence: 'high',
          source: 'past_payee',
          reasoning: `Same payee "${m.payeeOriginal}" was last posted to ${m.analysis_account_name} on ${m.date}`,
        };
      }
      // Fuzzy: scan all payee keys for best score >= 0.6
      let bestFuzzy: { entry: NonNullable<ReturnType<typeof payeeIndex.get>>[number]; score: number } | null = null;
      for (const [key, entries] of payeeIndex) {
        const score = nameScore(key, payeeKey);
        if (score < 0.6) continue;
        const m = entries[0];                                  // newest within this key
        if (!bestFuzzy || score > bestFuzzy.score) bestFuzzy = { entry: m, score };
      }
      if (bestFuzzy) {
        return {
          row_id: row.row_id,
          analysis_account_id:   bestFuzzy.entry.analysis_account_id,
          analysis_account_name: bestFuzzy.entry.analysis_account_name,
          analysis_ledger:       bestFuzzy.entry.analysis_ledger,
          confidence: bestFuzzy.score >= 0.8 ? 'medium' : 'low',
          source: 'past_payee',
          reasoning: `Similar payee last posted to ${bestFuzzy.entry.analysis_account_name} on ${bestFuzzy.entry.date}`,
        };
      }
    }

    // Rule 3: amount-only fallback (low confidence, only when an amount
    // has been posted to exactly ONE account historically).
    const amtKey = (isOut ? -grossAbs : grossAbs).toFixed(2);
    const amtMatches = amountIndex.get(amtKey);
    if (amtMatches && amtMatches.length > 0) {
      // Are they all the same account?
      const allSame = amtMatches.every(m => m.account_id === amtMatches[0].account_id);
      if (allSame) {
        const m = amtMatches[0];
        return {
          row_id: row.row_id,
          analysis_account_id:   m.account_id,
          analysis_account_name: m.name,
          analysis_ledger:       m.ledger,
          confidence: 'low',
          source: 'amount_only',
          reasoning: `Same amount has only ever been posted to ${m.name}`,
        };
      }
    }

    // No match — caller flags for manual entry.
    return {
      row_id: row.row_id,
      analysis_account_id:   null,
      analysis_account_name: null,
      analysis_ledger:       null,
      confidence: null,
      source: 'unallocated',
      reasoning: 'No matching open balance or past entry found',
    };
  });

  // ── AI fallback for non-high-confidence rows ──────────────────────────
  // Anything the rules returned with confidence ≠ 'high' goes to Claude
  // when the firm has an API key configured. This catches:
  //   • rows the rules couldn't allocate at all (unallocated)
  //   • rows where the rules guessed but weren't confident (medium/low)
  //
  // We give Claude the full chart of accounts and a sample of recent
  // transactions on this book as context, then ask for structured
  // suggestions via tool-use. Rows whose AI answer references an unknown
  // account id (hallucination) are silently kept as their original
  // rule-based allocation — better to leave a half-uncertain rule
  // suggestion than swap it for a wrong one.
  const aiReport = await runAiFallback({
    supabase,
    firmId: ctx.firmId,
    bookId: params.id,
    accountId: body.account_id,
    rows: body.rows,
    allocations,
  });

  return NextResponse.json({
    allocations,
    ai_used: aiReport.used,
    ai_skipped_reason: aiReport.skippedReason,
  });
}

// ── AI fallback implementation ────────────────────────────────────────────
async function runAiFallback({
  supabase, firmId, bookId, accountId, rows, allocations,
}: {
  supabase: ReturnType<typeof createClient>;
  firmId: string;
  bookId: string;
  accountId: string;
  rows: z.infer<typeof Body>['rows'];
  allocations: Allocation[];
}): Promise<{ used: boolean; skippedReason?: string }> {
  // Pick the rows worth sending to AI — anything below "high" rule
  // confidence (medium / low / unallocated). High-confidence rule hits
  // are kept as-is; the AI's job is to break ties on the uncertain ones.
  const targets = allocations.filter(a => a.confidence !== 'high');
  if (targets.length === 0) return { used: false, skippedReason: 'all_high_confidence' };

  // Try to instantiate the firm's Anthropic client. If no key is set,
  // surface a clean reason and skip — we never block rule-based work on
  // missing AI configuration.
  let anthropic: Awaited<ReturnType<typeof getAnthropicForFirm>>;
  try {
    anthropic = await getAnthropicForFirm(firmId);
  } catch (e) {
    if (e instanceof ApiKeyNotConfiguredError) {
      return { used: false, skippedReason: 'no_api_key' };
    }
    return { used: false, skippedReason: 'anthropic_init_failed' };
  }

  // ── Build COA context ──────────────────────────────────────────────────
  // We send every active account (id + name + ledger) so the AI can pick
  // any of them. The id list also acts as a strict whitelist when we
  // validate the AI's answers afterwards.
  const { data: accountsRaw } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, inactive')
    .eq('book_id', bookId);
  const accounts = (accountsRaw ?? []).filter(a => !a.inactive);
  const validAccountIds = new Set(accounts.map(a => a.id as string));
  const accountById = new Map<string, { id: string; name: string; ledger: string | null }>();
  for (const a of accounts) accountById.set(a.id as string, { id: a.id as string, name: a.name as string, ledger: a.ledger as string | null });
  // Group by ledger for a compact, readable prompt.
  const byLedger = new Map<string, Array<{ id: string; name: string }>>();
  for (const a of accounts) {
    const led = (a.ledger as string | null) ?? '(no ledger)';
    if (!byLedger.has(led)) byLedger.set(led, []);
    byLedger.get(led)!.push({ id: a.id as string, name: a.name as string });
  }
  const coaText = Array.from(byLedger.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([led, accs]) => {
      const lines = accs
        .sort((x, y) => x.name.localeCompare(y.name))
        .map(a => `  - "${a.name}" (id: ${a.id})`)
        .join('\n');
      return `${led}:\n${lines}`;
    })
    .join('\n\n');

  // ── Recent-transactions sample (give AI a pattern feel) ────────────────
  // 30 most-recent posted entries on this bank account, with payee, gross,
  // type, and the analysis account. We keep it short so the prompt stays
  // tight — the AI just needs enough to spot patterns.
  const { data: recentBankSplits } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id, transaction_id, debit, credit')
    .eq('account_id', accountId)
    .limit(60);
  const recentTxnIds = Array.from(new Set((recentBankSplits ?? []).map(s => s.transaction_id as string)));
  const { data: recentTxnsRaw } = await supabase
    .from('bookkeeping_transactions')
    .select('id, type, date, payee_text, details')
    .in('id', recentTxnIds.slice(0, 60))
    .order('date', { ascending: false })
    .limit(30);
  const sampleTxnIds = (recentTxnsRaw ?? []).map(t => t.id as string);
  const { data: sampleOthers } = await supabase
    .from('bookkeeping_transaction_splits')
    .select(`transaction_id, account_id, account:bookkeeping_accounts!inner(name, ledger)`)
    .in('transaction_id', sampleTxnIds)
    .neq('account_id', accountId);
  type Other = { transaction_id: string; account_id: string; account: { name: string; ledger: string | null } | { name: string; ledger: string | null }[] | null };
  const sampleAnalysisByTxn = new Map<string, { name: string; ledger: string | null }>();
  for (const o of ((sampleOthers ?? []) as unknown as Other[])) {
    const acc = Array.isArray(o.account) ? o.account[0] : o.account;
    if (!acc) continue;
    if (/VAT\s*(Input|Output)/i.test(acc.name)) continue;
    if (sampleAnalysisByTxn.has(o.transaction_id)) continue;
    sampleAnalysisByTxn.set(o.transaction_id, { name: acc.name, ledger: acc.ledger });
  }
  const recentBankAmount = new Map<string, number>();
  for (const s of (recentBankSplits ?? [])) {
    const prev = recentBankAmount.get(s.transaction_id as string) ?? 0;
    recentBankAmount.set(s.transaction_id as string, prev + Number(s.debit) - Number(s.credit));
  }
  const recentText = (recentTxnsRaw ?? [])
    .slice(0, 30)
    .map(t => {
      const analysis = sampleAnalysisByTxn.get(t.id as string);
      const amt = recentBankAmount.get(t.id as string) ?? 0;
      return `${t.date} | ${t.type} | "${(t.payee_text as string | null) ?? (t.details as string | null) ?? ''}" | ${amt.toFixed(2)} | ${analysis?.name ?? '?'}`;
    })
    .join('\n');

  // ── Per-batch AI call ──────────────────────────────────────────────────
  // 50 rows per batch keeps output JSON modest. Tool-use guarantees the
  // model returns a parseable structure; we don't have to babysit JSON.
  const BATCH = 50;
  const targetRowMap = new Map<string, z.infer<typeof Body>['rows'][number]>();
  for (const r of rows) targetRowMap.set(r.row_id, r);

  let calls = 0;
  let rowsUpdated = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batchAllocs = targets.slice(i, i + BATCH);
    const batchRows = batchAllocs.map(a => targetRowMap.get(a.row_id)).filter(Boolean) as z.infer<typeof Body>['rows'];
    if (batchRows.length === 0) continue;
    calls++;

    const userPrompt = [
      `You are helping allocate a UK bank-statement CSV to the right analysis accounts on a bookkeeping ledger.`,
      ``,
      `## Chart of accounts (the only valid account_id values)`,
      coaText,
      ``,
      `## Recent transactions on this bank account (pattern context)`,
      `Date | Type | Payee | Signed amount | Analysis account`,
      recentText || '(no recent transactions)',
      ``,
      `## Rows to allocate`,
      `Each row is from a bank CSV. Pick the best analysis-side account for each.`,
      `Sign convention: amount > 0 = money INTO the bank (REC); amount < 0 = money OUT (PAY/CHQ).`,
      ``,
      JSON.stringify(batchRows.map(r => ({
        row_id: r.row_id,
        type:   r.type,
        date:   r.date,
        payee:  r.payee,
        amount: r.amount,
      })), null, 2),
      ``,
      `For each row, call submit_allocations with your best suggestion. Rules:`,
      `- account_id MUST be one of the ids listed in the chart of accounts above (no hallucinations).`,
      `- If you genuinely can't decide, set account_id to null and confidence to "low".`,
      `- Suppliers ledger for PAYs to known suppliers; Customers for RECs from known customers.`,
      `- Otherwise pick an Expenses (PAY) or Income (REC) account that matches the payee pattern.`,
      `- Keep reasoning to one short sentence.`,
    ].join('\n');

    let toolInput: { allocations?: Array<{ row_id?: string; account_id?: string | null; confidence?: string; reasoning?: string }> } | null = null;
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        tools: [{
          name: 'submit_allocations',
          description: 'Submit your suggested analysis-account allocations for the given bank-CSV rows.',
          input_schema: {
            type: 'object',
            properties: {
              allocations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    row_id:     { type: 'string', description: 'The row_id from the input.' },
                    account_id: { type: ['string', 'null'], description: 'Chosen analysis account id, or null if you can\'t pick.' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    reasoning:  { type: 'string', description: 'One short sentence explaining the pick.' },
                  },
                  required: ['row_id', 'account_id', 'confidence', 'reasoning'],
                },
              },
            },
            required: ['allocations'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_allocations' },
        system: 'You are an expert UK bookkeeping assistant. You allocate bank-statement CSV rows to the right ledger accounts using past patterns + standard double-entry conventions. Be precise — never invent account ids.',
        messages: [{ role: 'user', content: userPrompt }],
      });
      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (toolUse && toolUse.type === 'tool_use') {
        toolInput = toolUse.input as typeof toolInput;
      }
    } catch (e) {
      // Soft failure — log and move on. The rule-based allocations stay.
      console.error('[auto-allocate] AI call failed:', e);
      continue;
    }

    if (!toolInput?.allocations) continue;

    // Merge AI suggestions back into the master allocations list. We only
    // accept suggestions whose account_id is in the firm's COA — protects
    // against hallucinated UUIDs.
    for (const ai of toolInput.allocations) {
      if (!ai.row_id) continue;
      const idx = allocations.findIndex(a => a.row_id === ai.row_id);
      if (idx < 0) continue;
      if (!ai.account_id) continue;
      if (!validAccountIds.has(ai.account_id)) continue;
      const acc = accountById.get(ai.account_id);
      if (!acc) continue;
      // Don't downgrade a high-confidence rule hit (defensive — shouldn't
      // happen since we filtered to non-high above, but belt and braces).
      if (allocations[idx].confidence === 'high') continue;
      allocations[idx] = {
        row_id:                ai.row_id,
        analysis_account_id:   acc.id,
        analysis_account_name: acc.name,
        analysis_ledger:       acc.ledger,
        confidence: (ai.confidence === 'high' || ai.confidence === 'medium' || ai.confidence === 'low')
          ? ai.confidence : 'low',
        source: 'ai',
        reasoning: ai.reasoning ?? null,
      };
      rowsUpdated++;
    }
  }

  void calls;
  return { used: rowsUpdated > 0 };
}
