'use client';

/**
 * SofaTab — charity Statement of Financial Activities, by fund.
 *
 * For the selected period, income and expenditure are shown in columns per fund
 * (Unrestricted / Restricted / Endowment funds) plus a Total column — the core
 * of a Charities SORP SOFA. Net movement in funds is the bottom line. The fund
 * dimension lives on each transaction split, so this is computed straight from
 * the balances endpoint with a ?fund_id filter — no duplicated accounts.
 *
 * Manage funds (add restricted/endowment, archive, delete) via the modal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import { FUND_TYPE_LABEL, type BookFund } from '@/types/bookkeeping';
import { useBookNavigation } from '../book/BookNavigationContext';
import type { BalanceAccount } from '@/lib/bookkeeping/balances';
import BookFundsModal from './BookFundsModal';

const money = (n: number) =>
  (n < 0 ? '(' : '') + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ')' : '');
const dateUk = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso;
};

interface FundColumn { key: string; label: string; sub: string; fundId: string | null }
interface LedgerRow { ledger: string; byCol: Record<string, number> }

export default function SofaTab({
  bookId, fromIso, toIso, periodLabel,
}: { bookId: string; fromIso: string | null; toIso: string | null; periodLabel?: string }) {
  const dataVersion = useBookNavigation()?.dataVersion;
  const [funds, setFunds] = useState<BookFund[]>([]);
  const [balancesByCol, setBalancesByCol] = useState<Record<string, BalanceAccount[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manageOpen, setManageOpen] = useState(false);

  // Columns: one per active fund, then a Total column (fundId null = all funds).
  const columns: FundColumn[] = useMemo(() => {
    const cols: FundColumn[] = funds
      .filter(f => !f.archived)
      .map(f => ({ key: f.id, label: f.name, sub: FUND_TYPE_LABEL[f.fund_type], fundId: f.id }));
    cols.push({ key: '__total', label: 'Total', sub: 'All funds', fundId: null });
    return cols;
  }, [funds]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const fr = await fetch(`/api/bookkeeping/books/${bookId}/funds`);
      const fd = await fr.json();
      if (!fr.ok) throw new Error(fd.error ?? 'Could not load funds.');
      const activeFunds = (fd.funds ?? []) as BookFund[];
      setFunds(activeFunds);

      const qs = new URLSearchParams();
      if (fromIso) qs.set('from', fromIso);
      if (toIso) qs.set('to', toIso);
      qs.set('exclude_types', 'YET'); // SOFA is the period's activity, not the year-end close

      const cols: Array<{ key: string; fundId: string | null }> = [
        ...activeFunds.filter(f => !f.archived).map(f => ({ key: f.id, fundId: f.id as string | null })),
        { key: '__total', fundId: null },
      ];
      const results = await Promise.all(cols.map(async c => {
        const u = new URLSearchParams(qs);
        if (c.fundId) u.set('fund_id', c.fundId);
        const r = await fetch(`/api/bookkeeping/books/${bookId}/balances?${u.toString()}`);
        const d = await r.json();
        return [c.key, (d.accounts ?? []) as BalanceAccount[]] as const;
      }));
      setBalancesByCol(Object.fromEntries(results));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fromIso, toIso, dataVersion]);

  useEffect(() => { void load(); }, [load]);

  // Build income / expenditure rows grouped by ledger, valued per column.
  const { incomeRows, expenseRows, incomeTotals, expenseTotals, netByCol } = useMemo(() => {
    const incomeLedgers = new Set<string>();
    const expenseLedgers = new Set<string>();
    for (const accts of Object.values(balancesByCol)) {
      for (const a of accts) {
        if (a.account_type === 'income') incomeLedgers.add(a.ledger ?? 'Income');
        else if (a.account_type === 'expense') expenseLedgers.add(a.ledger ?? 'Expenditure');
      }
    }
    const sumLedger = (col: string, ledger: string, type: 'income' | 'expense') => {
      const accts = balancesByCol[col] ?? [];
      return accts
        .filter(a => a.account_type === type && (a.ledger ?? (type === 'income' ? 'Income' : 'Expenditure')) === ledger)
        .reduce((s, a) => s + (type === 'income' ? a.credit_total - a.debit_total : a.debit_total - a.credit_total), 0);
    };
    const mkRows = (ledgers: Set<string>, type: 'income' | 'expense'): LedgerRow[] =>
      [...ledgers].sort().map(ledger => ({
        ledger,
        byCol: Object.fromEntries(columns.map(c => [c.key, +sumLedger(c.key, ledger, type).toFixed(2)])),
      }));
    const incomeRows = mkRows(incomeLedgers, 'income');
    const expenseRows = mkRows(expenseLedgers, 'expense');
    const totalsOf = (rows: LedgerRow[]) =>
      Object.fromEntries(columns.map(c => [c.key, +rows.reduce((s, r) => s + (r.byCol[c.key] ?? 0), 0).toFixed(2)]));
    const incomeTotals = totalsOf(incomeRows);
    const expenseTotals = totalsOf(expenseRows);
    const netByCol = Object.fromEntries(columns.map(c => [c.key, +((incomeTotals[c.key] ?? 0) - (expenseTotals[c.key] ?? 0)).toFixed(2)]));
    return { incomeRows, expenseRows, incomeTotals, expenseTotals, netByCol };
  }, [balancesByCol, columns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Statement of Financial Activities</h2>
          <p className="text-[11px] text-slate-500">
            By fund{periodLabel ? ` · ${periodLabel}` : ''}
            {fromIso || toIso ? ` · ${dateUk(fromIso)} – ${dateUk(toIso)}` : ''}
          </p>
        </div>
        <div className="flex-1" />
        <button type="button" onClick={() => setManageOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 transition-colors">
          <Settings2 size={13} /> Manage funds
        </button>
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : columns.length <= 1 ? (
        <p className="text-sm text-slate-500">No funds yet — add one with “Manage funds”, then tag transactions to a fund.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">&nbsp;</th>
                {columns.map(c => (
                  <th key={c.key} className={`text-right px-3 py-2 ${c.key === '__total' ? 'border-l border-slate-200' : ''}`}>
                    <div className="text-slate-700">{c.label}</div>
                    <div className="text-[10px] font-normal normal-case text-slate-400">{c.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/60"><td colSpan={columns.length + 1} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Income</td></tr>
              {incomeRows.length === 0 && <tr><td colSpan={columns.length + 1} className="px-3 py-1.5 text-slate-400 text-xs">No income in the period.</td></tr>}
              {incomeRows.map(r => (
                <tr key={`i-${r.ledger}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-700">{r.ledger}</td>
                  {columns.map(c => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums text-slate-800 ${c.key === '__total' ? 'border-l border-slate-200' : ''}`}>{r.byCol[c.key] === 0 ? '–' : money(r.byCol[c.key])}</td>)}
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-medium">
                <td className="px-3 py-1.5 text-slate-700">Total income</td>
                {columns.map(c => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums text-slate-900 ${c.key === '__total' ? 'border-l border-slate-200' : ''}`}>{money(incomeTotals[c.key] ?? 0)}</td>)}
              </tr>

              <tr className="bg-slate-50/60"><td colSpan={columns.length + 1} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expenditure</td></tr>
              {expenseRows.length === 0 && <tr><td colSpan={columns.length + 1} className="px-3 py-1.5 text-slate-400 text-xs">No expenditure in the period.</td></tr>}
              {expenseRows.map(r => (
                <tr key={`e-${r.ledger}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-700">{r.ledger}</td>
                  {columns.map(c => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums text-slate-800 ${c.key === '__total' ? 'border-l border-slate-200' : ''}`}>{r.byCol[c.key] === 0 ? '–' : money(r.byCol[c.key])}</td>)}
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-medium">
                <td className="px-3 py-1.5 text-slate-700">Total expenditure</td>
                {columns.map(c => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums text-slate-900 ${c.key === '__total' ? 'border-l border-slate-200' : ''}`}>{money(expenseTotals[c.key] ?? 0)}</td>)}
              </tr>

              <tr className="border-t-2 border-slate-300 bg-indigo-50/40 font-semibold">
                <td className="px-3 py-2 text-slate-900">Net movement in funds</td>
                {columns.map(c => (
                  <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${c.key === '__total' ? 'border-l border-slate-200' : ''} ${(netByCol[c.key] ?? 0) < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                    {money(netByCol[c.key] ?? 0)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Restricted and endowment funds may only be spent within their restriction. This statement shows the period&apos;s
        income and expenditure split by fund; inter-fund transfers are posted as journals (DR one fund / CR another).
      </p>

      <BookFundsModal bookId={bookId} open={manageOpen} onClose={() => setManageOpen(false)} onChanged={() => void load()} />
    </div>
  );
}
