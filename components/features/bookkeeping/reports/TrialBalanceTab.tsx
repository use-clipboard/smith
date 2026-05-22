'use client';

/**
 * TrialBalanceTab — classic Trial Balance.
 *
 * Visual language: neutral palette, hyperlinked account names (drill into
 * the ledger view), and an underlined totals row at the foot. Account-type
 * is shown via a small uppercase chip on the ledger header row, not by
 * shading every row.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Loader2, Scale, Printer, Download } from 'lucide-react';
import PeriodSelector, { type DateRange } from './PeriodSelector';

interface AccountBalance {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
}

interface Props {
  bookId: string;
  /** Called when the user clicks an account name to drill into its ledger. */
  onOpenAccount: (account: { id: string; name: string; ledger: string | null }) => void;
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

export default function TrialBalanceTab({ bookId, onOpenAccount }: Props) {
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [totals, setTotals] = useState({ debit_total: 0, credit_total: 0 });
  const [netProfit, setNetProfit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams();
        if (period.from) params.set('from', period.from);
        if (period.to)   params.set('to',   period.to);
        const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${params}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Failed to load balances');
        }
        const d = await r.json();
        if (cancelled) return;
        setAccounts(d.accounts ?? []);
        setTotals(d.totals ?? { debit_total: 0, credit_total: 0 });
        setNetProfit(d.net_profit ?? 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [bookId, period.from, period.to]);

  // Group by ledger, preserving the server's name ordering within each group.
  const grouped = useMemo(() => {
    const map = new Map<string, AccountBalance[]>();
    for (const a of accounts) {
      if (a.debit_total === 0 && a.credit_total === 0) continue;
      const key = a.ledger ?? '— Ungrouped';
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [accounts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <PeriodSelector bookId={bookId} value={period} onChange={setPeriod} />
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 ml-auto"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
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
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-36" />
            </colgroup>
            <thead>
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
                    {/* Account rows */}
                    {items.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-6 py-1 pl-10">
                          <button
                            type="button"
                            onClick={() => onOpenAccount({ id: a.id, name: a.name, ledger: a.ledger })}
                            className="text-indigo-700 hover:underline text-left"
                          >
                            {a.name}
                          </button>
                        </td>
                        <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(a.debit_total)}</td>
                        <td className="px-6 py-1 text-right tabular-nums text-slate-700">{fmt(a.credit_total)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-6 py-2 text-right text-slate-700 font-medium">Total</td>
                <td className="px-6 py-2 text-right tabular-nums font-semibold text-slate-900 border-t border-slate-400">{totals.debit_total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-6 py-2 text-right tabular-nums font-semibold text-slate-900 border-t border-slate-400">{totals.credit_total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
