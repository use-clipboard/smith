'use client';

/**
 * MarkAsFiledModal — captures the metadata for filing a VAT return.
 *
 * The figures themselves are NOT collected here — the server recomputes them
 * from scratch on submission (never trust client-supplied financials). The
 * modal only collects:
 *   • Filing date (defaults to today)
 *   • HMRC submission reference (optional, free text)
 *   • Internal notes (optional)
 *   • Whether to lock the period (default ticked)
 *
 * Box 5 is shown prominently so the user confirms what they're committing.
 */

import { useState } from 'react';
import { CheckCircle2, Loader2, Send, X } from 'lucide-react';
import DateInput, { parseUkDateStrict, fromIso } from '../input/DateInput';

interface Props {
  open: boolean;
  onClose: () => void;
  bookId: string;
  periodFrom: string;  // ISO yyyy-mm-dd
  periodTo: string;    // ISO
  box5: number;
  lateEntryVat: number;
  onFiled: () => void;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmt(n: number): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MarkAsFiledModal({
  open, onClose, bookId, periodFrom, periodTo, box5, lateEntryVat, onFiled,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [filingDate, setFilingDate] = useState<string>(fromIso(today));
  const [hmrcRef, setHmrcRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lockPeriod, setLockPeriod] = useState(true);
  // "Already submitted to HMRC?" — separates the SMITH filing event from the
  // actual HMRC submission. Most internal-team users tick this and put today;
  // the SaaS flow will eventually populate it via the MTD API.
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [submittedDate, setSubmittedDate] = useState<string>(fromIso(today));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleSubmit() {
    setError('');
    const isoFilingDate = parseUkDateStrict(filingDate);
    if (!isoFilingDate) { setError('Filing date must be a valid date.'); return; }
    let isoSubmittedAt: string | null = null;
    if (alreadySubmitted) {
      isoSubmittedAt = parseUkDateStrict(submittedDate);
      if (!isoSubmittedAt) { setError('HMRC submission date must be a valid date.'); return; }
    }

    setSubmitting(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/vat-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: periodFrom,
          to: periodTo,
          filing_date: isoFilingDate,
          hmrc_reference: hmrcRef.trim() || null,
          notes: notes.trim() || null,
          lock_period: lockPeriod,
          submitted_at: isoSubmittedAt,
          submission_method: isoSubmittedAt ? 'manual' : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'File failed');
      }
      // Surface the closing-journal warning if any so the user knows.
      const body = await r.json().catch(() => ({}));
      if (body?.journal_warning) {
        // eslint-disable-next-line no-alert
        alert(`Filing succeeded but: ${body.journal_warning}`);
      }
      onFiled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File failed');
    } finally {
      setSubmitting(false);
    }
  }

  const isRefund = box5 < 0;

  return (
    <div className="fixed inset-0 z-[1500] bg-slate-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Send size={14} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Mark VAT return as filed</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Period + Box 5 summary */}
          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Period</span>
              <span className="text-slate-900 font-medium tabular-nums">
                {formatDateUk(periodFrom)} – {formatDateUk(periodTo)}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200">
              <span className="text-slate-500">
                {isRefund ? 'VAT to reclaim from HMRC' : 'VAT payable to HMRC'} (Box 5)
              </span>
              <span className="text-indigo-700 font-bold text-base tabular-nums">£{fmt(Math.abs(box5))}</span>
            </div>
            {lateEntryVat !== 0 && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200">
                <span className="text-slate-500">Includes late-entry VAT</span>
                <span className="text-amber-800 tabular-nums">£{fmt(lateEntryVat)}</span>
              </div>
            )}
          </div>

          {/* Filing date */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Filing date
            </label>
            <DateInput
              value={filingDate}
              onChange={setFilingDate}
              className="px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* HMRC reference */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              HMRC submission reference <span className="text-slate-400 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={hmrcRef}
              onChange={e => setHmrcRef(e.target.value)}
              placeholder="e.g. HMRC-7890-ABC"
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Paste the reference HMRC gave you when you submitted (if you've already submitted via your MTD bridge).
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Internal notes <span className="text-slate-400 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything to record alongside this filing"
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Already submitted to HMRC? */}
          <div className="rounded-md border border-slate-200 px-3 py-2.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={alreadySubmitted}
                onChange={e => setAlreadySubmitted(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs">
                <div className="font-medium text-slate-900">Already submitted to HMRC</div>
                <div className="text-slate-500 mt-0.5">
                  Tick this if you've already submitted via your MTD bridge or HMRC online. Leave unticked if you're recording the figures now and submitting separately.
                </div>
              </div>
            </label>
            {alreadySubmitted && (
              <div className="mt-2 ml-6">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Submitted on
                </label>
                <div className="max-w-[180px]">
                  <DateInput
                    value={submittedDate}
                    onChange={setSubmittedDate}
                    className="px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Lock period */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={lockPeriod}
              onChange={e => setLockPeriod(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="text-xs">
              <div className="font-medium text-slate-900">Lock the VAT period</div>
              <div className="text-slate-500 mt-0.5">
                Once locked, transactions dated in this period can still be posted as <em>late entries</em> — their VAT will be carried into the next return.
              </div>
            </div>
          </label>

          {/* Closing-journal explainer */}
          <div className="rounded-md bg-indigo-50/50 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-900">
            <strong>One more thing:</strong> filing will also post a closing
            journal that zeros the VAT control accounts and moves the net to{' '}
            <span className="font-mono">Creditors: Net VAT due</span> — so the
            balance sheet shows what's actually owed to/from HMRC.
          </div>

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
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Confirm and file
          </button>
        </div>
      </div>
    </div>
  );
}
