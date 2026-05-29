'use client';

/**
 * DepreciationTab — the per-FA-ledger depreciation / amortisation workspace.
 * Mounted as a sub-tab in AccountsLedgerView for any "FA -" ledger (the same
 * slot the Bank ledger uses for Reconcile / History).
 *
 * It lets the user:
 *   • set the effective-dated rate + method for the whole ledger (asset category)
 *   • see the per-asset schedule (cost, b/fwd, charge, c/fwd, NBV) for a period
 *   • add itemised brought-forward assets (additions are pulled automatically
 *     from "Cost - additions" postings)
 *   • post the depreciation journal for the period (one JRN per ledger)
 *   • dispose of an asset (catch-up depn to the date, then the disposal journal)
 *
 * The period is pre-filled from the header's active period but editable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Settings2, AlertTriangle, Check, X, PackageMinus, Pencil, Undo2, RotateCcw } from 'lucide-react';
import DateInput, { fromIso, parseUkDateStrict } from '../input/DateInput';
import Tooltip from '@/components/ui/Tooltip';
import { depreciationNoun } from '@/lib/bookkeeping/fixedAssets';
import { useBookNavigation } from '../book/BookNavigationContext';
import type {
  AssetScheduleRow,
  DepreciationMethod,
  LedgerDepreciationSetting,
} from '@/types/bookkeeping';

interface Props {
  bookId: string;
  ledger: string;
  isAdmin?: boolean;
  /** Refetch the ledger entries/balances after a post so the master list updates. */
  onChanged?: () => void;
}

interface ScheduleResponse {
  period: { from: string; to: string };
  schedules: Array<{
    ledger: string;
    settings: LedgerDepreciationSetting[];
    rows: AssetScheduleRow[];
    totals: { cost: number; depnBroughtForward: number; periodCharge: number; depnCarriedForward: number; nbv: number };
    reconciliation: { costLedger: number; costAssets: number; depnBfwdLedger: number; depnBfwdAssets: number };
  }>;
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

export default function DepreciationTab({ bookId, ledger, isAdmin = false, onChanged }: Props) {
  const noun = depreciationNoun(ledger); // 'Depreciation' | 'Amortisation'
  const nav = useBookNavigation();
  const ap = nav?.activePeriod;

  // ── Period (pre-filled from the header) ───────────────────────────────────
  const defaultFrom = ap?.fromIso ?? ap?.fyStartIso ?? '';
  const defaultTo = ap?.toIso ?? ap?.fyEndIso ?? '';
  const [fromUk, setFromUk] = useState(defaultFrom ? fromIso(defaultFrom) : '');
  const [toUk, setToUk] = useState(defaultTo ? fromIso(defaultTo) : '');

  const fromIsoVal = parseUkDateStrict(fromUk);
  const toIsoVal = parseUkDateStrict(toUk);
  const periodValid = !!fromIsoVal && !!toIsoVal && fromIsoVal <= toIsoVal;

  const [data, setData] = useState<ScheduleResponse['schedules'][number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!periodValid) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/depreciation?ledger=${encodeURIComponent(ledger)}&from=${fromIsoVal}&to=${toIsoVal}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to load schedule');
      }
      const body = (await r.json()) as ScheduleResponse;
      setData(body.schedules[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [bookId, ledger, fromIsoVal, toIsoVal, periodValid]);

  useEffect(() => { void load(); }, [load]);

  // ── Settings editor ───────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [disposeRow, setDisposeRow] = useState<AssetScheduleRow | null>(null);

  const recon = data?.reconciliation;
  const reconCostMismatch = recon && Math.abs(recon.costLedger - recon.costAssets) > 0.005;
  // Depn b/fwd tie-out: ledger "Depn - b/fwd" balance vs the sum allocated
  // across the itemised assets. `diff > 0` → some ledger depn isn't yet
  // assigned to an asset (under-allocated); `diff < 0` → more allocated than
  // the ledger holds (over-allocated). Warn-only either way.
  const depnLedger = recon?.depnBfwdLedger ?? 0;
  const depnAllocated = recon?.depnBfwdAssets ?? 0;
  const depnDiff = +(depnLedger - depnAllocated).toFixed(2);
  const showDepnRecon = !!recon && (Math.abs(depnLedger) > 0.005 || Math.abs(depnAllocated) > 0.005);
  const depnState: 'ok' | 'under' | 'over' =
    Math.abs(depnDiff) < 0.005 ? 'ok' : depnDiff > 0 ? 'under' : 'over';

  const postable = useMemo(
    () => (data?.rows ?? []).filter(r => r.periodCharge > 0 && !r.posted),
    [data],
  );
  const postableTotal = useMemo(
    () => Math.round(postable.reduce((s, r) => s + r.periodCharge, 0) * 100) / 100,
    [postable],
  );

  // Rows already posted for this period — drives the "Un-post" action and the
  // "done" banner. A period is *fully posted* when something is chargeable and
  // nothing is left to post (postable is empty). When the user later adds or
  // changes an asset a fresh unposted charge appears, postable refills, and the
  // done state automatically drops back to "still to post".
  const postedRows = useMemo(
    () => (data?.rows ?? []).filter(r => r.periodCharge > 0 && r.posted),
    [data],
  );
  const chargeableCount = useMemo(
    () => (data?.rows ?? []).filter(r => r.periodCharge > 0).length,
    [data],
  );
  const fullyPosted = chargeableCount > 0 && postable.length === 0;

  async function postDepreciation() {
    if (!periodValid || postable.length === 0) return;
    setPosting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger, from: fromIsoVal, to: toIsoVal }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Post failed');
      setNotice(d.posted ? `Posted ${d.ref_no} — ${d.assets_charged} asset(s), £${fmt(d.total)}.` : (d.message ?? 'Nothing to post.'));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setPosting(false);
    }
  }

  async function unpostDepreciation() {
    if (!periodValid || postedRows.length === 0) return;
    if (!confirm(
      `Reverse the posted ${noun.toLowerCase()} for this period?\n\n` +
      `This deletes the ${noun.toLowerCase()} journal and clears the period's charges so you ` +
      `can add, alter or remove assets and then post again. It can't be undone, but you can re-post at any time.`,
    )) return;
    setUnposting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/unpost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger, from: fromIsoVal, to: toIsoVal }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Reverse failed');
      setNotice(d.reversed
        ? `Reversed — ${d.charges_reversed} charge(s) cleared. Make your changes, then post again.`
        : (d.message ?? 'Nothing to reverse.'));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reverse failed');
    } finally {
      setUnposting(false);
    }
  }

  async function reverseDisposal(row: AssetScheduleRow) {
    if (reversingId) return;
    if (!confirm(
      `Reverse the disposal of "${row.asset.description}"?\n\n` +
      `This deletes the disposal journal and any ${noun.toLowerCase()} catch-up posted to the disposal date, ` +
      `and returns the asset to active. It can't be undone, but you can dispose of it again.`,
    )) return;
    setReversingId(row.asset.id);
    setError('');
    setNotice('');
    try {
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/depreciation/dispose?asset_id=${row.asset.id}`,
        { method: 'DELETE' },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Reverse failed');
      setNotice('Disposal reversed — the asset is active again.');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reverse failed');
    } finally {
      setReversingId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
      {/* ── Period + actions header ─────────────────────────────────────────── */}
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Period from</label>
          <DateInput value={fromUk} onChange={setFromUk} className="border border-slate-200 rounded px-2 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" ariaLabel="Period from" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Period to</label>
          <DateInput value={toUk} onChange={setToUk} className="border border-slate-200 rounded px-2 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" ariaLabel="Period to" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip label={`Set the ${noun.toLowerCase()} rate & method for this category`}>
            <button
              type="button"
              onClick={() => setShowSettings(s => !s)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            >
              <Settings2 size={13} /> Rate & method
            </button>
          </Tooltip>
          <Tooltip label="Add an opening (brought-forward) asset not yet fully depreciated">
            <button
              type="button"
              onClick={() => setAddAssetOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            >
              <Plus size={13} /> Brought-forward asset
            </button>
          </Tooltip>
          {postedRows.length > 0 && (
            <Tooltip label={`Reverse the posted ${noun.toLowerCase()} for this period so you can change assets and re-post`}>
              <button
                type="button"
                onClick={() => void unpostDepreciation()}
                disabled={unposting || posting || !periodValid}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {unposting ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                Un-post
              </button>
            </Tooltip>
          )}
          <Tooltip label={postable.length === 0 ? 'Nothing to post for this period' : `Post the ${noun.toLowerCase()} journal for this period`}>
            <button
              type="button"
              onClick={() => void postDepreciation()}
              disabled={posting || unposting || !periodValid || postable.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {posting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Post {noun.toLowerCase()}{postable.length > 0 ? ` (£${fmt(postableTotal)})` : ''}
            </button>
          </Tooltip>
        </div>
      </div>

      {!periodValid && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Enter a valid period (from on or before to) to build the schedule.
        </p>
      )}
      {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      {/* Done banner — the period's charge is fully posted. Stays green until an
          asset is added/altered/removed, which refills `postable` and flips
          this back to the amber "still to post" hint below. */}
      {fullyPosted ? (
        <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 border bg-emerald-50 border-emerald-200 text-emerald-800">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-600 text-white shrink-0">
            <Check size={11} />
          </span>
          <span className="font-semibold">{noun} posted for this period.</span>
          <span className="opacity-80">
            Add, alter or dispose of an asset and a fresh charge appears here to post. Use “Un-post” to reverse and redo the whole period.
          </span>
        </div>
      ) : postable.length > 0 && postedRows.length > 0 ? (
        <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 border bg-amber-50 border-amber-200 text-amber-800">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="font-semibold">{postable.length} asset(s) still to post</span>
          <span className="opacity-80">— assets changed since the last post. Click “Post {noun.toLowerCase()}” to bring this period up to date.</span>
        </div>
      ) : null}

      {/* ── Settings editor ─────────────────────────────────────────────────── */}
      {showSettings && (
        <SettingsEditor
          bookId={bookId}
          ledger={ledger}
          noun={noun}
          isAdmin={isAdmin}
          settings={data?.settings ?? []}
          onChanged={() => void load()}
        />
      )}

      {/* ── B/fwd depreciation reconciliation (warn-only, always shown) ──────
          Persistent tie-out between the ledger's "Depn - b/fwd" balance and the
          sum allocated across assets. Green when it balances, amber when there's
          still ledger depn to assign, rose when over-allocated. Click an asset's
          {noun} b/fwd cell to allocate. Posting is never blocked. */}
      {showDepnRecon && (
        <div
          className={`text-xs rounded-lg px-3 py-2 border ${
            depnState === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : depnState === 'under'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {depnState === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
            {noun} b/fwd — allocated £{fmt(depnAllocated)} of £{fmt(depnLedger)} in the ledger
            {depnState === 'under' && <span className="font-normal">· £{fmt(depnDiff)} still to allocate</span>}
            {depnState === 'over' && <span className="font-normal">· £{fmt(-depnDiff)} more than the ledger holds</span>}
          </div>
          <div className="opacity-70 mt-0.5">
            {depnState === 'ok'
              ? `Every asset's ${noun.toLowerCase()} b/fwd is assigned and ties to the ledger.`
              : `Click an asset's "${noun} b/fwd" figure below to set its accumulated ${noun.toLowerCase()} to date. Warning only — you can still post.`}
          </div>
        </div>
      )}

      {/* Cost mismatch — separate warn-only line (only when out). */}
      {reconCostMismatch && recon && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={13} /> Cost doesn’t reconcile
          </div>
          <div className="opacity-80 mt-0.5">
            Ledger £{fmt(recon.costLedger)} vs itemised assets £{fmt(recon.costAssets)} (diff £{fmt(recon.costLedger - recon.costAssets)}). Warning only.
          </div>
        </div>
      )}

      {/* ── Schedule table ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-slate-400">
          <Loader2 size={12} className="animate-spin mr-1.5" /> Building schedule…
        </div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-1 py-6 text-center">
          No assets in this category yet. Additions appear automatically once posted to “Cost - additions”; add opening assets with “Brought-forward asset”.
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 border-b border-slate-200 bg-slate-50/60">
              <tr>
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-left w-24">Purchased</th>
                <th className="px-3 py-2 text-left w-32">Method</th>
                <th className="px-3 py-2 text-right w-24">Cost</th>
                <th className="px-3 py-2 text-right w-28">{noun} b/fwd</th>
                <th className="px-3 py-2 text-right w-24">Charge</th>
                <th className="px-3 py-2 text-right w-28">{noun} c/fwd</th>
                <th className="px-3 py-2 text-right w-24">NBV</th>
                <th className="px-3 py-2 text-center w-16" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const disposed = r.asset.status === 'disposed';
                return (
                  <tr key={r.asset.id} className={`border-b border-slate-50 ${disposed ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-1.5">
                      <div className="text-slate-900 truncate max-w-[260px]">{r.asset.description}</div>
                      <div className="text-[10px] text-slate-400">
                        {r.asset.source === 'brought_forward' ? 'Brought forward' : 'Addition'}
                        {disposed && r.asset.disposal_date ? ` · disposed ${fromIso(r.asset.disposal_date)}` : ''}
                        {r.posted ? ' · posted' : ''}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 tabular-nums">{fromIso(r.asset.purchase_date)}</td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {methodLabel(r.method)}{r.annualRate ? ` · ${r.annualRate}%` : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{fmt(r.asset.cost)}</td>
                    <BfwdDepnCell row={r} bookId={bookId} noun={noun} onSaved={() => void load()} />

                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.posted ? 'text-slate-400' : 'text-slate-900 font-medium'}`}>{fmt(r.periodCharge)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmt(r.depnCarriedForward)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{fmt(r.nbv)}</td>
                    <td className="px-3 py-1.5 text-center">
                      {!disposed ? (
                        <Tooltip label="Dispose of this asset">
                          <button
                            type="button"
                            onClick={() => setDisposeRow(r)}
                            aria-label="Dispose asset"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <PackageMinus size={14} />
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Reverse this disposal — return the asset to active">
                          <button
                            type="button"
                            onClick={() => void reverseDisposal(r)}
                            disabled={reversingId === r.asset.id}
                            aria-label="Reverse disposal"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                          >
                            {reversingId === r.asset.id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <RotateCcw size={14} />}
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                <td className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500" colSpan={3}>Totals</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.depnBroughtForward)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.periodCharge)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.depnCarriedForward)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.nbv)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {addAssetOpen && (
        <AddBfwdAssetModal
          bookId={bookId}
          ledger={ledger}
          noun={noun}
          onClose={() => setAddAssetOpen(false)}
          onAdded={() => { setAddAssetOpen(false); void load(); }}
        />
      )}

      {disposeRow && (
        <DisposeModal
          bookId={bookId}
          row={disposeRow}
          noun={noun}
          onClose={() => setDisposeRow(null)}
          onDisposed={() => { setDisposeRow(null); void load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ── Inline-editable opening accumulated depreciation cell ───────────────────
// Lets the user allocate an asset's depreciation-to-date (its
// opening_accumulated_depn) directly in the schedule — the common mid-life
// migration case where prior-year depreciation was run in other software and
// only the aggregate sits in the ledger's "Depn - b/fwd" account.
//
// Editable only while the figure is still "pure" opening depn: nothing posted
// on top (no prior-period posted charge feeding depnBroughtForward, and this
// period not yet posted) and the asset isn't disposed. Saving rewrites
// opening_accumulated_depn, which the engine nets off the reducing-balance
// base — so the charge + NBV recompute on reload.
function BfwdDepnCell({
  row, bookId, noun, onSaved,
}: {
  row: AssetScheduleRow;
  bookId: string;
  noun: string;
  onSaved: () => void;
}) {
  const opening = row.asset.opening_accumulated_depn;
  const disposed = row.asset.status === 'disposed';
  const pure = Math.abs(row.depnBroughtForward - opening) < 0.005 && !row.posted;
  const editable = !disposed && pure;

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function begin() {
    if (!editable || busy) return;
    setVal(opening ? String(opening) : '');
    setErr('');
    setEditing(true);
  }

  async function commit() {
    const num = val.trim() === '' ? 0 : Number(val);
    if (Number.isNaN(num) || num < 0 || num > row.asset.cost) {
      setErr(`Enter 0–${fmt(row.asset.cost)}`);
      return;
    }
    if (Math.abs(num - opening) < 0.005) { setEditing(false); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/depreciation/assets?asset_id=${row.asset.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opening_accumulated_depn: num }),
        },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Save failed');
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex flex-col items-end gap-0.5">
          <input
            type="number"
            min={0}
            max={row.asset.cost}
            step="0.01"
            autoFocus
            value={val}
            disabled={busy}
            onChange={e => setVal(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setErr(''); }
            }}
            aria-label={`${noun} brought forward`}
            className="w-24 text-right border border-indigo-300 rounded px-1.5 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          {err && <span className="text-[10px] text-rose-600">{err}</span>}
        </div>
      </td>
    );
  }

  if (!editable) {
    return (
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
        {fmt(row.depnBroughtForward)}
      </td>
    );
  }

  return (
    <td className="px-3 py-1.5 text-right">
      <Tooltip label={`Set ${noun.toLowerCase()} to date — click to edit`}>
        <button
          type="button"
          onClick={begin}
          aria-label={`Edit ${noun.toLowerCase()} brought forward`}
          className="inline-flex items-center gap-1 tabular-nums text-slate-700 hover:text-indigo-700 hover:underline decoration-dotted underline-offset-2"
        >
          <Pencil size={10} className="opacity-40" />
          {fmt(row.depnBroughtForward)}
        </button>
      </Tooltip>
    </td>
  );
}

// ── Settings editor ───────────────────────────────────────────────────────────

function SettingsEditor({
  bookId, ledger, noun, isAdmin, settings, onChanged,
}: {
  bookId: string;
  ledger: string;
  noun: string;
  isAdmin: boolean;
  settings: LedgerDepreciationSetting[];
  onChanged: () => void;
}) {
  const [method, setMethod] = useState<DepreciationMethod>('straight_line');
  const [rate, setRate] = useState('');
  const [effFromUk, setEffFromUk] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effIso = parseUkDateStrict(effFromUk);
  const rateNum = Number(rate);
  const valid = effIso && rate !== '' && !Number.isNaN(rateNum) && rateNum >= 0 && rateNum <= 100;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger, effective_from: effIso, method, annual_rate: rateNum }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Save failed');
      setRate('');
      setEffFromUk('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this rate change? Periods already posted are unaffected.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/settings?id=${id}`, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? 'Delete failed'); }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40 space-y-3">
      <p className="text-xs text-slate-600">
        {noun} rate &amp; method apply to the whole <span className="font-medium">{ledger}</span> category.
        Changes are <span className="font-medium">prospective</span> — set an effective date and the engine splits any period that straddles it. Already-posted periods are never restated.
      </p>

      {settings.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded bg-white">
          {settings.map(s => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
              <span className="tabular-nums text-slate-700 w-24">{fromIso(s.effective_from)}</span>
              <span className="text-slate-700 flex-1">{methodLabel(s.method)}</span>
              <span className="tabular-nums font-medium text-slate-900">{s.annual_rate}%</span>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                disabled={busy}
                aria-label="Remove rate change"
                className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Effective from</label>
          <DateInput value={effFromUk} onChange={setEffFromUk} className="border border-slate-200 rounded px-2 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" ariaLabel="Effective from" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Method</label>
          <select
            value={method}
            onChange={e => setMethod(e.target.value as DepreciationMethod)}
            className="border border-slate-200 rounded px-2 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            <option value="straight_line">Straight line</option>
            <option value="reducing_balance">Reducing balance</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Rate %</label>
          <input
            type="number"
            min={0}
            max={100}
            step="0.001"
            value={rate}
            onChange={e => setRate(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="25"
          />
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!valid || busy}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add rate
        </button>
      </div>
      {!isAdmin && <p className="text-[10px] text-slate-400">Tip: rate changes are prospective and audited.</p>}
      {err && <p className="text-xs text-rose-700">{err}</p>}
    </div>
  );
}

// ── Add brought-forward asset ───────────────────────────────────────────────

function AddBfwdAssetModal({
  bookId, ledger, noun, onClose, onAdded,
}: {
  bookId: string;
  ledger: string;
  noun: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [description, setDescription] = useState('');
  const [purchaseUk, setPurchaseUk] = useState('');
  const [cost, setCost] = useState('');
  const [openingDepn, setOpeningDepn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const purchaseIso = parseUkDateStrict(purchaseUk);
  const costNum = Number(cost);
  const openingNum = openingDepn === '' ? 0 : Number(openingDepn);
  const valid =
    description.trim() && purchaseIso && cost !== '' && !Number.isNaN(costNum) && costNum >= 0 &&
    !Number.isNaN(openingNum) && openingNum >= 0 && openingNum <= costNum;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledger,
          description: description.trim(),
          purchase_date: purchaseIso,
          cost: costNum,
          opening_accumulated_depn: openingNum,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Save failed');
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Brought-forward asset" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Description">
          <input value={description} onChange={e => setDescription(e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" placeholder="e.g. Ford Transit (AB12 CDE)" />
        </Field>
        <Field label="Purchase date">
          <DateInput value={purchaseUk} onChange={setPurchaseUk} className="border border-slate-200 rounded px-2 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" ariaLabel="Purchase date" />
        </Field>
        <Field label="Cost">
          <input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="w-40 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" placeholder="0.00" />
        </Field>
        <Field label={`${noun} to date`}>
          <input type="number" min={0} step="0.01" value={openingDepn} onChange={e => setOpeningDepn(e.target.value)} className="w-40 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" placeholder="0.00" />
        </Field>
        <p className="text-[11px] text-slate-500">
          Opening accumulated {noun.toLowerCase()} already charged before this register existed. NBV starts at cost − this amount.
        </p>
        {err && <p className="text-xs text-rose-700">{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={() => void save()} saveDisabled={!valid || busy} busy={busy} saveLabel="Add asset" />
    </ModalShell>
  );
}

// ── Dispose ─────────────────────────────────────────────────────────────────

interface PickAccount { id: string; name: string; ledger: string | null }

function DisposeModal({
  bookId, row, noun, onClose, onDisposed,
}: {
  bookId: string;
  row: AssetScheduleRow;
  noun: string;
  onClose: () => void;
  onDisposed: () => void;
}) {
  const [dateUk, setDateUk] = useState('');
  const [proceeds, setProceeds] = useState('');
  const [proceedsAccountId, setProceedsAccountId] = useState('');
  const [accounts, setAccounts] = useState<PickAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/accounts?pickable_only=true`)
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => { if (!cancelled) setAccounts((d.accounts ?? []) as PickAccount[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  const dateIso = parseUkDateStrict(dateUk);
  const proceedsNum = proceeds === '' ? 0 : Number(proceeds);
  const needsAccount = proceedsNum > 0;
  const valid =
    dateIso && dateIso >= row.asset.purchase_date && !Number.isNaN(proceedsNum) && proceedsNum >= 0 &&
    (!needsAccount || !!proceedsAccountId);

  // Group accounts by ledger for the select.
  const grouped = useMemo(() => {
    const m = new Map<string, PickAccount[]>();
    for (const a of accounts) {
      const k = a.ledger ?? 'Other';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [accounts]);

  async function dispose() {
    if (!valid) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/depreciation/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: row.asset.id,
          disposal_date: dateIso,
          proceeds: proceedsNum,
          proceeds_account_id: needsAccount ? proceedsAccountId : null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Disposal failed');
      onDisposed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disposal failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Dispose — ${row.asset.description}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-600">
          {noun} is charged up to the disposal date, then the asset’s cost and accumulated {noun.toLowerCase()} are removed and any gain or loss goes to “P/L on disposal of fixed assets”.
        </p>
        <Field label="Disposal date">
          <DateInput value={dateUk} onChange={setDateUk} className="border border-slate-200 rounded px-2 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" ariaLabel="Disposal date" />
        </Field>
        <Field label="Proceeds">
          <input type="number" min={0} step="0.01" value={proceeds} onChange={e => setProceeds(e.target.value)} className="w-40 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" placeholder="0.00" />
        </Field>
        {needsAccount && (
          <Field label="Proceeds to">
            <select
              value={proceedsAccountId}
              onChange={e => setProceedsAccountId(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="">Select account…</option>
              {grouped.map(([ledger, accts]) => (
                <optgroup key={ledger} label={ledger}>
                  {accts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        )}
        {err && <p className="text-xs text-rose-700">{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={() => void dispose()} saveDisabled={!valid || busy} busy={busy} saveLabel="Dispose asset" destructive />
    </ModalShell>
  );
}

// ── Small shared modal primitives ───────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900 truncate pr-2">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onClose, onSave, saveDisabled, busy, saveLabel, destructive,
}: {
  onClose: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  busy: boolean;
  saveLabel: string;
  destructive?: boolean;
}) {
  return (
    <div className="border-t border-slate-200 p-3 flex items-center gap-2 justify-end bg-slate-50/40">
      <button type="button" onClick={onClose} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50">Cancel</button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed ${destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {saveLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
