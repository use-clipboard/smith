'use client';

/**
 * RecLockWarningModal — the "are you sure?" lightbox shown when a user
 * tries to post into a period that's already been reconciled.
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ ⚠  Bank period is reconciled                                     │
 *   │                                                                 │
 *   │   One or more of your entries lands in a closed reconciliation. │
 *   │   Posting now will throw off the rec's totals — you'll need to  │
 *   │   reopen the rec to bring it back into balance.                 │
 *   │                                                                 │
 *   │   ┌─ Affected periods ─────────────────────────────────────┐   │
 *   │   │ Bank: Current account · 01/04/24 → 31/03/25            │   │
 *   │   │   Date posted: 14/02/25                                │   │
 *   │   └────────────────────────────────────────────────────────┘   │
 *   │                                                                 │
 *   │                                  Cancel   Post anyway →         │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Lives in /ledger/ alongside the other rec components — even though it's
 * triggered from input sheets, the messaging + business model is rec-
 * centric. Caller passes the list of locks (one per unique account+date
 * pair that fell inside a reconciled rec) and a confirm/cancel callback.
 *
 * Confirm fires the actual post; cancel just dismisses the modal.
 */

import { AlertTriangle, X } from 'lucide-react';
import type { RecLockHit } from '@/lib/bookkeeping/checkRecLock';

interface Props {
  hits: RecLockHit[];
  onConfirm: () => void;
  onCancel: () => void;
}

function formatDateUk(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function RecLockWarningModal({ hits, onConfirm, onCancel }: Props) {
  if (hits.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-[560px] max-w-full shadow-2xl border border-amber-200 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/60 rounded-t-2xl flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-700 shrink-0" />
          <h2 className="text-sm font-semibold text-amber-900 flex-1">
            Bank period is reconciled
          </h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-amber-700/70 hover:text-amber-900"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 text-[13px] text-slate-700">
          <p>
            One or more of your entries lands in a closed reconciliation. Posting
            now will throw off the rec&apos;s totals — you&apos;ll need to{' '}
            <strong className="text-slate-900">reopen the rec</strong> from the
            History tab to bring it back into balance.
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 divide-y divide-slate-100 overflow-hidden">
            {hits.map((h, i) => (
              <div key={`${h.probe.accountId}|${h.probe.date}|${i}`} className="px-3 py-2 text-xs">
                <div className="font-medium text-slate-900">
                  {h.probe.accountName ?? 'Bank account'}
                  <span className="ml-1.5 text-slate-500 font-normal tabular-nums">
                    {formatDateUk(h.rec.period_start)} → {formatDateUk(h.rec.period_end)}
                  </span>
                </div>
                <div className="text-slate-500 mt-0.5">
                  Your entry is dated{' '}
                  <span className="tabular-nums text-slate-700">
                    {formatDateUk(h.probe.date)}
                  </span>
                  {h.rec.reconciled_at && (
                    <>
                      {' '}· rec completed{' '}
                      <span className="tabular-nums text-slate-700">
                        {formatDateUk(h.rec.reconciled_at.slice(0, 10))}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-500 italic">
            If this is a genuine late entry (a forgotten invoice, a reversal,
            etc.) it&apos;s fine to post anyway — just remember to reopen the
            affected rec and tick the new entry, or the closing balance will
            no longer agree to the bank statement.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
          >
            Post anyway
          </button>
        </div>
      </div>
    </div>
  );
}
