'use client';

/**
 * CashFlowTab — monthly cash flow across all Bank accounts, with a simple
 * forward forecast based on the rolling average of the last N months.
 *
 * Columns: Month / Opening / Receipts / Payments / Net / Closing.
 * Forecast rows are shown in a slightly muted style and a "(forecast)" chip.
 *
 * Visual language matches the other reports — neutral palette, hyperlinked
 * column titles, classic underlined totals row.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, Download, Wallet, Sparkles } from 'lucide-react';
import { type DateRange } from './PeriodSelector';
import PeriodEmptyState from './PeriodEmptyState';
import { useBookNavigation } from '../book/BookNavigationContext';

interface MonthRow {
  month: string;      // YYYY-MM
  label: string;      // "Mar 2026"
  opening: number;
  receipts: number;
  payments: number;
  net: number;
  closing: number;
  forecast?: boolean; // marker for forecast rows
}

interface Props {
  bookId: string;
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '-';
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

export default function CashFlowTab({ bookId }: Props) {
  // Period from the header bar via BookNavigation.
  const nav = useBookNavigation();
  const dataVersion = nav?.dataVersion;
  const activePeriod = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, label: '' };
  const period: DateRange = useMemo(() => ({ from: activePeriod.fromIso, to: activePeriod.toIso }), [activePeriod.fromIso, activePeriod.toIso]);

  const [months, setMonths] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forecastMonths, setForecastMonths] = useState(3);
  const [windowMonths, setWindowMonths]     = useState(3);   // rolling avg size

  useEffect(() => {
    if (!activePeriod.ready) { setMonths([]); return; }
    let cancelled = false;
    async function go() {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams();
        if (period.from) params.set('from', period.from);
        if (period.to)   params.set('to',   period.to);
        const r = await fetch(`/api/bookkeeping/books/${bookId}/cashflow?${params}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Failed to load cash flow');
        }
        const d = await r.json();
        if (!cancelled) setMonths((d.months ?? []) as MonthRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [bookId, activePeriod.ready, period.from, period.to, dataVersion]);

  // ── Forecast ─────────────────────────────────────────────────────────────
  // Take the rolling average of the last `windowMonths` actual months' receipts
  // and payments, then project them forward for `forecastMonths`.
  const projection: MonthRow[] = useMemo(() => {
    if (months.length === 0 || forecastMonths <= 0) return [];
    const recent = months.slice(-windowMonths);
    if (recent.length === 0) return [];
    const avgReceipts = recent.reduce((s, m) => s + m.receipts, 0) / recent.length;
    const avgPayments = recent.reduce((s, m) => s + m.payments, 0) / recent.length;

    const out: MonthRow[] = [];
    let opening = months[months.length - 1].closing;
    let cursor  = months[months.length - 1].month; // YYYY-MM
    for (let i = 0; i < forecastMonths; i++) {
      cursor = nextMonth(cursor);
      const receipts = +avgReceipts.toFixed(2);
      const payments = +avgPayments.toFixed(2);
      const net = +(receipts - payments).toFixed(2);
      const closing = +(opening + net).toFixed(2);
      out.push({
        month: cursor,
        label: monthLabel(cursor),
        opening, receipts, payments, net, closing,
        forecast: true,
      });
      opening = closing;
    }
    return out;
  }, [months, forecastMonths, windowMonths]);

  const allMonths = useMemo(() => [...months, ...projection], [months, projection]);

  const totals = useMemo(() => {
    const r = months.reduce((s, m) => s + m.receipts, 0);
    const p = months.reduce((s, m) => s + m.payments, 0);
    return { receipts: +r.toFixed(2), payments: +p.toFixed(2), net: +(r - p).toFixed(2) };
  }, [months]);

  const finalClosing = allMonths.length > 0 ? allMonths[allMonths.length - 1].closing : 0;

  // Empty state placed AFTER all hook calls so the hook count stays
  // constant across renders (Rules of Hooks).
  if (!activePeriod.ready) return <PeriodEmptyState reportName="cash flow" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900">
          Cash Flow
          <span className="text-xs font-normal text-slate-500 ml-2">· {activePeriod.label}</span>
        </h2>

        <div className="flex items-center gap-2 text-xs text-slate-600 ml-auto">
          <label className="inline-flex items-center gap-1">
            Forecast
            <select
              value={forecastMonths}
              onChange={e => setForecastMonths(parseInt(e.target.value, 10))}
              className="text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white"
            >
              <option value="0">Off</option>
              <option value="1">1 month</option>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            using avg of last
            <select
              value={windowMonths}
              onChange={e => setWindowMonths(parseInt(e.target.value, 10))}
              disabled={forecastMonths === 0}
              className="text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 bg-white disabled:opacity-50"
            >
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
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

      {loading && months.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading…
        </div>
      ) : allMonths.length === 0 ? (
        <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
            <Wallet size={16} />
          </div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">No bank movement yet</p>
          <p className="text-xs text-slate-500">Cash flow needs at least one Bank account with posted transactions. Open the Input sheet and post a PAY or REC.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-28" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700">Month</th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">Opening</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-emerald-700">Receipts</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-rose-700">Payments</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">Net</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
                <th className="px-6 py-3 text-right">
                  <div className="text-xs font-semibold text-slate-700">Closing</div>
                  <div className="text-[11px] text-slate-400 font-normal">£</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {allMonths.map((m, i) => {
                const isFirstForecast = m.forecast && (i === 0 || !allMonths[i - 1].forecast);
                return (
                  <tr
                    key={m.month}
                    className={`hover:bg-slate-50 ${m.forecast ? 'text-slate-500' : ''} ${
                      isFirstForecast ? 'border-t-2 border-dashed border-indigo-200' : ''
                    }`}
                  >
                    <td className="px-6 py-1.5">
                      <span className={m.forecast ? 'italic' : ''}>{m.label}</span>
                      {isFirstForecast && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                          <Sparkles size={9} /> Forecast
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-1.5 text-right tabular-nums">{fmt(m.opening)}</td>
                    <td className="px-6 py-1.5 text-right tabular-nums text-emerald-700">{fmt(m.receipts)}</td>
                    <td className="px-6 py-1.5 text-right tabular-nums text-rose-700">{fmt(m.payments)}</td>
                    <td className={`px-6 py-1.5 text-right tabular-nums ${m.net > 0 ? 'text-emerald-700' : m.net < 0 ? 'text-rose-700' : ''}`}>
                      {fmt(m.net)}
                    </td>
                    <td className="px-6 py-1.5 text-right tabular-nums font-semibold">{fmt(m.closing)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-6 py-2.5 text-right text-slate-700 font-medium border-t-2 border-slate-300">
                  Actual {months.length} month{months.length === 1 ? '' : 's'}
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums border-t-2 border-slate-300">—</td>
                <td className="px-6 py-2.5 text-right tabular-nums font-semibold text-emerald-700 border-t-2 border-slate-300">{fmt(totals.receipts)}</td>
                <td className="px-6 py-2.5 text-right tabular-nums font-semibold text-rose-700 border-t-2 border-slate-300">{fmt(totals.payments)}</td>
                <td className={`px-6 py-2.5 text-right tabular-nums font-semibold border-t-2 border-slate-300 ${totals.net > 0 ? 'text-emerald-700' : totals.net < 0 ? 'text-rose-700' : ''}`}>
                  {fmt(totals.net)}
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums font-bold text-slate-900 border-t-2 border-slate-300">{fmt(finalClosing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {projection.length > 0 && (
        <p className="text-[11px] text-slate-500 px-1">
          <Sparkles size={10} className="inline-block mr-1 -mt-0.5 text-indigo-500" />
          Forecast rows project the rolling average of the last {windowMonths} actual months
          forward. Treat as a rough cash-position indicator, not a budget.
        </p>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(n => parseInt(n, 10));
  let nm = m + 1, ny = y;
  if (nm > 12) { nm = 1; ny++; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
