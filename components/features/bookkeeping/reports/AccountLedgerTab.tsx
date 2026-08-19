'use client';

/**
 * AccountLedgerTab — per-account drill-down. Opened when the user clicks
 * an account name on the Trial Balance.
 *
 * Shows every transaction touching this account in the selected period, in
 * chronological order, with a running balance column. Header shows opening
 * balance (everything before "from") and closing balance.
 *
 * VT equivalent: clicking an account in the TB opens "Account: <name>" in
 * its own sub-window.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PeriodSelector, { type DateRange } from './PeriodSelector';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink } from '../book/BookNavigationContext';
import { isYearEnd, YearEndChip, YearEndBoundaryRow, YEAR_END_ROW_CLASS } from '../book/YearEndMarker';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';
import type { Transaction } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  accountId: string;
  accountName: string;
  accountLedger: string | null;
  accountCode?: string | null;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// One day before YYYY-MM-DD, returned in the same format.
function dayBefore(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface LedgerRow {
  txn: Transaction;
  debit: number;
  credit: number;
  balance: number;        // running
  /** Year-end close on a P&L account — drawn as a boundary rule rather than a
   *  ledger row, and excluded from the carried-forward figure. */
  yearEndMarker?: boolean;
}

export default function AccountLedgerTab({ bookId, accountId, accountName, accountLedger, accountCode }: Props) {
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  const [openingBalance, setOpeningBalance] = useState(0);
  const [periodTxns, setPeriodTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Bumped by row-actions when something changes so this view refetches.
  const [refreshKey, setRefreshKey] = useState(0);

  // Book-level VAT info for row-actions edit modal late-entry detection.
  const [bookVatInfo, setBookVatInfo] = useState<{ vatRegistered: boolean; vatLockDate: string | null }>({
    vatRegistered: false, vatLockDate: null,
  });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.book) return;
        setBookVatInfo({
          vatRegistered: Boolean(d.book.vat_registered),
          vatLockDate: d.book.vat_lock_date ?? null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered: bookVatInfo.vatRegistered,
    vatLockDate: bookVatInfo.vatLockDate,
    onChanged: () => setRefreshKey(k => k + 1),
  });

  // The year-end close only behaves as a boundary on P&L accounts — on a
  // balance-sheet account it's a real movement. The tab isn't handed the
  // account type (the dynamic-tab descriptor predates this), so resolve it
  // once per account. Until it lands we treat the account as balance-sheet,
  // which is the no-op behaviour.
  const [accountType, setAccountType] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`);
        if (!r.ok) return;
        const d = await r.json();
        const a = (d.accounts ?? []).find((x: { id: string }) => x.id === accountId);
        if (!cancelled) setAccountType(a?.account_type ?? null);
      } catch { /* non-fatal — the ledger still renders */ }
    })();
    return () => { cancelled = true; };
  }, [bookId, accountId]);
  const isPlAccount = accountType === 'income' || accountType === 'expense';

  // ── Fetch opening balance + period transactions ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        // 1) Opening balance — accumulated movement on this account up to
        //    (but not including) the period's from date. If from is null
        //    (All time / open-ended), opening is 0.
        if (period.from) {
          const r = await fetch(
            `/api/bookkeeping/books/${bookId}/balances?to=${dayBefore(period.from)}&include_zero=false`,
          );
          if (r.ok) {
            const d = await r.json();
            const acct = (d.accounts ?? []).find((a: { id: string }) => a.id === accountId);
            if (!cancelled) setOpeningBalance(acct ? Number(acct.balance) : 0);
          }
        } else {
          if (!cancelled) setOpeningBalance(0);
        }

        // 2) Period transactions touching this account, chronological.
        const params = new URLSearchParams({
          account_id: accountId,
          order: 'asc',
          limit: '500',
        });
        if (period.from) params.set('date_from', period.from);
        if (period.to)   params.set('date_to',   period.to);
        const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?${params}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Failed to load transactions');
        }
        const d = await r.json();
        if (!cancelled) setPeriodTxns((d.transactions ?? []) as Transaction[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [bookId, accountId, period.from, period.to, refreshKey]);

  // ── Compute running balance + per-row debit/credit ───────────────────────
  const rows: LedgerRow[] = useMemo(() => {
    let bal = openingBalance;
    const out: LedgerRow[] = [];
    for (const txn of periodTxns) {
      // On a P&L account the year-end close is a period boundary, not a
      // movement: it exists to flatten the nominal for the next year. Counting
      // it here would report a year that genuinely traded as closing at nil.
      // It resets the running balance and renders as a rule instead.
      if (isPlAccount && isYearEnd(txn.type)) {
        bal = 0;
        out.push({ txn, debit: 0, credit: 0, balance: 0, yearEndMarker: true });
        continue;
      }
      // Sum across all splits touching this account on this transaction
      // (rare but possible — a journal could have two lines for one account).
      const splits = (txn.splits ?? []).filter(s => s.account_id === accountId);
      const debit  = splits.reduce((s, x) => s + Number(x.debit), 0);
      const credit = splits.reduce((s, x) => s + Number(x.credit), 0);
      bal = +(bal + debit - credit).toFixed(2);
      out.push({ txn, debit, credit, balance: bal });
    }
    return out;
  }, [openingBalance, periodTxns, accountId, isPlAccount]);

  // The carried-forward figure is the last REAL balance — a trailing year-end
  // marker must not drag it to nil.
  const realRows = rows.filter(r => !r.yearEndMarker);
  const closingBalance = realRows.length > 0 ? realRows[realRows.length - 1].balance : openingBalance;
  const periodMovement = +(closingBalance - openingBalance).toFixed(2);

  // Always render with thousands separators for parity with the other reports.
  const localeFmt = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (n: number) => n === 0 ? '' : localeFmt(n);
  const fmtBalance = (n: number) => Math.abs(n) < 0.005 ? '0.00' : localeFmt(n);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            <AccountCodeTag code={accountCode} className="mr-2" />
            {accountLedger && <span className="text-gray-500">{accountLedger}: </span>}{accountName}
          </h3>
          <p className="text-[11px] text-gray-500">All transactions touching this account in the selected period.</p>
        </div>
        <div className="text-xs text-gray-600 flex items-center gap-3 flex-wrap tabular-nums">
          <span>Opening <span className="font-semibold text-gray-900">{fmtBalance(openingBalance)}</span></span>
          <span className={`${periodMovement > 0 ? 'text-emerald-700' : periodMovement < 0 ? 'text-red-700' : ''}`}>
            Movement <span className="font-semibold">{periodMovement > 0 ? '+' : ''}{localeFmt(periodMovement)}</span>
          </span>
          <span>Closing <span className="font-semibold text-gray-900">{fmtBalance(closingBalance)}</span></span>
        </div>
      </div>

      <PeriodSelector bookId={bookId} value={period} onChange={setPeriod} />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-2 py-1.5 text-left w-24">Date</th>
                <th className="px-2 py-1.5 text-left w-28">Ref</th>
                <th className="px-2 py-1.5 text-left">Details</th>
                <th className="px-2 py-1.5 text-right w-28">Debit</th>
                <th className="px-2 py-1.5 text-right w-28">Credit</th>
                <th className="px-2 py-1.5 text-right w-28">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100 bg-gray-50/50">
                <td className="px-2 py-1.5 text-gray-500 tabular-nums">{period.from ? formatDateUk(period.from) : ''}</td>
                <td className="px-2 py-1.5 text-gray-400 italic" colSpan={3}>Balance brought forward</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-400" />
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtBalance(openingBalance)}</td>
              </tr>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-sm text-gray-400">
                    No movement on this account in the selected period.
                  </td>
                </tr>
              ) : (
                rows.map(({ txn, debit, credit, balance, yearEndMarker }) => {
                  // P&L year-end close — a boundary between years, not a
                  // movement. The balance either side is that year's trading.
                  if (yearEndMarker) {
                    return <YearEndBoundaryRow key={txn.id} colSpan={6} dateLabel={formatDateUk(txn.date)} />;
                  }
                  const rp = rowActions.rowProps(txn);
                  const yearEnd = isYearEnd(txn.type);
                  return (
                    <tr key={txn.id} {...rp} className={`border-t border-gray-100 ${yearEnd ? YEAR_END_ROW_CLASS : 'hover:bg-indigo-50/30'} ${rp.className}`}>
                      <td className="px-2 py-1.5 text-gray-700 tabular-nums">{formatDateUk(txn.date)}</td>
                      <td className="px-2 py-1.5 text-xs">
                        <TxnRefLink txn={txn} className="text-xs" />
                        {yearEnd && <YearEndChip />}
                      </td>
                      <td className="px-2 py-1.5 text-gray-900 truncate max-w-[400px]">{txn.details ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(debit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{fmt(credit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtBalance(balance)}</td>
                    </tr>
                  );
                })
              )}
              <tr className="border-t-2 border-gray-300 bg-gray-50/70">
                <td className="px-2 py-1.5 text-gray-500 tabular-nums">{period.to ? formatDateUk(period.to) : ''}</td>
                <td className="px-2 py-1.5 text-gray-500 italic" colSpan={3}>Balance carried forward</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-400" />
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtBalance(closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {rowActions.menus}
    </div>
  );
}
