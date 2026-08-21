'use client';

/**
 * FixedAssetsTab — book-wide fixed-asset register. Shows a combined schedule
 * across every FA ledger (cost, depreciation b/fwd, period charge, c/fwd, NBV)
 * plus a per-ledger breakdown. Read-only overview: posting the depreciation
 * journal and disposing of an asset happen inside each ledger's own
 * Depreciation/Amortisation sub-tab — click "Open ledger" to drill in.
 *
 * The period is driven by the header's Year + Period selectors (read-only
 * here), exactly like the TB / P&L / Balance Sheet reports.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Boxes, ArrowRight, Printer, Download, AlertTriangle, Check } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { depreciationNoun } from '@/lib/bookkeeping/fixedAssets';
import { useBookNavigation } from './BookNavigationContext';
import { printReport } from '../reports/printReport';
import { exportRowsAsCsv, type CsvRow } from '../reports/exportReportCsv';
import ReportPrintHeader from '../reports/ReportPrintHeader';
import type { AssetScheduleRow, DepreciationMethod, LedgerDepreciationSetting } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  isAdmin?: boolean;
  /** True while this tab is the visible one. The register lives in a
   *  `hidden` div (always mounted), so it only fetched once on mount and
   *  showed stale figures after posting/disposing in a category ledger.
   *  Re-fetching each time the tab becomes visible keeps it fresh. */
  active?: boolean;
}

interface LedgerSchedule {
  ledger: string;
  settings: LedgerDepreciationSetting[];
  rows: AssetScheduleRow[];
  totals: { cost: number; depnBroughtForward: number; periodCharge: number; depnCarriedForward: number; nbv: number };
  reconciliation: { costLedger: number; costAssets: number; depnBfwdLedger: number; depnBfwdAssets: number };
}
interface ScheduleResponse {
  period: { from: string; to: string };
  schedules: LedgerSchedule[];
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '0.00';
  return Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function methodLabel(m: DepreciationMethod | null): string {
  if (m === 'reducing_balance') return 'Reducing balance';
  if (m === 'straight_line') return 'Straight line';
  return '—';
}
function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
function formatDateUkFull(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function FixedAssetsTab({ bookId, active = true }: Props) {
  const nav = useBookNavigation();
  const dataVersion = nav?.dataVersion;
  const ap = nav?.activePeriod ?? {
    ready: false, fromIso: null, toIso: null, fyStartIso: null, fyEndIso: null, label: '',
  };

  // Period is driven entirely by the header's Year + Period selectors (same as
  // every other report) — no manual From/To picking here.
  const fromIsoVal = ap.fromIso ?? ap.fyStartIso ?? null;
  const toIsoVal = ap.toIso ?? ap.fyEndIso ?? null;
  const periodValid = ap.ready && !!fromIsoVal && !!toIsoVal && fromIsoVal <= toIsoVal;

  const [schedules, setSchedules] = useState<LedgerSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const printRootRef = useRef<HTMLDivElement>(null);

  // Human period descriptor for the print header + file names, e.g.
  // "For the period 01/04/2025 to 31/03/2026".
  const periodLabel = fromIsoVal && toIsoVal ? `${formatDateUkFull(fromIsoVal)} to ${formatDateUkFull(toIsoVal)}` : '';

  const load = useCallback(async () => {
    if (!periodValid) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/depreciation?from=${fromIsoVal}&to=${toIsoVal}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to load fixed-asset schedule');
      }
      const body = (await r.json()) as ScheduleResponse;
      setSchedules(body.schedules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fromIsoVal, toIsoVal, periodValid, dataVersion]);

  useEffect(() => { void load(); }, [load]);

  // Refetch whenever the tab becomes visible again — posting or disposing in a
  // category ledger's Depreciation tab changes the schedule, and this register
  // is kept mounted (in a `hidden` div) so it wouldn't otherwise pick that up.
  useEffect(() => {
    if (active) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Combined totals across every FA ledger.
  const combined = useMemo(() => {
    return schedules.reduce(
      (acc, s) => ({
        cost: acc.cost + s.totals.cost,
        depnBroughtForward: acc.depnBroughtForward + s.totals.depnBroughtForward,
        periodCharge: acc.periodCharge + s.totals.periodCharge,
        depnCarriedForward: acc.depnCarriedForward + s.totals.depnCarriedForward,
        nbv: acc.nbv + s.totals.nbv,
      }),
      { cost: 0, depnBroughtForward: 0, periodCharge: 0, depnCarriedForward: 0, nbv: 0 },
    );
  }, [schedules]);

  // Only ledgers that actually hold assets are worth showing as cards.
  const ledgersWithAssets = useMemo(
    () => schedules.filter(s => s.rows.length > 0),
    [schedules],
  );

  // Book-wide reconciliation between the ledger balances and the itemised asset
  // register, summed across every FA category. Mirrors the per-category tie-out
  // in each ledger's Depreciation tab but rolled up here so the user can spot at
  // a glance whether the whole register agrees with the nominal ledger. Warn-
  // only — nothing is blocked, and we list which categories are out so the user
  // knows where to drill in.
  const recon = useMemo(() => {
    const sum = schedules.reduce(
      (a, s) => ({
        costLedger: a.costLedger + s.reconciliation.costLedger,
        costAssets: a.costAssets + s.reconciliation.costAssets,
        depnBfwdLedger: a.depnBfwdLedger + s.reconciliation.depnBfwdLedger,
        depnBfwdAssets: a.depnBfwdAssets + s.reconciliation.depnBfwdAssets,
      }),
      { costLedger: 0, costAssets: 0, depnBfwdLedger: 0, depnBfwdAssets: 0 },
    );
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const costDiff = round(sum.costLedger - sum.costAssets);
    const depnDiff = round(sum.depnBfwdLedger - sum.depnBfwdAssets);
    const costOutLedgers = schedules
      .filter(s => Math.abs(s.reconciliation.costLedger - s.reconciliation.costAssets) > 0.005)
      .map(s => s.ledger);
    const depnOutLedgers = schedules
      .filter(s => Math.abs(s.reconciliation.depnBfwdLedger - s.reconciliation.depnBfwdAssets) > 0.005)
      .map(s => s.ledger);
    return {
      ...sum,
      costDiff,
      depnDiff,
      costOut: Math.abs(costDiff) > 0.005,
      depnOut: Math.abs(depnDiff) > 0.005,
      costOutLedgers,
      depnOutLedgers,
    };
  }, [schedules]);

  const reconShown = ledgersWithAssets.length > 0 && (recon.costOut || recon.depnOut);

  // Build the CSV in the same shape as the on-screen layout: a block per
  // asset category (ledger header → asset rows → category total), then a
  // combined total row across every category.
  function exportCsv() {
    const rows: CsvRow[] = [[
      'Category', 'Asset', 'Purchased', 'Cost', 'Depn b/fwd', 'Charge', 'Depn c/fwd', 'NBV',
    ]];
    for (const s of ledgersWithAssets) {
      const noun = depreciationNoun(s.ledger);
      const current = s.settings[s.settings.length - 1] ?? null;
      const rate = current ? `${methodLabel(current.method)} · ${current.annual_rate}% · ${noun.toLowerCase()}` : 'No rate set';
      rows.push([`${s.ledger} (${rate})`, '', '', '', '', '', '', '']);
      for (const r of s.rows) {
        rows.push([
          s.ledger,
          r.asset.description + (r.asset.status === 'disposed' ? ' (disposed)' : ''),
          formatDateUk(r.asset.purchase_date),
          r.asset.cost.toFixed(2),
          r.depnBroughtForward.toFixed(2),
          r.periodCharge.toFixed(2),
          r.depnCarriedForward.toFixed(2),
          r.nbv.toFixed(2),
        ]);
      }
      rows.push([
        s.ledger, `${s.ledger} total`, '',
        s.totals.cost.toFixed(2),
        s.totals.depnBroughtForward.toFixed(2),
        s.totals.periodCharge.toFixed(2),
        s.totals.depnCarriedForward.toFixed(2),
        s.totals.nbv.toFixed(2),
      ]);
    }
    rows.push([
      '', 'Total fixed assets', '',
      combined.cost.toFixed(2),
      combined.depnBroughtForward.toFixed(2),
      combined.periodCharge.toFixed(2),
      combined.depnCarriedForward.toFixed(2),
      combined.nbv.toFixed(2),
    ]);
    exportRowsAsCsv(`Fixed Asset Schedule${periodLabel ? ` — ${periodLabel}` : ''}.csv`, rows);
  }

  return (
    <div
      ref={printRootRef}
      className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col bk-print-root bk-print-area"
      style={{ minHeight: 'calc(100vh - 14rem)' }}
    >
      <ReportPrintHeader
        bookId={bookId}
        reportTitle="Fixed Asset Schedule"
        periodDescription={periodLabel ? `For the period ${periodLabel}` : ''}
      />
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap print-hidden">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Boxes size={15} />
        </div>
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-slate-900">Fixed assets</h2>
          <p className="text-[11px] text-slate-500">
            Combined depreciation schedule across every asset category for the period.
          </p>
        </div>
        <div className="flex items-end gap-2">
          {periodValid && (
            <div className="flex items-end gap-4 mr-1">
              <div>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">From</div>
                <div className="text-sm font-semibold text-slate-800 tabular-nums">{formatDateUkFull(fromIsoVal!)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">To</div>
                <div className="text-sm font-semibold text-slate-800 tabular-nums">{formatDateUkFull(toIsoVal!)}</div>
              </div>
            </div>
          )}
          <Tooltip label="Print the fixed-asset schedule">
            <button
              type="button"
              onClick={() => printReport(printRootRef.current, `Fixed Asset Schedule${periodLabel ? ` — ${periodLabel}` : ''}`, { orientation: 'landscape' })}
              disabled={!periodValid || ledgersWithAssets.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={12} /> Print
            </button>
          </Tooltip>
          <Tooltip label="Export the schedule as a CSV">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!periodValid || ledgersWithAssets.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} /> Export
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Combined summary cards */}
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { label: 'Cost', value: combined.cost },
            { label: 'Depn b/fwd', value: combined.depnBroughtForward },
            { label: 'Charge this period', value: combined.periodCharge, accent: true },
            { label: 'Depn c/fwd', value: combined.depnCarriedForward },
            { label: 'Net book value', value: combined.nbv, strong: true },
          ].map(c => (
            <div
              key={c.label}
              className={`rounded-lg border px-3 py-2 ${
                c.accent ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{c.label}</div>
              <div className={`text-sm tabular-nums ${c.strong ? 'font-bold text-slate-900' : c.accent ? 'font-semibold text-violet-800' : 'font-semibold text-slate-800'}`}>
                {fmt(c.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reconciliation summary — warn-only roll-up of every category's tie-out
          between the nominal ledger and the itemised register. Hidden on print
          (it's an on-screen working aid, not part of the schedule). */}
      {ledgersWithAssets.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 print-hidden">
          {reconShown ? (
            <div className="text-xs rounded-lg px-3 py-2 border bg-amber-50 border-amber-200 text-amber-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} /> Register doesn’t fully reconcile to the ledger
              </div>
              {recon.costOut && (
                <div className="opacity-80">
                  Cost: ledger £{fmt(recon.costLedger)} vs itemised £{fmt(recon.costAssets)} (diff £{fmt(recon.costDiff)})
                  {recon.costOutLedgers.length > 0 && <> — {recon.costOutLedgers.join(', ')}</>}.
                </div>
              )}
              {recon.depnOut && (
                <div className="opacity-80">
                  Depn b/fwd: ledger £{fmt(recon.depnBfwdLedger)} vs allocated £{fmt(recon.depnBfwdAssets)} (diff £{fmt(recon.depnDiff)})
                  {recon.depnOutLedgers.length > 0 && <> — {recon.depnOutLedgers.join(', ')}</>}.
                </div>
              )}
              <div className="opacity-70">Warning only — open the category ledger’s Depreciation tab to allocate or correct. You can still post.</div>
            </div>
          ) : (
            <div className="text-xs rounded-lg px-3 py-2 border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-1.5">
              <Check size={13} /> <span className="font-semibold">Register reconciles to the ledger</span>
              <span className="opacity-80">— cost and depreciation b/fwd tie out across every category.</span>
            </div>
          )}
        </div>
      )}

      {/* Per-ledger breakdown */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin mr-1.5" /> Loading fixed-asset schedule…
          </div>
        ) : !periodValid ? (
          <p className="text-xs text-slate-400 italic py-6 text-center">
            Set a year-end on the book to build the schedule — the period follows the year and period selected in the header.
          </p>
        ) : ledgersWithAssets.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-6 text-center">
            No fixed assets yet. Assets are pulled from your “Cost — additions” postings, or add brought-forward
            assets from a category ledger’s Depreciation tab.
          </p>
        ) : (
          ledgersWithAssets.map(s => {
            const noun = depreciationNoun(s.ledger);
            const current = s.settings[s.settings.length - 1] ?? null;
            return (
              <div key={s.ledger} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-900">{s.ledger}</span>
                  <span className="text-[10px] text-slate-500">
                    {current ? `${methodLabel(current.method)} · ${current.annual_rate}% · ${noun.toLowerCase()}` : 'No rate set'}
                  </span>
                  <Tooltip label={`Open ${s.ledger} — post ${noun.toLowerCase()} or dispose assets`}>
                    <button
                      type="button"
                      onClick={() => nav?.openLedger(s.ledger)}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700"
                    >
                      Open ledger <ArrowRight size={11} />
                    </button>
                  </Tooltip>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Asset</th>
                      <th className="px-3 py-1.5 text-left w-24">Purchased</th>
                      <th className="px-3 py-1.5 text-right w-28">Cost</th>
                      <th className="px-3 py-1.5 text-right w-28">{noun} b/fwd</th>
                      <th className="px-3 py-1.5 text-right w-28">Charge</th>
                      <th className="px-3 py-1.5 text-right w-28">{noun} c/fwd</th>
                      <th className="px-3 py-1.5 text-right w-28">NBV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map(r => (
                      <tr key={r.asset.id} className="border-b border-slate-50">
                        <td className="px-3 py-1.5 text-slate-900">
                          {r.asset.description}
                          {r.asset.status === 'disposed' && (
                            <span className="ml-1.5 text-[10px] text-slate-400 italic">(disposed)</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600 tabular-nums">{formatDateUk(r.asset.purchase_date)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{fmt(r.asset.cost)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmt(r.depnBroughtForward)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-violet-800 font-medium">
                          {r.periodCharge > 0 ? fmt(r.periodCharge) : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmt(r.depnCarriedForward)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{fmt(r.nbv)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                      <td colSpan={2} className="px-3 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-slate-900">{fmt(s.totals.cost)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-700">{fmt(s.totals.depnBroughtForward)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-violet-800">{fmt(s.totals.periodCharge)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-700">{fmt(s.totals.depnCarriedForward)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-slate-900">{fmt(s.totals.nbv)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
