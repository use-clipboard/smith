'use client';

/**
 * ManagementAccountsTab — a client-ready management accounts pack.
 *
 * A pack = an editable AI-generated COVER NOTE (basis of preparation) followed
 * by the selected statement(s): Profit & Loss and/or Balance Sheet, plus an
 * optional forecast P&L that projects a partial period out to the full year.
 * Everything is driven by the book's selected year-end + period (from
 * BookNavigation), so switching the period bar re-drives the whole pack.
 *
 * The actual P&L / BS are the existing report components rendered in `embedded`
 * mode (no duplicated figure logic). The forecast is ForecastPnl. Nothing is
 * persisted — the user downloads to PDF (print) or Excel (CSV). The cover note
 * survives tab switches (tabs stay mounted) but resets on a full reload.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Printer, Sparkles, RefreshCw, FileText, Pencil, Check, Download, LineChart } from 'lucide-react';
import ProfitLossTab from './ProfitLossTab';
import BalanceSheetTab from './BalanceSheetTab';
import ForecastPnl from './ForecastPnl';
import PeriodEmptyState from './PeriodEmptyState';
import { printReport } from './printReport';
import { exportRowsAsCsv, type CsvRow } from './exportReportCsv';
import { useBookNavigation } from '../book/BookNavigationContext';

interface Props {
  bookId: string;
  /** Fallback entity name for the pack header before the note is generated
   *  (the narrative API returns the authoritative client name). */
  entityName?: string;
  onOpenAccount?: (a: { id: string; name: string; ledger: string | null; code?: string | null }) => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function longDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default function ManagementAccountsTab({ bookId, entityName, onOpenAccount }: Props) {
  const nav = useBookNavigation();
  const activePeriod = nav?.activePeriod ?? { ready: false, fromIso: null, toIso: null, label: '' };

  const [includePnl, setIncludePnl] = useState(true);
  const [includeBs, setIncludeBs] = useState(true);
  const [includeForecast, setIncludeForecast] = useState(false);
  const [context, setContext] = useState('');

  const [narrative, setNarrative] = useState('');
  const [meta, setMeta] = useState<{ entityName: string; companyNumber: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const printRootRef = useRef<HTMLDivElement>(null);

  // Latest CSV rows / forecast basis reported up by the child statements.
  const pnlRows = useRef<CsvRow[]>([]);
  const bsRows = useRef<CsvRow[]>([]);
  const forecastRows = useRef<CsvRow[]>([]);
  const forecastBasis = useRef<string>('');

  const setPnlRows = useCallback((r: CsvRow[]) => { pnlRows.current = r; }, []);
  const setBsRows = useCallback((r: CsvRow[]) => { bsRows.current = r; }, []);
  const setForecastRows = useCallback((r: CsvRow[]) => { forecastRows.current = r; }, []);
  const setForecastBasis = useCallback((b: string) => { forecastBasis.current = b; }, []);

  const packTitle = useMemo(() => {
    if (includePnl && includeBs) return 'Management Accounts';
    if (includePnl) return 'Management Profit and Loss Account';
    if (includeBs) return 'Management Balance Sheet';
    return 'Management Accounts';
  }, [includePnl, includeBs]);

  const periodLabel = useMemo(() => {
    const from = longDate(activePeriod.fromIso);
    const to = longDate(activePeriod.toIso);
    if (from && to) return `For the period ${from} to ${to}`;
    if (to) return `For the period ended ${to}`;
    return '';
  }, [activePeriod.fromIso, activePeriod.toIso]);

  const headerEntityName = meta?.entityName || entityName || '';

  async function generate() {
    if (!includePnl && !includeBs) { setError('Choose at least one statement to include.'); return; }
    setGenerating(true);
    setError('');
    try {
      const statements = [
        ...(includePnl ? ['pnl'] : []),
        ...(includeBs ? ['bs'] : []),
      ];
      const r = await fetch(`/api/bookkeeping/books/${bookId}/management-accounts/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: activePeriod.fromIso,
          to: activePeriod.toIso,
          statements,
          context,
          forecastBasis: includeForecast ? forecastBasis.current : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not generate the cover note.');
      setNarrative(d.narrative ?? '');
      setMeta({ entityName: d.entityName ?? entityName ?? '', companyNumber: d.companyNumber ?? null });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the cover note.');
    } finally {
      setGenerating(false);
    }
  }

  function downloadExcel() {
    const rows: CsvRow[] = [];
    if (headerEntityName) rows.push([headerEntityName]);
    if (meta?.companyNumber) rows.push([`Company Number: ${meta.companyNumber}`]);
    rows.push([packTitle]);
    if (periodLabel) rows.push([periodLabel]);
    rows.push([]);
    if (narrative) {
      rows.push(['Cover note']);
      for (const line of narrative.split('\n')) rows.push([line]);
      rows.push([]);
    }
    if (includePnl) {
      rows.push([includeForecast ? 'Forecast Profit and Loss' : 'Profit and Loss Account']);
      rows.push(...(includeForecast ? forecastRows.current : pnlRows.current));
      rows.push([]);
    }
    if (includeBs) {
      rows.push(['Balance Sheet']);
      rows.push(...bsRows.current);
      rows.push([]);
    }
    exportRowsAsCsv(`${packTitle} — ${headerEntityName || 'Book'}.csv`, rows);
  }

  // Empty state placed after the hooks so the hook count stays constant.
  if (!activePeriod.ready) return <PeriodEmptyState reportName="management accounts" />;

  return (
    <div className="space-y-3">
      {/* ── Controls (never printed) ─────────────────────────────────────── */}
      <div className="print-hidden rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <FileText size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Management Accounts</h2>
            <p className="text-xs text-slate-500">
              A cover note plus the statements you select, for {activePeriod.label}. Generate the note, edit it as you like, then download to PDF or Excel.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xs font-medium text-slate-600">Include:</span>
          <label className="text-xs text-slate-700 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={includePnl} onChange={e => setIncludePnl(e.target.checked)} className="rounded border-slate-300" />
            Profit &amp; Loss
          </label>
          <label className="text-xs text-slate-700 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={includeBs} onChange={e => setIncludeBs(e.target.checked)} className="rounded border-slate-300" />
            Balance Sheet
          </label>
          <label className={`text-xs inline-flex items-center gap-1.5 ${includePnl ? 'text-slate-700' : 'text-slate-300'}`}>
            <input type="checkbox" checked={includeForecast && includePnl} disabled={!includePnl} onChange={e => setIncludeForecast(e.target.checked)} className="rounded border-slate-300" />
            <LineChart size={12} /> Add forecast P&amp;L
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Context for the cover note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            rows={2}
            placeholder="Anything the note should mention — e.g. first trading period after incorporation on 5 January 2026; trade transferred from the sole trader."
            className="w-full text-xs rounded-lg border border-slate-200 px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-y"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : narrative ? <RefreshCw size={14} /> : <Sparkles size={14} />}
            {generating ? 'Writing…' : narrative ? 'Regenerate note' : 'Generate cover note'}
          </button>
          {narrative && (
            <button
              type="button"
              onClick={() => setEditing(e => !e)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            >
              {editing ? <><Check size={12} /> Done editing</> : <><Pencil size={12} /> Edit note</>}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={downloadExcel}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            >
              <Download size={12} /> Excel
            </button>
            <button
              type="button"
              onClick={() => printRootRef.current && printReport(printRootRef.current, `${packTitle} — ${headerEntityName || 'Book'}`)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            >
              <Printer size={12} /> Print / PDF
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {/* ── The pack itself (the single print root) ──────────────────────── */}
      <div ref={printRootRef} className="bk-print-root space-y-5">
        {/* Pack header — deterministic facts, always correct. */}
        <div className="bk-print-area rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-4">
          {headerEntityName && <div className="text-base font-bold text-slate-900">{headerEntityName}</div>}
          {meta?.companyNumber && <div className="text-xs text-slate-600">Company Number: {meta.companyNumber}</div>}
          <div className="text-sm font-semibold text-slate-800 mt-1">{packTitle}</div>
          {periodLabel && <div className="text-xs text-slate-600">{periodLabel}</div>}

          {/* Cover note */}
          {narrative ? (
            editing ? (
              <textarea
                value={narrative}
                onChange={e => setNarrative(e.target.value)}
                rows={14}
                className="mt-4 w-full text-sm rounded-lg border border-slate-200 px-3 py-2 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-y"
              />
            ) : (
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{narrative}</div>
            )
          ) : (
            <p className="mt-4 text-xs text-slate-400 italic">
              No cover note yet — choose your statements, add any context, and select “Generate cover note”.
            </p>
          )}
        </div>

        {/* Statements. The actual P&L is replaced by the forecast P&L when the
            forecast is switched on (the forecast table already carries the
            actual column). The Balance Sheet is always actuals. */}
        {includePnl && !includeForecast && (
          <div className="bk-print-area rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <ProfitLossTab bookId={bookId} onOpenAccount={onOpenAccount} embedded onCsvRows={setPnlRows} />
          </div>
        )}
        {includePnl && includeForecast && (
          <div className="bk-print-area rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <ForecastPnl bookId={bookId} onCsvRows={setForecastRows} onBasisChange={setForecastBasis} />
          </div>
        )}
        {includeBs && (
          <div className="bk-print-area rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <BalanceSheetTab bookId={bookId} onOpenAccount={onOpenAccount} embedded onCsvRows={setBsRows} />
          </div>
        )}
      </div>
    </div>
  );
}
