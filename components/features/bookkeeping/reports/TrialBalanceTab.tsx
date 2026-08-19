'use client';

/**
 * TrialBalanceTab — classic Trial Balance.
 *
 * Visual language: neutral palette, hyperlinked account names (drill into
 * the ledger view), and an underlined totals row at the foot. Account-type
 * is shown via a small uppercase chip on the ledger header row, not by
 * shading every row.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { printReport } from './printReport';
import { exportRowsAsCsv, type CsvRow } from './exportReportCsv';
import { Loader2, Scale, Printer, Download } from 'lucide-react';
import PeriodEmptyState from './PeriodEmptyState';
import ReportPrintHeader from './ReportPrintHeader';
import { useBookNavigation } from '../book/BookNavigationContext';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';

interface AccountBalance {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  code?: string | null;
  debit_total: number;
  credit_total: number;
  balance: number;
}

interface Props {
  bookId: string;
  /** Called when the user clicks an account name to drill into its ledger. */
  onOpenAccount: (account: { id: string; name: string; ledger: string | null; code?: string | null }) => void;
}

// Lightweight chip per account type — same colour family used elsewhere but
// applied only to a small inline chip, not the row.
const TYPE_CHIP: Record<string, string> = {
  income:    'bg-emerald-50 text-emerald-700 border-emerald-100',
  expense:   'bg-rose-50    text-rose-700    border-rose-100',
  asset:     'bg-blue-50    text-blue-700    border-blue-100',
  liability: 'bg-violet-50  text-violet-700  border-violet-100',
  equity:    'bg-slate-100  text-slate-700   border-slate-200',
};

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '';
  return Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// VT-style TB ordering — P&L accounts first, then BS, then equity. Anything
// not in this list (custom ledger, imported COA name we don't recognise) is
// appended after, sorted by account_type then alphabetically.
const LEDGER_ORDER = [
  'Income',
  'Cost of sales',
  'Expenses',
  'Taxation',
  'FA - intangible',
  'FA - land and buildings',
  'FA - plant and machinery',
  'FA - equipment, fixtures & fittings',
  'FA - vehicles',
  'Investments - fixed',
  'Stocks',
  'Customers',
  'Debtors',
  'Bank',
  'Investments - current',
  'Suppliers',
  'Creditors',
  'Deferred tax',
  'Share capital',
  'Share premium',
  'Revaluation reserve',
  'Profit and loss account',
];
const TYPE_ORDER: Record<string, number> = {
  income: 0, expense: 1, asset: 2, liability: 3, equity: 4,
};
function ledgerSortKey(ledger: string, accountType: string): [number, number, string] {
  const idx = LEDGER_ORDER.indexOf(ledger);
  // First sort bucket: canonical-order ledgers (0..N) before unknowns
  // (which all share the same first key of LEDGER_ORDER.length).
  // Second bucket: account_type — pushes any unknown ledger near its peers
  // (an "expense"-typed custom ledger appears near Cost of sales/Expenses).
  // Third bucket: alphabetical fallback.
  return [idx >= 0 ? idx : LEDGER_ORDER.length, TYPE_ORDER[accountType] ?? 99, ledger];
}

export default function TrialBalanceTab({ bookId, onOpenAccount }: Props) {
  // Period now lives in BookNavigation — the header's year/period bar drives
  // every report at once. The local PeriodSelector that used to live here
  // is gone; the bar is the single source of truth.
  const nav = useBookNavigation();
  const activePeriod = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, label: '' };

  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [netProfit, setNetProfit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showZero, setShowZero] = useState(false);
  const printRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Don't fetch until the user has set up a year-end + selected a period.
    if (!activePeriod.ready) { setAccounts([]); setNetProfit(0); return; }
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams();
        // A trial balance is CUMULATIVE — it lists what every account stands at
        // on the date, so balance-sheet accounts must carry their brought-
        // forward figures. Passing `from` made this a movement-in-period report
        // instead, which showed nothing at all for a year that had only
        // brought-forward balances and no transactions of its own.
        //
        // So: no `from`, and instead hold back only the VIEWED period's own
        // year-end close (exclude_types_from). Every earlier close still
        // applies, which is what correctly sweeps prior years' nominals into
        // reserves and leaves P&L accounts showing this year alone. Excluding a
        // whole journal keeps the TB in balance, because both its sides go
        // together.
        if (activePeriod.toIso) params.set('to', activePeriod.toIso);
        params.set('exclude_types', 'YET');
        if (activePeriod.fromIso) params.set('exclude_types_from', activePeriod.fromIso);
        // Same pattern as the P&L/BS — when the user ticks "Show zero-balance
        // accounts" we have to ask the server for them, because the response
        // hides zero-movement rows by default.
        if (showZero) params.set('include_zero', 'true');
        const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Failed to load balances');
        }
        const d = await r.json();
        if (cancelled) return;
        setAccounts(d.accounts ?? []);
        setNetProfit(d.net_profit ?? 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
    // showZero re-runs the fetch — server-side filter, can't be done client-only.
  }, [bookId, activePeriod.ready, activePeriod.fromIso, activePeriod.toIso, showZero]);

  // Group by ledger AND sort ledgers in VT's canonical order — P&L first
  // (Income, Cost of sales, Expenses, Taxation), then BS (FA, Customers,
  // Debtors, Bank, Suppliers, Creditors), then equity (Share capital,
  // Profit and loss account). Any imported ledger we don't recognise is
  // appended at the end, grouped near peers of the same account_type.
  // Computed unconditionally so React sees the same hooks every render —
  // the empty-state early return below must come AFTER all hook calls.
  const grouped = useMemo(() => {
    const map = new Map<string, AccountBalance[]>();
    for (const a of accounts) {
      // Hide rows whose NET balance is zero (Dr == Cr) unless the user has
      // explicitly asked to see them. The previous check used gross totals,
      // which meant accounts whose movement cancels out (e.g. an invoice
      // raised and then fully paid — Dr 512 / Cr 512) stayed visible even
      // though VT's TB drops them.
      const net = Math.abs(a.debit_total - a.credit_total);
      if (!showZero && net < 0.005) continue;
      const key = a.ledger ?? '— Ungrouped';
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    const entries = [...map.entries()];
    entries.sort((a, b) => {
      const ka = ledgerSortKey(a[0], a[1][0].account_type);
      const kb = ledgerSortKey(b[0], b[1][0].account_type);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2].localeCompare(kb[2]);
    });
    return entries;
  }, [accounts, showZero]);

  // Recompute totals client-side from the NET balances we display, so the
  // footer matches the actual rows (we ignore the server totals because
  // they're gross Dr/Cr sums — different from what the rows show now).
  const netTotals = useMemo(() => {
    let dr = 0, cr = 0;
    for (const [, items] of grouped) {
      for (const a of items) {
        const net = a.debit_total - a.credit_total;
        if (net > 0) dr += net; else cr += -net;
      }
    }
    return { dr: +dr.toFixed(2), cr: +cr.toFixed(2) };
  }, [grouped]);

  // Empty state when no year-end is set / no period chosen. Must come AFTER
  // all hook calls so the hook count stays stable across renders.
  if (!activePeriod.ready) return <PeriodEmptyState reportName="trial balance" />;

  return (
    <div className="space-y-3 bk-print-root" ref={printRootRef}>
      <ReportPrintHeader
        bookId={bookId}
        reportTitle="Trial Balance"
        periodDescription={`At ${activePeriod.label}`}
      />
      <div className="flex items-center gap-3 flex-wrap print-hidden">
        <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
          <Scale size={14} className="text-indigo-600" />
          Trial Balance
          <span className="text-xs font-normal text-slate-500">· {activePeriod.label}</span>
        </h2>
        <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 ml-auto">
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-slate-300" />
          Show zero-balance accounts
        </label>
        <button
          type="button"
          onClick={() => printReport(printRootRef.current, `Trial Balance — ${activePeriod.label}`)}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          onClick={() => {
            // Header + one row per account, with a ledger column so the
            // grouping survives in Excel. Final row carries the column
            // totals so the file is self-contained.
            const rows: CsvRow[] = [['Ledger', 'Account', 'Debit', 'Credit']];
            for (const [ledger, items] of grouped) {
              for (const a of items) {
                const net = a.debit_total - a.credit_total;
                rows.push([
                  ledger,
                  a.name,
                  net > 0.005 ? net.toFixed(2) : '',
                  net < -0.005 ? Math.abs(net).toFixed(2) : '',
                ]);
              }
            }
            rows.push(['', 'Total', netTotals.dr.toFixed(2), netTotals.cr.toFixed(2)]);
            exportRowsAsCsv(`Trial Balance — ${activePeriod.label}.csv`, rows);
          }}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          <Download size={12} /> Export
        </button>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading && accounts.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading…
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
            <Scale size={16} />
          </div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Nothing to show yet</p>
          <p className="text-xs text-slate-500">No movement in the selected period — adjust the dates above, or post some transactions.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm bk-print-area">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-36" />
            </colgroup>
            <thead className="bk-sticky-thead">
              <tr>
                <th />
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">Debit</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">Credit</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([ledger, items]) => {
                const chip = TYPE_CHIP[items[0].account_type] ?? TYPE_CHIP.asset;
                return (
                  <Fragment key={ledger}>
                    {/* Ledger title row */}
                    <tr>
                      <td colSpan={3} className="px-6 pt-4 pb-1">
                        <span className="font-semibold text-slate-900">{ledger}</span>
                        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide font-semibold border ${chip}`}>
                          {items[0].account_type}
                        </span>
                      </td>
                    </tr>
                    {/* Account rows — show NET balance on the natural side
                        (Dr if balance > 0, Cr if < 0), matching VT's TB.
                        Showing both gross sums made the year-end clearance
                        (YET) look like everything netted to zero. */}
                    {items.map(a => {
                      const net = a.debit_total - a.credit_total;
                      const showDr = net > 0.005 ? Math.abs(net) : 0;
                      const showCr = net < -0.005 ? Math.abs(net) : 0;
                      return (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="px-6 py-1 pl-10">
                            <button
                              type="button"
                              onClick={() => onOpenAccount({ id: a.id, name: a.name, ledger: a.ledger, code: a.code })}
                              className="text-indigo-700 hover:underline text-left"
                            >
                              <AccountCodeTag code={a.code} className="mr-2" />
                              {a.name}
                            </button>
                          </td>
                          <td className="px-6 py-1 text-right tabular-nums text-slate-700">{showDr ? fmt(showDr) : ''}</td>
                          <td className="px-6 py-1 text-right tabular-nums text-slate-700">{showCr ? fmt(showCr) : ''}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-6 py-2 text-right text-slate-700 font-medium">Total</td>
                <td className="px-6 py-2 text-right tabular-nums font-semibold text-slate-900 border-t border-slate-400">{netTotals.dr.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-6 py-2 text-right tabular-nums font-semibold text-slate-900 border-t border-slate-400">{netTotals.cr.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td className="px-6 py-2 text-right text-slate-700 font-medium border-t-2 border-slate-300">Net {netProfit >= 0 ? 'profit' : 'loss'} for the period</td>
                <td colSpan={2} className="px-6 py-2 text-right tabular-nums font-bold text-slate-900 border-t-2 border-slate-300">
                  {Math.abs(netProfit).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{netProfit < 0 ? ' (loss)' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
