'use client';

/**
 * ChangeTypeModal — small focused modal for re-classifying a transaction
 * (e.g. REC → JRN). Picks the new type from a radio grid, with the current
 * type pre-disabled. POSTs to /change-type which allocates a fresh ref from
 * the target type's counter and updates the row.
 *
 * UX warnings:
 *   • The old ref number won't be reused (consistent with our gap-as-audit
 *     policy). We surface this in the confirmation body.
 *   • For JRN/RJN targets we mention that header-level VAT will be cleared.
 *   • Splits are preserved — the user can fix any oddities via Edit afterward.
 */

import { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Loader2, X, AlertTriangle } from 'lucide-react';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  open: boolean;
  bookId: string;
  txn: Transaction;
  onClose: () => void;
  onSaved: (next: Transaction) => void;
}

const TYPE_OPTIONS: Array<{ id: TransactionType; label: string; family: 'bank' | 'sales' | 'purchases' | 'journal'; description: string }> = [
  { id: 'PAY', label: 'PAY', family: 'bank',      description: 'Bank payment' },
  { id: 'CHQ', label: 'CHQ', family: 'bank',      description: 'Cheque payment' },
  { id: 'REC', label: 'REC', family: 'bank',      description: 'Bank receipt' },
  { id: 'TRF', label: 'TRF', family: 'bank',      description: 'Transfer between bank accounts' },
  { id: 'SIN', label: 'SIN', family: 'sales',     description: 'Sales invoice' },
  { id: 'SCR', label: 'SCR', family: 'sales',     description: 'Sales credit note' },
  { id: 'PIN', label: 'PIN', family: 'purchases', description: 'Purchase invoice' },
  { id: 'PCR', label: 'PCR', family: 'purchases', description: 'Purchase credit note' },
  { id: 'JRN', label: 'JRN', family: 'journal',   description: 'Journal entry' },
  { id: 'RJN', label: 'RJN', family: 'journal',   description: 'Reversing journal (no auto-reversal will be created)' },
];

const FAMILY_TONE: Record<string, string> = {
  bank:      'border-emerald-200 bg-emerald-50/50 text-emerald-900',
  sales:     'border-blue-200 bg-blue-50/50 text-blue-900',
  purchases: 'border-amber-200 bg-amber-50/50 text-amber-900',
  journal:   'border-violet-200 bg-violet-50/50 text-violet-900',
};

export default function ChangeTypeModal({ open, bookId, txn, onClose, onSaved }: Props) {
  const [target, setTarget] = useState<TransactionType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const isJournalTarget = target === 'JRN' || target === 'RJN';
  const willClearVat = isJournalTarget && Number(txn.vat_total ?? 0) > 0;

  async function handleSubmit() {
    if (!target) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${txn.id}/change-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_type: target }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? d.error ?? 'Change type failed');
      }
      const d = await res.json();
      if (d.warning) {
        // Non-fatal warning — show as alert so the user knows to follow up.
        // eslint-disable-next-line no-alert
        alert(`Type changed but: ${d.warning}`);
      }
      onSaved(d.transaction as Transaction);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change type failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1400] bg-slate-900/40" onClick={() => !submitting && onClose()} />
      <div className="fixed inset-0 z-[1450] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden pointer-events-auto flex flex-col" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50/40">
            <ArrowRightLeft size={14} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">Change transaction type</h2>
            <span className="text-[11px] font-mono text-slate-500">{txn.ref_no}</span>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
              className="ml-auto text-slate-400 hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            <div className="text-xs text-slate-600">
              Currently a <span className="font-mono font-semibold text-slate-900">{txn.type}</span>. Pick a new type below — a fresh ref will be allocated for that type, and the old ref ({txn.ref_no}) won't be reused.
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {TYPE_OPTIONS.map(opt => {
                const isCurrent = opt.id === txn.type;
                const isSelected = target === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => !isCurrent && setTarget(opt.id)}
                    disabled={isCurrent || submitting}
                    title={opt.description}
                    className={`flex flex-col items-center justify-center px-2 py-2 rounded-md border text-xs font-semibold transition-colors ${
                      isCurrent
                        ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                        : isSelected
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
                          : `${FAMILY_TONE[opt.family]} hover:border-slate-400`
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isCurrent && <span className="text-[9px] font-normal text-slate-400 mt-0.5">current</span>}
                  </button>
                );
              })}
            </div>

            {/* Picked-type description + side-effect warnings */}
            {target && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-1.5">
                <div>
                  <span className="font-semibold">{target}</span> — {TYPE_OPTIONS.find(t => t.id === target)?.description}
                </div>
                {willClearVat && (
                  <div className="flex items-start gap-1.5 text-amber-800">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      The existing VAT amount (£{Number(txn.vat_total).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) will be cleared — journals don't carry header VAT. If the transaction belongs in a VAT return, post it as a regular type instead.
                    </span>
                  </div>
                )}
                {isJournalTarget && txn.primary_account_id && (
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>The primary-account link will be cleared. The existing split lines stay as-is, so the journal stays balanced.</span>
                  </div>
                )}
                {target === 'RJN' && (
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>The auto-reversal entry won't be created. If you need one, post it manually after the change.</span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!target || submitting}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Change to {target ?? '…'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
