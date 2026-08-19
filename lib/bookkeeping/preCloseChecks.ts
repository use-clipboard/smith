import type { createClient } from '@/lib/supabase-server';
import { computeBalances } from './balances';

type SupabaseServerClient = ReturnType<typeof createClient>;

/**
 * Pre-close checks — the year-end routine, not just the year-end button.
 *
 * Closing a year posts an irreversible-feeling journal and pushes the period
 * lock forward, so it's the moment an accountant wants to be told "you haven't
 * posted depreciation" or "there's still £412 sitting in suspense" — BEFORE
 * they click, not after they've reopened the year to fix it.
 *
 * Every check here is deterministic and ADVISORY. Nothing blocks the close:
 * the accountant decides what matters. They're computed alongside the close
 * preview so the approval lightbox can show them next to the journal.
 *
 * Adding a check: keep it cheap (this runs on every preview), give it a
 * `detail` that says what to do about it, and prefer `warn` only when the
 * thing genuinely distorts the accounts.
 */

export type PreCloseSeverity = 'warn' | 'info';

export interface PreCloseCheck {
  id: string;
  severity: PreCloseSeverity;
  title: string;
  /** One sentence: what it means and what to do. */
  detail: string;
}

interface FyWindow { start_date: string; end_date: string }

interface BookForChecks {
  id: string;
  vat_registered: boolean | null;
}

interface AccountForChecks {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  system_role?: string | null;
  archived?: boolean | null;
}

const money = (n: number) =>
  Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** dd/mm/yyyy for user-facing text. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function runPreCloseChecks(
  supabase: SupabaseServerClient,
  bookId: string,
  fy: FyWindow,
  book: BookForChecks,
  accounts: AccountForChecks[],
): Promise<PreCloseCheck[]> {
  const checks: PreCloseCheck[] = [];
  const live = accounts.filter(a => !a.archived);

  // Run the independent probes together — this sits in front of a button click.
  const [
    draftRes,
    balancesRes,
    unreconciledRes,
    assetsRes,
    depnRes,
    vatRes,
    recurringRes,
  ] = await Promise.all([
    // 1. Draft transactions dated in the year.
    supabase
      .from('bookkeeping_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bookId)
      .eq('status', 'draft')
      .gte('date', fy.start_date)
      .lte('date', fy.end_date),

    // 2. Balances as at the year end, for the suspense sweep.
    computeBalances(supabase, bookId, { to: fy.end_date, includeZero: false }),

    // 3. Bank splits in the year never cleared through a reconciliation.
    (async () => {
      const bankIds = live
        .filter(a => (a.ledger ?? '').trim().toLowerCase() === 'bank')
        .map(a => a.id);
      if (bankIds.length === 0) return { count: 0 };
      const { count } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('id, transaction:bookkeeping_transactions!inner(date, book_id)', { count: 'exact', head: true })
        .in('account_id', bankIds)
        .is('cleared_in_rec_id', null)
        .eq('transaction.book_id', bookId)
        .gte('transaction.date', fy.start_date)
        .lte('transaction.date', fy.end_date);
      return { count: count ?? 0 };
    })(),

    // 4. Assets held during the year (not disposed before it started).
    supabase
      .from('bookkeeping_assets')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bookId)
      .lte('purchase_date', fy.end_date)
      .or(`disposal_date.is.null,disposal_date.gte.${fy.start_date}`),

    // 5. Any depreciation/amortisation charged in the year.
    (async () => {
      const chargeIds = live
        .filter(a => a.system_role === 'depreciation_expense' || a.system_role === 'amortisation_expense')
        .map(a => a.id);
      if (chargeIds.length === 0) return { count: 0, resolvable: false };
      const { count } = await supabase
        .from('bookkeeping_transaction_splits')
        .select('id, transaction:bookkeeping_transactions!inner(date, book_id)', { count: 'exact', head: true })
        .in('account_id', chargeIds)
        .eq('transaction.book_id', bookId)
        .gte('transaction.date', fy.start_date)
        .lte('transaction.date', fy.end_date);
      return { count: count ?? 0, resolvable: true };
    })(),

    // 6. VAT returns filed for periods ending in the year.
    book.vat_registered
      ? supabase
          .from('bookkeeping_vat_returns')
          .select('id', { count: 'exact', head: true })
          .eq('book_id', bookId)
          .gte('period_to', fy.start_date)
          .lte('period_to', fy.end_date)
      : Promise.resolve({ count: 0 }),

    // 7. Memorised transactions still due on or before the year end.
    supabase
      .from('bookkeeping_recurring_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('book_id', bookId)
      .eq('active', true)
      .lte('next_due_date', fy.end_date),
  ]);

  // ── 1. Drafts ──────────────────────────────────────────────────────────────
  const drafts = draftRes.count ?? 0;
  if (drafts > 0) {
    checks.push({
      id: 'draft_transactions',
      severity: 'warn',
      title: `${plural(drafts, 'draft transaction')} in the year`,
      detail: 'Drafts are excluded from the accounts, so they won’t be in the profit you carry to reserves. Post or delete them first.',
    });
  }

  // ── 2. Suspense ────────────────────────────────────────────────────────────
  // Anything still parked in suspense is, by definition, unallocated — and
  // once the year is closed the period lock makes it fiddly to reallocate.
  const suspense = balancesRes.accounts.filter(a =>
    /suspense/i.test(a.name) && Math.abs(a.balance) >= 0.005,
  );
  if (suspense.length > 0) {
    const worst = suspense.reduce((m, a) => Math.abs(a.balance) > Math.abs(m.balance) ? a : m, suspense[0]);
    checks.push({
      id: 'suspense_balance',
      severity: 'warn',
      title: suspense.length === 1
        ? `${worst.name} holds ${money(worst.balance)}`
        : `${plural(suspense.length, 'suspense account')} hold a balance`,
      detail: 'Unallocated entries are sitting in suspense. Reallocate them to the right accounts before closing — after the close the period is locked.',
    });
  }

  // ── 3. Unreconciled bank ───────────────────────────────────────────────────
  const unreconciled = unreconciledRes.count;
  if (unreconciled > 0) {
    checks.push({
      id: 'unreconciled_bank',
      severity: 'info',
      title: `${plural(unreconciled, 'bank entry', 'bank entries')} not reconciled`,
      detail: `Entries dated in the year that haven’t been cleared through a bank reconciliation. Worth agreeing the bank to the statement at ${fmtDate(fy.end_date)}.`,
    });
  }

  // ── 4/5. Depreciation ──────────────────────────────────────────────────────
  const assetCount = assetsRes.count ?? 0;
  if (assetCount > 0 && depnRes.resolvable && depnRes.count === 0) {
    checks.push({
      id: 'depreciation_not_posted',
      severity: 'warn',
      title: 'No depreciation posted this year',
      detail: `${plural(assetCount, 'asset')} were held during the year but nothing has been charged to the depreciation account. Run the depreciation post from the fixed-asset register first.`,
    });
  }

  // ── 6. VAT ─────────────────────────────────────────────────────────────────
  if (book.vat_registered && (vatRes.count ?? 0) === 0) {
    checks.push({
      id: 'no_vat_returns_filed',
      severity: 'info',
      title: 'No VAT returns recorded for this year',
      detail: 'The book is VAT registered but no return has been filed or marked as filed for a period ending in this year. Check the VAT control accounts agree to what was actually submitted.',
    });
  }

  // ── 7. Recurring ───────────────────────────────────────────────────────────
  const due = recurringRes.count ?? 0;
  if (due > 0) {
    checks.push({
      id: 'recurring_due',
      severity: 'info',
      title: `${plural(due, 'memorised transaction')} still due`,
      detail: `Due on or before ${fmtDate(fy.end_date)} and not yet posted. Post them from the recurring list if they belong in this year.`,
    });
  }

  // Warnings first — they're the ones worth stopping for.
  return checks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1));
}
