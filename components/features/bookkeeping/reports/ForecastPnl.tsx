'use client';

/**
 * ForecastPnl — a forecast Profit & Loss for the Management Accounts pack.
 *
 * Projects a partial period of actuals out to the full financial year, the way
 * an accountant prepares management accounts: pick a basis, get a sensible
 * starting point, then override any line by hand (it's a best guess).
 *
 * Columns: Account · Period actual · % of revenue · Prior year (full) ·
 *          PY % of revenue · Forecast (full year, editable) · Forecast % rev
 *
 * Two projection bases:
 *   • Annualise — pro-rata the period actuals to the full FY by days elapsed.
 *   • Prior-year ratios — apply last year's cost/expense %-of-revenue to a
 *     projected revenue (default = annualised revenue, editable). Holds margins
 *     at last year's level until the user overrides a line.
 *
 * Nothing is persisted. The component reports its CSV rows + the basis sentence
 * up to the pack via callbacks (for Excel export and the AI cover note).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';
import { useBookNavigation } from '../book/BookNavigationContext';
import type { CsvRow } from './exportReportCsv';
import {
  type PlBalance, type PlBucket,
  plDisplayValue, fmtMoney, fmtPct, daysInclusive, isoMinusOneYear, longDate,
  fetchPlBalances, orderPlLedgers,
} from './plGrouping';

export type ForecastMethod = 'annualise' | 'ratios';

interface Props {
  bookId: string;
  /** Reports the current forecast as CSV rows for the pack's Excel export. */
  onCsvRows?: (rows: CsvRow[]) => void;
  /** Reports a plain-English basis sentence for the AI cover note. */
  onBasisChange?: (basis: string) => void;
}

interface FRow {
  id: string; name: string; ledger: string | null; code: string | null;
  actual: number; prior: number; forecast: number;
}
interface FSection {
  title: string; bucket: PlBucket; rows: FRow[];
  actualTotal: number; priorTotal: number; forecastTotal: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export default function ForecastPnl({ bookId, onCsvRows, onBasisChange }: Props) {
  const nav = useBookNavigation();
  const dataVersion = nav?.dataVersion;
  const ap = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, fyStartIso: null, fyEndIso: null, label: '' };

  const [actual, setActual] = useState<PlBalance[]>([]);
  const [prior, setPrior]   = useState<PlBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  const [method, setMethod] = useState<ForecastMethod>('annualise');
  /** Per-account manual override (best guess). Keyed by account id. */
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  /** Projected full-year revenue used by the ratios method. null = use the
   *  default (annualised actual). A typed value overrides it. */
  const [revenueInput, setRevenueInput] = useState<number | null>(null);

  // Period actuals = the selected period; forecast target = the whole FY;
  // prior-year basis = the FY shifted back a year.
  const periodFrom = ap.fromIso, periodTo = ap.toIso;
  const fyStart = ap.fyStartIso, fyEnd = ap.fyEndIso;

  useEffect(() => {
    if (!ap.ready || !periodFrom || !periodTo || !fyStart || !fyEnd) { setActual([]); setPrior([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [cur, pri] = await Promise.all([
          fetchPlBalances(bookId, periodFrom, periodTo),
          fetchPlBalances(bookId, isoMinusOneYear(fyStart), isoMinusOneYear(fyEnd)),
        ]);
        if (cancelled) return;
        setActual(cur); setPrior(pri);
        // Reset overrides when the underlying period changes — they no longer
        // apply to a different period's lines.
        setOverrides({}); setRevenueInput(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, ap.ready, periodFrom, periodTo, fyStart, fyEnd, dataVersion]);

  // Annualisation factor: full FY days ÷ elapsed period days. ~1 when the
  // selected period already is the whole year.
  const factor = useMemo(() => {
    if (!periodFrom || !periodTo || !fyStart || !fyEnd) return 1;
    const pd = daysInclusive(periodFrom, periodTo);
    return pd > 0 ? daysInclusive(fyStart, fyEnd) / pd : 1;
  }, [periodFrom, periodTo, fyStart, fyEnd]);

  // Per-account display values for the two actual columns.
  const valById = useMemo(() => {
    const cur = new Map<string, number>();
    const pri = new Map<string, number>();
    for (const a of actual) cur.set(a.id, plDisplayValue(a));
    for (const a of prior) pri.set(a.id, plDisplayValue(a));
    return { cur, pri };
  }, [actual, prior]);

  const currentRevenue = useMemo(
    () => r2(actual.filter(a => a.account_type === 'income').reduce((s, a) => s + plDisplayValue(a), 0)),
    [actual],
  );
  const priorRevenue = useMemo(
    () => r2(prior.filter(a => a.account_type === 'income').reduce((s, a) => s + plDisplayValue(a), 0)),
    [prior],
  );
  // Default projected revenue = annualised current revenue; user can override.
  const defaultRevenueForecast = r2(currentRevenue * factor);
  const revenueForecast = revenueInput ?? defaultRevenueForecast;
  const hasPriorYear = prior.length > 0 && Math.abs(priorRevenue) > 0.005;

  /** The auto (pre-override) forecast for one account under the chosen basis. */
  const autoForecast = useCallback((acc: { id: string; account_type: string }): number => {
    const a = valById.cur.get(acc.id) ?? 0;
    const p = valById.pri.get(acc.id) ?? 0;
    if (method === 'annualise') return r2(a * factor);
    // ratios
    if (acc.account_type === 'income') {
      // Scale income lines so they sum to the projected revenue.
      return r2(Math.abs(currentRevenue) > 0.005 ? a * (revenueForecast / currentRevenue) : a * factor);
    }
    // Costs/expenses: hold last year's %-of-revenue, applied to projected revenue.
    if (hasPriorYear) return r2(p * (revenueForecast / priorRevenue));
    return r2(a * factor); // no prior year to read a ratio from — fall back
  }, [method, factor, valById, currentRevenue, revenueForecast, priorRevenue, hasPriorYear]);

  // Build the canonical P&L sections with the three columns.
  const sections: FSection[] = useMemo(() => {
    const union = new Map<string, PlBalance>();
    for (const a of [...actual, ...prior]) if (!union.has(a.id)) union.set(a.id, a);
    const all = [...union.values()];
    const ordered = orderPlLedgers(all);
    const byLedger = (lg: string) => all.filter(a => (a.ledger ?? '').trim() === lg);
    return ordered.map(def => {
      const rows: FRow[] = byLedger(def.ledger)
        .map(a => {
          const forecast = overrides[a.id] ?? autoForecast(a);
          return {
            id: a.id, name: a.name, ledger: a.ledger, code: a.code ?? null,
            actual: valById.cur.get(a.id) ?? 0,
            prior: valById.pri.get(a.id) ?? 0,
            forecast,
          };
        })
        .filter(r => Math.abs(r.actual) >= 0.005 || Math.abs(r.prior) >= 0.005 || Math.abs(r.forecast) >= 0.005)
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        title: def.title, bucket: def.bucket, rows,
        actualTotal:   r2(rows.reduce((s, r) => s + r.actual, 0)),
        priorTotal:    r2(rows.reduce((s, r) => s + r.prior, 0)),
        forecastTotal: r2(rows.reduce((s, r) => s + r.forecast, 0)),
      };
    });
  }, [actual, prior, overrides, autoForecast, valById]);

  function sumBucket(b: PlBucket) {
    return sections.filter(s => s.bucket === b).reduce(
      (acc, s) => ({
        actual: acc.actual + s.actualTotal,
        prior: acc.prior + s.priorTotal,
        forecast: acc.forecast + s.forecastTotal,
      }),
      { actual: 0, prior: 0, forecast: 0 },
    );
  }
  const incomeT = sumBucket('income');
  const cosT    = sumBucket('cost_of_sales');
  const expT    = sumBucket('expense');
  const taxT    = sumBucket('taxation');
  const gross     = { actual: incomeT.actual - cosT.actual, prior: incomeT.prior - cosT.prior, forecast: incomeT.forecast - cosT.forecast };
  const operating = { actual: gross.actual - expT.actual,    prior: gross.prior - expT.prior,    forecast: gross.forecast - expT.forecast };
  const net       = { actual: operating.actual - taxT.actual, prior: operating.prior - taxT.prior, forecast: operating.forecast - taxT.forecast };

  // % of revenue helpers per column (revenue base differs by column).
  const pctActual   = (n: number) => Math.abs(currentRevenue) > 0.005 ? n / currentRevenue : null;
  const pctPrior    = (n: number) => Math.abs(priorRevenue) > 0.005 ? n / priorRevenue : null;
  const pctForecast = (n: number) => Math.abs(revenueForecast) > 0.005 ? n / revenueForecast : null;

  const periodLabel = periodFrom && periodTo ? `${longDate(periodFrom)} to ${longDate(periodTo)}` : ap.label;
  const fyEndLabel = longDate(fyEnd);

  // Basis sentence for the AI cover note.
  const basis = useMemo(() => {
    if (method === 'annualise') {
      return `a forecast to the year ending ${fyEndLabel} prepared by annualising the results for the period ${periodLabel}`;
    }
    const rev = revenueForecast.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return `a forecast to the year ending ${fyEndLabel} prepared by applying the prior year's cost ratios to projected revenue of £${rev}`;
  }, [method, fyEndLabel, periodLabel, revenueForecast]);

  // ── Report CSV rows + basis up to the pack (refs/effects, no render loops) ──
  const csvCb = useRef(onCsvRows); csvCb.current = onCsvRows;
  const basisCb = useRef(onBasisChange); basisCb.current = onBasisChange;

  const csvRows: CsvRow[] = useMemo(() => {
    const rows: CsvRow[] = [[
      'Section', 'Account',
      `Period actual (${periodLabel})`, '% of revenue',
      'Prior year', 'PY % of revenue',
      `Forecast (year ending ${fyEndLabel})`, 'Forecast % of revenue',
    ]];
    const line = (section: string, name: string, a: number, p: number, f: number) =>
      rows.push([section, name, a.toFixed(2), fmtPct(pctActual(a)), p.toFixed(2), fmtPct(pctPrior(p)), f.toFixed(2), fmtPct(pctForecast(f))]);
    for (const s of sections) {
      if (s.rows.length === 0) continue;
      rows.push([s.title, '', '', '', '', '', '', '']);
      for (const r of s.rows) line(s.title, r.name, r.actual, r.prior, r.forecast);
      line(s.title, `${s.title} total`, s.actualTotal, s.priorTotal, s.forecastTotal);
    }
    line('', 'Gross profit', gross.actual, gross.prior, gross.forecast);
    line('', 'Operating profit', operating.actual, operating.prior, operating.forecast);
    line('', 'Net profit', net.actual, net.prior, net.forecast);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, gross, operating, net, periodLabel, fyEndLabel, currentRevenue, priorRevenue, revenueForecast]);

  useEffect(() => { csvCb.current?.(csvRows); }, [csvRows]);
  useEffect(() => { basisCb.current?.(basis); }, [basis]);

  if (loading && actual.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
        <Loader2 size={14} className="animate-spin mr-2" /> Building forecast…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900 px-1">Forecast Profit and Loss — year ending {fyEndLabel}</h3>

      {/* Basis controls (not printed). */}
      <div className="print-hidden flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="font-medium text-slate-600">Basis:</span>
        <label className="inline-flex items-center gap-1.5 text-slate-700">
          <input type="radio" name="fcst-method" checked={method === 'annualise'} onChange={() => setMethod('annualise')} />
          Annualise the period
        </label>
        <label className="inline-flex items-center gap-1.5 text-slate-700">
          <input type="radio" name="fcst-method" checked={method === 'ratios'} onChange={() => setMethod('ratios')} />
          Prior-year cost ratios
        </label>
        {method === 'ratios' && (
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            Projected revenue £
            <input
              type="number"
              value={revenueInput ?? Math.round(defaultRevenueForecast)}
              onChange={e => setRevenueInput(e.target.value === '' ? null : Number(e.target.value))}
              className="w-28 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
            />
            <span className="text-slate-400">(defaults to annualised sales)</span>
          </span>
        )}
        {Object.keys(overrides).length > 0 && (
          <button type="button" onClick={() => setOverrides({})} className="text-indigo-700 hover:underline ml-auto">
            Reset {Object.keys(overrides).length} manual edit{Object.keys(overrides).length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {method === 'ratios' && !hasPriorYear && (
        <div className="print-hidden text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No prior-year figures found for this book, so cost lines fall back to annualised actuals. Type your own forecast figures to override.
        </div>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm bk-print-area">
        <table className="w-full text-sm">
          <thead className="bk-sticky-thead">
            <tr className="text-[11px] text-slate-500">
              <th />
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Actual<div className="font-normal text-slate-400">{periodLabel}</div></th>
              <th className="px-3 py-2 text-right">% rev</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Prior year</th>
              <th className="px-3 py-2 text-right">% rev</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Forecast<div className="font-normal text-slate-400">to {fyEndLabel}</div></th>
              <th className="px-3 py-2 text-right">% rev</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s, sIdx) => (
              <FcstSection
                key={s.title}
                section={s}
                pctActual={pctActual} pctPrior={pctPrior} pctForecast={pctForecast}
                onEdit={(id, v) => setOverrides(o => ({ ...o, [id]: r2(v) }))}
                onClearEdit={(id) => setOverrides(o => { const n = { ...o }; delete n[id]; return n; })}
                isOverridden={(id) => id in overrides}
                subtotalRow={
                  sIdx === 1 ? { label: 'Gross profit', ...gross } :
                  sIdx === 2 ? { label: 'Operating profit', ...operating } : null
                }
                pctOf={{ a: pctActual, p: pctPrior, f: pctForecast }}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td className="px-3 py-2.5 font-semibold text-slate-900">Net profit</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmtMoney(net.actual)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{fmtPct(pctActual(net.actual))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmtMoney(net.prior)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{fmtPct(pctPrior(net.prior))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmtMoney(net.forecast)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{fmtPct(pctForecast(net.forecast))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 px-1">
        Forecast figures are estimates — edit any line to record your own best guess. Based on {basis}.
      </p>
    </div>
  );
}

function FcstSection({
  section, pctActual, pctPrior, pctForecast, onEdit, onClearEdit, isOverridden, subtotalRow, pctOf,
}: {
  section: FSection;
  pctActual: (n: number) => number | null;
  pctPrior: (n: number) => number | null;
  pctForecast: (n: number) => number | null;
  onEdit: (id: string, v: number) => void;
  onClearEdit: (id: string) => void;
  isOverridden: (id: string) => boolean;
  subtotalRow: { label: string; actual: number; prior: number; forecast: number } | null;
  pctOf: { a: (n: number) => number | null; p: (n: number) => number | null; f: (n: number) => number | null };
}) {
  if (section.rows.length === 0) return null;
  return (
    <>
      <tr><td colSpan={7} className="px-3 pt-3 pb-1 font-semibold text-slate-900">{section.title}</td></tr>
      {section.rows.map(r => (
        <tr key={r.id} className="hover:bg-slate-50">
          <td className="px-3 py-1 pl-6 text-slate-700">
            <AccountCodeTag code={r.code} className="mr-2" />{r.name}
          </td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-700">{fmtMoney(r.actual)}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctActual(r.actual))}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-700">{fmtMoney(r.prior)}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctPrior(r.prior))}</td>
          <td className="px-3 py-1 text-right tabular-nums">
            {/* Editable forecast — print shows the value, screen shows an input. */}
            <span className="bk-print-only hidden">{fmtMoney(r.forecast)}</span>
            <input
              type="number"
              value={Math.round(r.forecast)}
              onChange={e => onEdit(r.id, Number(e.target.value))}
              onDoubleClick={() => onClearEdit(r.id)}
              title={isOverridden(r.id) ? 'Manually edited — double-click to reset to the calculated figure' : undefined}
              className={`print-hidden w-24 rounded border px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 ${
                isOverridden(r.id) ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-medium' : 'border-slate-200 text-slate-800'
              }`}
            />
          </td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctForecast(r.forecast))}</td>
        </tr>
      ))}
      {/* Section subtotal */}
      <tr>
        <td className="px-3 py-1" />
        <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmtMoney(section.actualTotal)}</td>
        <td />
        <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmtMoney(section.priorTotal)}</td>
        <td />
        <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300">{fmtMoney(section.forecastTotal)}</td>
        <td />
      </tr>
      {/* Gross / Operating profit after CoS / Expenses */}
      {subtotalRow && (
        <tr>
          <td className="px-3 py-1 text-slate-900 font-medium">{subtotalRow.label}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300 font-semibold">{fmtMoney(subtotalRow.actual)}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctOf.a(subtotalRow.actual))}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300 font-semibold">{fmtMoney(subtotalRow.prior)}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctOf.p(subtotalRow.prior))}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-900 border-t border-slate-300 font-semibold">{fmtMoney(subtotalRow.forecast)}</td>
          <td className="px-3 py-1 text-right tabular-nums text-slate-400">{fmtPct(pctOf.f(subtotalRow.forecast))}</td>
        </tr>
      )}
    </>
  );
}
