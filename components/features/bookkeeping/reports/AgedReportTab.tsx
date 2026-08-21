'use client';

/**
 * AgedReportTab — Aged Debtors (ledger="Customers") / Aged Creditors
 * (ledger="Suppliers"). Reads the server-side /aged endpoint, which ages each
 * account's open items (FIFO) into 0–30 / 31–60 / 61–90 / 90+ buckets as at a
 * chosen date.
 *
 * Aged by transaction (invoice) date. The "as at" date defaults to the
 * currently-selected period end and can be changed inline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Printer, Download } from 'lucide-react';
import DateInput, { parseUkDateStrict } from '../input/DateInput';
import { formatMoney } from '@/lib/bookkeeping/formatMoney';
import { AccountLink, useBookNavigation } from '../book/BookNavigationContext';
import ReportPrintHeader from './ReportPrintHeader';
import { printReport } from './printReport';
import { exportRowsAsCsv, type CsvRow } from './exportReportCsv';

interface AgedRow {
  accountId: string;
  accountName: string;
  current: number;
  b30: number;
  b60: number;
  b90: number;
  total: number;
}
interface Totals { current: number; b30: number; b60: number; b90: number; total: number }

interface Props {
  bookId: string;
  ledger: 'Customers' | 'Suppliers';
  /** End of the selected period — the default "as at" date. */
  defaultAsAtIso?: string | null;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function toUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

const BUCKET_COLS: { key: keyof Totals; label: string }[] = [
  { key: 'current', label: '0–30 days' },
  { key: 'b30',     label: '31–60 days' },
  { key: 'b60',     label: '61–90 days' },
  { key: 'b90',     label: '90+ days' },
];

export default function AgedReportTab({ bookId, ledger, defaultAsAtIso }: Props) {
  const dataVersion = useBookNavigation()?.dataVersion;
  const title = ledger === 'Customers' ? 'Aged Debtors' : 'Aged Creditors';
  const subtitle = ledger === 'Customers'
    ? 'Outstanding customer balances by age'
    : 'Outstanding supplier balances by age';

  const [asAtIso, setAsAtIso] = useState<string>(defaultAsAtIso ?? todayIso());
  const [rows, setRows] = useState<AgedRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const printRootRef = useRef<HTMLDivElement>(null);

  // The period bar emits its date after mount — adopt it when it lands so the
  // report opens on the period end rather than today.
  useEffect(() => { if (defaultAsAtIso) setAsAtIso(defaultAsAtIso); }, [defaultAsAtIso]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/aged?ledger=${ledger}&as_at=${asAtIso}`);
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? 'Failed to load report'); }
      const d = await r.json() as { rows: AgedRow[]; totals: Totals };
      setRows(d.rows); setTotals(d.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
      setRows([]); setTotals(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, ledger, asAtIso, dataVersion]);
  useEffect(() => { void load(); }, [load]);

  function handleExport() {
    const head = ledger === 'Customers' ? 'Customer' : 'Supplier';
    const csv: CsvRow[] = [[head, '0-30 days', '31-60 days', '61-90 days', '90+ days', 'Total']];
    for (const r of rows ?? []) {
      csv.push([r.accountName, r.current.toFixed(2), r.b30.toFixed(2), r.b60.toFixed(2), r.b90.toFixed(2), r.total.toFixed(2)]);
    }
    if (totals) csv.push(['Total', totals.current.toFixed(2), totals.b30.toFixed(2), totals.b60.toFixed(2), totals.b90.toFixed(2), totals.total.toFixed(2)]);
    exportRowsAsCsv(`${title} — as at ${toUk(asAtIso)}.csv`, csv);
  }

  return (
    <div className="space-y-3 bk-print-root" ref={printRootRef}>
      <ReportPrintHeader bookId={bookId} reportTitle={title} periodDescription={`As at ${toUk(asAtIso)}`} />
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap print-hidden">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle} · aged by invoice date</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-medium">As at</span>
            <div className="w-32 rounded-md border border-slate-300 bg-white">
              <DateInput
                value={toUk(asAtIso)}
                onChange={v => { const iso = parseUkDateStrict(v); if (iso) setAsAtIso(iso); }}
                className="px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 rounded-md"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={() => printReport(printRootRef.current, `${title} — as at ${toUk(asAtIso)}`)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Printer size={12} /> Print
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!rows || rows.length === 0}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="border border-slate-300 rounded-md overflow-x-auto bg-white bk-print-area">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left border-r border-slate-300">{ledger === 'Customers' ? 'Customer' : 'Supplier'}</th>
              {BUCKET_COLS.map(c => (
                <th key={c.key} className="px-3 py-2 text-right border-r border-slate-300 w-28">{c.label}</th>
              ))}
              <th className="px-3 py-2 text-right w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                <Loader2 size={16} className="animate-spin inline mr-2" /> Loading…
              </td></tr>
            )}
            {!loading && rows && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                No outstanding balances as at {toUk(asAtIso)}.
              </td></tr>
            )}
            {!loading && rows && rows.map(r => (
              <tr key={r.accountId} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-1.5 border-r border-slate-200">
                  <AccountLink account={{ id: r.accountId, name: r.accountName, ledger }} showLedger={false} />
                </td>
                {BUCKET_COLS.map(c => (
                  <td key={c.key} className="px-3 py-1.5 text-right border-r border-slate-200 tabular-nums text-slate-700">
                    {r[c.key as keyof AgedRow] ? formatMoney(r[c.key as keyof AgedRow] as number) : ''}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">{formatMoney(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && totals && rows && rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2 border-r border-slate-200">Total</td>
                {BUCKET_COLS.map(c => (
                  <td key={c.key} className="px-3 py-2 text-right border-r border-slate-200 tabular-nums">{formatMoney(totals[c.key])}</td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-[11px] text-slate-400 print-hidden">
        Open items are aged by invoice date; payments and credits are applied to the oldest invoices first.
        Credit balances (overpayments / credits on account) appear as a negative in the 0–30 column.
      </p>
    </div>
  );
}
