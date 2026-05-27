'use client';

/**
 * DuplicateReviewModal — generic confirmation lightbox shown when the
 * server flags suspected duplicates on a bank-rec contribution (CSV
 * lines OR manual sheet rows).
 *
 * Shows the candidate entry next to the existing ledger split it looks
 * like a dupe of, side by side, and offers two paths:
 *   • "Skip flagged · Add the rest" — caller resubmits with skip_indices
 *     so the duplicates are dropped.
 *   • "Add anyway"                  — caller resubmits with
 *     confirm_duplicates: true so everything goes through.
 *
 * The component is purely presentational — it doesn't know whether the
 * source is a CSV or the manual sheet. The caller passes already-flagged
 * suspects in a normalised shape.
 */

import { AlertTriangle, X, Forward, ArrowRightLeft, Loader2 } from 'lucide-react';

export interface DupeSuspect {
  /** Index in the caller's source array (skip_indices / skip_row_indices). */
  index: number;
  /** Date the user is trying to add. */
  candidateDate: string;
  /** Signed amount the user is trying to add (positive = money in). */
  candidateAmount: number;
  /** Free-text label for the candidate (CSV description or manual payee). */
  candidateLabel: string;
  /** The existing ledger entry the server flagged as a probable match. */
  matchRef: string;
  matchDate: string;
  matchSignedAmount: number;
  matchDetails: string | null;
}

interface Props {
  suspects: DupeSuspect[];
  /** Total candidate rows the user submitted, so we can show "N of M". */
  totalCount: number;
  busy?: boolean;
  onClose: () => void;
  onSkip: (indicesToSkip: number[]) => void;
  onConfirmAll: () => void;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DuplicateReviewModal({
  suspects, totalCount, busy, onClose, onSkip, onConfirmAll,
}: Props) {
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[760px] max-w-full shadow-2xl border border-amber-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-700" />
          <h2 className="text-sm font-semibold text-amber-900">
            {suspects.length} suspected duplicate{suspects.length === 1 ? '' : 's'} found
          </h2>
          <span className="text-xs text-amber-700">of {totalCount} {totalCount === 1 ? 'row' : 'rows'}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-amber-700 hover:text-amber-900">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 text-xs text-slate-600 border-b border-slate-100">
          Each row below looks like it already exists on this bank account (within ±3 days &amp; matching amount).
          Review and decide — skip the flagged rows, or add them anyway if these are genuinely separate transactions.
        </div>

        {/* Suspect list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <ul className="space-y-2">
            {suspects.map(s => (
              <li
                key={`${s.index}-${s.matchRef}`}
                className="rounded-lg border border-slate-200 bg-white p-3 grid grid-cols-2 gap-3"
              >
                {/* New entry */}
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">New entry</p>
                  <p className="text-sm text-slate-900 truncate">{s.candidateLabel || <span className="italic text-slate-400">no description</span>}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                    {formatDateUk(s.candidateDate)} · <span className={s.candidateAmount < 0 ? 'text-rose-700' : 'text-emerald-700'}>{fmt(s.candidateAmount)}</span>
                  </p>
                </div>
                {/* Existing ledger match */}
                <div className="min-w-0 border-l border-slate-100 pl-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1 flex items-center gap-1">
                    <ArrowRightLeft size={9} /> Existing entry
                  </p>
                  <p className="text-sm text-slate-900 truncate">
                    <span className="text-indigo-700">{s.matchRef}</span>
                    {s.matchDetails && <span className="text-slate-600 ml-1">· {s.matchDetails}</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                    {formatDateUk(s.matchDate)} · <span className={s.matchSignedAmount < 0 ? 'text-rose-700' : 'text-emerald-700'}>{fmt(s.matchSignedAmount)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2 bg-slate-50/40">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => onSkip(suspects.map(s => s.index))}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Forward size={11} />}
            Skip flagged · Add {totalCount - suspects.length} {totalCount - suspects.length === 1 ? 'row' : 'rows'}
          </button>
          <button
            type="button"
            onClick={onConfirmAll}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : null}
            Add anyway · {totalCount} {totalCount === 1 ? 'row' : 'rows'}
          </button>
        </div>
      </div>
    </div>
  );
}
