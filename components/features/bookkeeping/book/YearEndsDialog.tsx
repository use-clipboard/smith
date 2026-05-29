'use client';

/**
 * YearEndsDialog — manage a book's financial years: see each FY's status and
 * (admins only) close or reopen one.
 *
 * Closing posts a year-end journal (YET) dated on the FY end-date that carries
 * the year's profit into reserves and locks the period. Reopening deletes that
 * journal and unlocks. Years close/reopen in order — the buttons enforce it.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Lock, Unlock, Check, AlertTriangle, CalendarClock, FileText } from 'lucide-react';
import type { FinancialYear } from '@/types/bookkeeping';

interface ClosePreviewLine {
  account_id: string;
  account_name: string;
  ledger: string | null;
  debit: number;
  credit: number;
}
interface ExistingYet {
  id: string;
  ref_no: string;
  date: string;
  total: number;
}
interface ClosePreview {
  period: { from: string; to: string };
  net_profit: number;
  nil_profit: boolean;
  existing_yets?: ExistingYet[];
  retained_earnings: { id: string; name: string; ledger: string | null };
  total: number;
  lines: ClosePreviewLine[];
}

interface Props {
  bookId: string;
  isAdmin: boolean;
  onClose: () => void;
  /** Called after a successful close/reopen so the parent can refresh the book
   *  (period-lock date) and nudge the reports to re-fetch. */
  onChanged?: () => void;
}

function yearLabel(fy: FinancialYear): string {
  const end = new Date(`${fy.end_date}T00:00:00Z`);
  const endLabel = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Year to ${endLabel}`;
}

/** ISO yyyy-mm-dd → dd/mm/yyyy (UK display). */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtGbp(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(£${abs})` : `£${abs}`;
}

export default function YearEndsDialog({ bookId, isAdmin, onClose, onChanged }: Props) {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  // Close-preview lightbox state.
  const [previewFy, setPreviewFy] = useState<FinancialYear | null>(null);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [posting, setPosting] = useState(false);
  // "Closed in previous software" — close without posting a journal.
  const [skipJournal, setSkipJournal] = useState(false);

  // Reopen-confirmation lightbox state.
  const [reopenFy, setReopenFy] = useState<FinancialYear | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/years?generate=true`);
      if (!r.ok) throw new Error('Failed to load financial years');
      const d = await r.json();
      setYears((d.years ?? []) as FinancialYear[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  // Most recent first.
  const sorted = [...years].sort((a, b) => b.start_date.localeCompare(a.start_date));
  // The single FY that may be closed next = the earliest open/reopened year
  // with no still-open earlier year. Equivalently: years close in date order,
  // so the next closable is the oldest non-closed year.
  const oldestNonClosed = [...years]
    .filter(y => y.status !== 'closed')
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0]?.id ?? null;
  // The single FY that may be reopened = the most recent closed year.
  const newestClosed = [...years]
    .filter(y => y.status === 'closed')
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]?.id ?? null;

  // Step 1 — fetch the proposed year-end journal and open the approval lightbox.
  async function openClosePreview(fy: FinancialYear) {
    setBusyId(fy.id); setError(''); setFlash('');
    setPreviewFy(fy); setPreview(null); setPreviewError(''); setPreviewLoading(true); setSkipJournal(false);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/years/${fy.id}/close?preview=true`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not build the year-end journal');
      const p = d as ClosePreview;
      setPreview(p);
      // If the year already carries a YET, it was almost certainly closed in
      // previous software — default to the no-journal close to avoid
      // double-counting the profit into the b/fwd reserve.
      if ((p.existing_yets?.length ?? 0) > 0) setSkipJournal(true);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Could not build preview');
    } finally {
      setPreviewLoading(false);
      setBusyId(null);
    }
  }

  // Step 2 — the user approved; actually post the close.
  async function confirmClose() {
    if (!previewFy) return;
    const fy = previewFy;
    setPosting(true); setPreviewError('');
    try {
      const url = `/api/bookkeeping/books/${bookId}/years/${fy.id}/close${skipJournal ? '?journal=skip' : ''}`;
      const r = await fetch(url, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Close failed');
      setFlash(
        d.skipped
          ? `${yearLabel(fy)} marked closed — no journal posted (closed in previous software).`
          : d.ref_no
            ? `${yearLabel(fy)} closed — ${d.ref_no} carried ${fmtGbp(d.net_profit)} to reserves.`
            : `${yearLabel(fy)} closed (no profit to carry).`,
      );
      setPreviewFy(null); setPreview(null);
      await load();
      onChanged?.();
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setPosting(false);
    }
  }

  function cancelPreview() {
    if (posting) return;
    setPreviewFy(null); setPreview(null); setPreviewError('');
  }

  // Step 1 — open the reopen-confirmation lightbox.
  function openReopen(fy: FinancialYear) {
    setError(''); setFlash('');
    setReopenFy(fy); setReopenReason(''); setReopenError('');
  }

  function cancelReopen() {
    if (reopening) return;
    setReopenFy(null); setReopenReason(''); setReopenError('');
  }

  // Step 2 — the user confirmed; actually reopen.
  async function confirmReopen() {
    if (!reopenFy) return;
    const fy = reopenFy;
    setReopening(true); setReopenError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/years/${fy.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Reopen failed');
      setFlash(`${yearLabel(fy)} reopened.`);
      setReopenFy(null); setReopenReason('');
      await load();
      onChanged?.();
    } catch (e) {
      setReopenError(e instanceof Error ? e.message : 'Reopen failed');
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4" aria-modal="true" role="dialog">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
            <CalendarClock size={15} className="text-indigo-600" /> Financial years
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-3 space-y-3 overflow-y-auto">
          <p className="text-[11px] text-gray-500">
            Closing a year posts a year-end journal that carries the year&apos;s profit into reserves and locks the period. Years close and reopen in date order.
          </p>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {flash && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <Check size={13} className="mt-0.5 shrink-0" /> {flash}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
              <Loader2 size={14} className="animate-spin mr-2" /> Loading…
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500">
              No financial years yet — set a year-end in Book settings.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {sorted.map(fy => {
                const busy = busyId === fy.id;
                const canClose = isAdmin && fy.status !== 'closed' && fy.id === oldestNonClosed;
                const canReopen = isAdmin && fy.status === 'closed' && fy.id === newestClosed;
                return (
                  <li key={fy.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{yearLabel(fy)}</div>
                      <div className="text-[11px] text-gray-400">
                        {fmtDate(fy.start_date)} → {fmtDate(fy.end_date)}
                      </div>
                    </div>
                    <StatusBadge status={fy.status} />
                    {canClose && (
                      <button
                        onClick={() => openClosePreview(fy)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} Close year
                      </button>
                    )}
                    {canReopen && (
                      <button
                        onClick={() => openReopen(fy)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Reopen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!isAdmin && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1">
              <AlertTriangle size={10} /> Only admins can close or reopen a financial year.
            </p>
          )}
        </div>
      </div>

      {/* ── Close preview / approval lightbox ──────────────────────────────── */}
      {previewFy && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4" aria-modal="true" role="dialog">
          <button type="button" aria-label="Cancel" onClick={cancelPreview} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
                <FileText size={15} className="text-indigo-600" /> Year-end journal — {yearLabel(previewFy)}
              </h3>
              <button onClick={cancelPreview} disabled={posting} aria-label="Cancel" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-40">
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-3 overflow-y-auto">
              {previewLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
                  <Loader2 size={14} className="animate-spin mr-2" /> Building journal…
                </div>
              ) : previewError && !preview ? (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {previewError}
                </div>
              ) : preview ? (
                <>
                  <p className="text-[11px] text-gray-500 mb-3">
                    This <span className="font-semibold">YET</span> will be posted dated{' '}
                    <span className="font-medium text-gray-700">{fmtDate(preview.period.to)}</span>, zeroing the P&amp;L accounts
                    into <span className="font-medium text-gray-700">{preview.retained_earnings.name}</span> and locking
                    the period. Review before approving.
                  </p>

                  {(preview.existing_yets?.length ?? 0) > 0 && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        This year already contains a year-end journal
                        {' '}({preview.existing_yets!.map(y => y.ref_no).join(', ')}) — it looks like it was
                        closed in previous software. Posting another would <span className="font-semibold">double-count</span> the
                        profit in {preview.retained_earnings.name}. Tick the box below to close it without posting a journal.
                      </span>
                    </div>
                  )}

                  {/* Closed-in-previous-software: mark closed without a journal. */}
                  <label className="flex items-start gap-2 mb-3 text-[11px] text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={skipJournal}
                      onChange={e => setSkipJournal(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      This year was closed in previous software — record it as closed{' '}
                      <span className="font-semibold">without posting this journal</span> (leaves brought-forward figures untouched).
                    </span>
                  </label>

                  {skipJournal ? (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                      No journal will be posted. {yearLabel(previewFy)} will simply be marked closed and the period
                      locked to {fmtDate(preview.period.to)}, so you can close later years in order. Brought-forward reserves are unchanged.
                    </div>
                  ) : preview.nil_profit ? (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                      No profit or loss to carry for this year — closing it won&apos;t post a journal, it will just lock the period.
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left font-medium px-3 py-1.5">Account</th>
                            <th className="text-right font-medium px-3 py-1.5 w-24">Debit</th>
                            <th className="text-right font-medium px-3 py-1.5 w-24">Credit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {preview.lines.map((l, i) => {
                            const isRe = l.account_id === preview.retained_earnings.id;
                            return (
                              <tr key={`${l.account_id}-${i}`} className={isRe ? 'bg-indigo-50/40' : ''}>
                                <td className="px-3 py-1.5 text-gray-800">
                                  {l.ledger && <span className="text-gray-400">{l.ledger} · </span>}
                                  {l.account_name}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{l.debit ? fmtGbp(l.debit) : '—'}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{l.credit ? fmtGbp(l.credit) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 font-semibold text-gray-900 border-t border-gray-200">
                          <tr>
                            <td className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtGbp(preview.total)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtGbp(preview.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {!skipJournal && !preview.nil_profit && (
                    <p className="text-[11px] mt-3 text-gray-600">
                      {preview.net_profit >= 0 ? 'Profit' : 'Loss'} for the year of{' '}
                      <span className="font-semibold text-gray-900">{fmtGbp(preview.net_profit)}</span>{' '}
                      will be carried to <span className="font-medium">{preview.retained_earnings.name}</span>.
                    </p>
                  )}

                  {previewError && (
                    <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {previewError}
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                onClick={cancelPreview}
                disabled={posting}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmClose}
                disabled={posting || previewLoading || !preview}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {posting ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
                {skipJournal ? 'Mark closed (no journal)' : 'Approve & close year'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reopen confirmation lightbox ───────────────────────────────────── */}
      {reopenFy && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4" aria-modal="true" role="dialog">
          <button type="button" aria-label="Cancel" onClick={cancelReopen} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
                <Unlock size={15} className="text-amber-600" /> Reopen {yearLabel(reopenFy)}
              </h3>
              <button onClick={cancelReopen} disabled={reopening} aria-label="Cancel" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-40">
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>This deletes the year-end journal and unlocks the period. You can re-close the year afterwards.</span>
              </div>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-600">Reason (optional)</span>
                <input
                  type="text"
                  value={reopenReason}
                  onChange={e => setReopenReason(e.target.value)}
                  maxLength={500}
                  autoFocus
                  placeholder="e.g. correcting an early close"
                  onKeyDown={e => { if (e.key === 'Enter' && !reopening) void confirmReopen(); }}
                  className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
              </label>
              {reopenError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {reopenError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                onClick={cancelReopen}
                disabled={reopening}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmReopen}
                disabled={reopening}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {reopening ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                Reopen year
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: FinancialYear['status'] }) {
  if (status === 'closed') {
    return <span className="text-[9px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Closed</span>;
  }
  if (status === 'reopened') {
    return <span className="text-[9px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Reopened</span>;
  }
  return <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">Open</span>;
}
