'use client';

/**
 * FixedAssetsTab — book-wide fixed-asset register. Shows a combined schedule
 * across every FA ledger (cost, depreciation b/fwd, period charge, c/fwd, NBV)
 * plus a per-ledger breakdown. Read-only overview: posting the depreciation
 * journal and disposing of an asset happen inside each ledger's own
 * Depreciation/Amortisation sub-tab — click "Open ledger" to drill in.
 *
 * The period is pre-filled from the header's active period but editable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Boxes, ArrowRight } from 'lucide-react';
import DateInput, { fromIso, parseUkDateStrict } from '../input/DateInput';
import Tooltip from '@/components/ui/Tooltip';
import { depreciationNoun } from '@/lib/bookkeeping/fixedAssets';
import { useBookNavigation } from './BookNavigationContext';
import type { AssetScheduleRow, DepreciationMethod, LedgerDepreciationSetting } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  isAdmin?: boolean;
}

interface LedgerSchedule {
  ledger: string;
  settings: LedgerDepreciationSetting[];
  rows: AssetScheduleRow[];
  totals: { cost: number; depnBroughtForward: number; periodCharge: number; depnCarriedForward: number; nbv: number };
  reconciliation: { costBfwdLedger: number; costBfwdAssets: number; depnBfwdLedger: number; depnBfwdAssets: number };
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

export default function FixedAssetsTab({ bookId }: Props) {
  const nav = useBookNavigation();
  const ap = nav?.activePeriod;

  const defaultFrom = ap?.fromIso ?? ap?.fyStartIso ?? '';
  const defaultTo = ap?.toIso ?? ap?.fyEndIso ?? '';
  const [fromUk, setFromUk] = useState(defaultFrom ? fromIso(defaultFrom) : '');
  const [toUk, setToUk] = useState(defaultTo ? fromIso(defaultTo) : '');

  // Keep the period in sync if the header period arrives/changes while the
  // tab is mounted but the user hasn't typed their own dates yet.
  useEffect(() => {
    if (!fromUk && defaultFrom) setFromUk(fromIso(defaultFrom));
    if (!toUk && defaultTo) setToUk(fromIso(defaultTo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFrom, defaultTo]);

  const fromIsoVal = parseUkDateStrict(fromUk);
  const toIsoVal = parseUkDateStrict(toUk);
  const periodValid = !!fromIsoVal && !!toIsoVal && fromIsoVal <= toIsoVal;

  const [schedules, setSchedules] = useState<LedgerSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  }, [bookId, fromIsoVal, toIsoVal, periodValid]);

  useEffect(() => { void load(); }, [load]);

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

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ minHeight: 'calc(100vh - 14rem)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
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
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
            From
            <DateInput value={fromUk} onChange={setFromUk} className="mt-0.5 w-28" />
          </label>
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
            To
            <DateInput value={toUk} onChange={setToUk} className="mt-0.5 w-28" />
          </label>
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
            Pick a valid period to build the schedule.
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
