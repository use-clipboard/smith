// Shared account-balance aggregation for a book over a date range.
//
// Extracted from app/api/bookkeeping/books/[id]/balances/route.ts so the TB /
// P&L / BS report endpoint AND the /statements endpoint (which generates the
// text statements handed to Accounts Review / Performance) compute figures from
// ONE source of truth. The route still owns auth + the firm gate; this helper
// just does the aggregation given a Supabase client and a verified book id.

import type { createClient } from '@/lib/supabase-server';

type SupabaseServerClient = ReturnType<typeof createClient>;

export type BalanceAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface BalanceAccount {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  /** User-facing ranged code (display only). */
  code: string | null;
  debit_total: number;
  credit_total: number;
  /** debit_total − credit_total. Natural-sign for asset/expense; negative for
   *  liability/equity/income (the TB UI flips the sign for display). */
  balance: number;
}

export interface BalancesResult {
  from: string | null;
  to: string | null;
  accounts: BalanceAccount[];
  totals: { debit_total: number; credit_total: number };
  /** Sum of (credit − debit) over income + expense accounts. Positive = profit. */
  net_profit: number;
}

export interface ComputeBalancesOpts {
  from?: string | null;
  to?: string | null;
  /** Include accounts with no movement in the range (TB "show zero" views). */
  includeZero?: boolean;
  /** Transaction types to leave out of the aggregation (e.g. ['YET'] for P&L). */
  excludeTypes?: string[];
  /**
   * Apply `excludeTypes` ONLY to transactions dated on or after this date;
   * anything earlier is kept.
   *
   * This is what lets a trial balance be a trial balance. A TB has to be
   * CUMULATIVE — balance-sheet accounts carry their brought-forward figures —
   * but it must not include the viewed year's own closing journal, or that
   * year's P&L would zero itself out against it. Passing no `from` (so the
   * aggregation runs from the beginning of time) together with
   * excludeTypesFrom = the period start gives exactly that: every prior year's
   * close is honoured (so their nominals are correctly swept to reserves),
   * while this year's is held back.
   *
   * Excluding a whole journal keeps the TB in balance, because both its sides
   * go together.
   */
  excludeTypesFrom?: string | null;
  /** Charity fund accounting — restrict the aggregation to splits in this fund.
   *  Null/undefined aggregates across all funds (the normal whole-book view). */
  fundId?: string | null;
}

const r2 = (n: number) => +n.toFixed(2);

/**
 * Aggregate per-account debit/credit/balance for a book over a date range.
 * Paginates the splits query (a single TB can run to thousands of rows).
 * Does NOT enforce auth/firm ownership — the caller must have already verified
 * the book belongs to the requesting firm.
 */
export async function computeBalances(
  supabase: SupabaseServerClient,
  bookId: string,
  opts: ComputeBalancesOpts = {},
): Promise<BalancesResult> {
  const { from = null, to = null, includeZero = false, fundId = null, excludeTypesFrom = null } = opts;
  const excludeTypes = (opts.excludeTypes ?? []).map(s => s.trim().toUpperCase()).filter(Boolean);
  const excludeTypeSet = new Set(excludeTypes);
  // Date-qualified exclusion can't be expressed as a single PostgREST filter,
  // so it's applied while aggregating instead. The query already carries the
  // transaction's date and type, so this costs nothing extra.
  const dateQualifiedExclude = excludeTypes.length > 0 && Boolean(excludeTypesFrom);

  const PAGE_SIZE = 1000;
  type SplitRow = {
    debit: number;
    credit: number;
    account_id: string;
    account: { id: string; name: string; ledger: string | null; account_type: string; code: string | null; archived: boolean } | null;
    transaction: { date: string; type: string } | null;
  };

  const rows: SplitRow[] = [];
  let pageStart = 0;
  while (true) {
    let q = supabase
      .from('bookkeeping_transaction_splits')
      .select(`
        debit, credit, account_id,
        account:bookkeeping_accounts!inner(id, name, ledger, account_type, code, archived, book_id),
        transaction:bookkeeping_transactions!inner(date, type, book_id)
      `)
      .eq('account.book_id', bookId)
      .eq('transaction.book_id', bookId)
      .range(pageStart, pageStart + PAGE_SIZE - 1);

    if (from) q = q.gte('transaction.date', from);
    if (to)   q = q.lte('transaction.date', to);
    if (excludeTypes.length > 0 && !dateQualifiedExclude) {
      q = q.not('transaction.type', 'in', `(${excludeTypes.join(',')})`);
    }
    if (fundId) q = q.eq('fund_id', fundId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as SplitRow[]));
    if (data.length < PAGE_SIZE) break;
    pageStart += PAGE_SIZE;
  }

  type Agg = {
    id: string; name: string; ledger: string | null; account_type: string; code: string | null;
    debit_total: number; credit_total: number;
  };
  const byAccount = new Map<string, Agg>();
  for (const r of rows) {
    if (!r.account) continue;
    if (
      dateQualifiedExclude && r.transaction
      && r.transaction.date >= (excludeTypesFrom as string)
      && excludeTypeSet.has((r.transaction.type ?? '').toUpperCase())
    ) continue;
    const a = byAccount.get(r.account.id) ?? {
      id: r.account.id, name: r.account.name, ledger: r.account.ledger,
      account_type: r.account.account_type, code: r.account.code ?? null, debit_total: 0, credit_total: 0,
    };
    a.debit_total  = r2(a.debit_total  + Number(r.debit));
    a.credit_total = r2(a.credit_total + Number(r.credit));
    byAccount.set(r.account.id, a);
  }

  if (includeZero) {
    const { data: allAccounts } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name, ledger, account_type, code')
      .eq('book_id', bookId)
      .eq('archived', false);
    for (const a of (allAccounts ?? []) as Array<{ id: string; name: string; ledger: string | null; account_type: string; code: string | null }>) {
      if (!byAccount.has(a.id)) {
        byAccount.set(a.id, { id: a.id, name: a.name, ledger: a.ledger, account_type: a.account_type, code: a.code ?? null, debit_total: 0, credit_total: 0 });
      }
    }
  }

  const accounts: BalanceAccount[] = [...byAccount.values()]
    .map(a => ({ ...a, balance: r2(a.debit_total - a.credit_total) }))
    .sort((a, b) => {
      const ledgerCmp = (a.ledger ?? '').localeCompare(b.ledger ?? '');
      if (ledgerCmp !== 0) return ledgerCmp;
      return a.name.localeCompare(b.name);
    });

  const totals = accounts.reduce(
    (acc, a) => ({
      debit_total:  r2(acc.debit_total  + a.debit_total),
      credit_total: r2(acc.credit_total + a.credit_total),
    }),
    { debit_total: 0, credit_total: 0 },
  );

  const net_profit = r2(
    accounts
      .filter(a => a.account_type === 'income' || a.account_type === 'expense')
      .reduce((s, a) => s + (a.credit_total - a.debit_total), 0),
  );

  return { from, to, accounts, totals, net_profit };
}
