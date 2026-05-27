'use client';

/**
 * PostMissingEntryModal — quick one-row "I spotted this on the statement
 * but it isn't posted yet" entry. Hits
 *   POST /bank-imports/[importId]/post-and-clear
 * which posts a real PAY/REC/CHQ/TRF transaction AND immediately clears
 * the bank-side split into the active rec — the user never leaves the
 * workspace.
 */

import { useState } from 'react';
import { X, Loader2, AlertCircle, Check } from 'lucide-react';
import DateInput, { parseUkDateStrict, fromIso } from '../input/DateInput';
import LedgerPicker from '../input/LedgerPicker';
import AccountPicker from '../input/AccountPicker';
import PayeeAutocomplete from '../input/PayeeAutocomplete';
import VatTreatmentPicker from '../input/VatTreatmentPicker';
import {
  VAT_TREATMENT_OPTIONS,
  type BookAccountRef, type VatTreatment,
} from '@/types/bookkeeping';

type RowType = 'PAY' | 'CHQ' | 'REC' | 'TRF';

interface Props {
  bookId: string;
  importId: string;
  accountId: string;
  accountName: string;
  vatRegistered: boolean;
  /** Default the date from the active rec's period (handy when the user is
   *  ticking the last few items on a finished statement). */
  defaultDateIso?: string | null;
  onClose: () => void;
  onPosted: () => void;
}

function rateFor(t: VatTreatment): number {
  return VAT_TREATMENT_OPTIONS.find(o => o.id === t)?.rate ?? 0;
}
function splitVatFromGross(total: number, rate: number) {
  if (rate <= 0) return { vat: 0, net: total };
  const net = +(total / (1 + rate / 100)).toFixed(2);
  return { vat: +(total - net).toFixed(2), net };
}
function parseAmount(s: string): number {
  return parseFloat(s.replace(/[,£\s]/g, '')) || 0;
}
function defaultLedgerFor(t: RowType): string {
  if (t === 'TRF') return 'Bank';
  if (t === 'REC') return 'Income';
  return 'Expenses';
}

// PAY red, REC green, CHQ amber, TRF sky — matches ManualBankRecSheet.
const TYPE_TONE: Record<RowType, string> = {
  PAY: 'bg-rose-50 text-rose-800 border-rose-200',
  REC: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CHQ: 'bg-amber-50 text-amber-800 border-amber-200',
  TRF: 'bg-sky-50 text-sky-800 border-sky-200',
};

export default function PostMissingEntryModal({
  bookId, importId, accountId, accountName, vatRegistered, defaultDateIso, onClose, onPosted,
}: Props) {
  const [type, setType] = useState<RowType>('PAY');
  const [date, setDate] = useState<string>(defaultDateIso ? fromIso(defaultDateIso) : fromIso(new Date().toISOString().slice(0, 10)));
  const [payee, setPayee] = useState<string>('');
  const [totalText, setTotalText] = useState<string>('');
  const [vatTreatment, setVatTreatment] = useState<VatTreatment>('no_vat');
  const [analysisLedger, setAnalysisLedger] = useState<string>(defaultLedgerFor('PAY'));
  const [analysis, setAnalysis] = useState<BookAccountRef | null>(null);
  const [entryDetails, setEntryDetails] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const total = parseAmount(totalText);
  const rate  = type === 'TRF' ? 0 : rateFor(vatTreatment);
  const { vat, net } = splitVatFromGross(total, rate);

  function changeType(t: RowType) {
    setType(t);
    setAnalysisLedger(defaultLedgerFor(t));
    setAnalysis(null);
    if (t === 'TRF') setVatTreatment('no_vat');
  }

  async function handleSubmit() {
    setError(null);
    const dateIso = parseUkDateStrict(date);
    if (!dateIso) { setError(`${date} isn't a real date (dd/mm/yyyy).`); return; }
    if (total < 0) { setError("Total can't be negative — flip the type instead (PAY ↔ REC)."); return; }
    if (!analysis) { setError('Pick an analysis account.'); return; }

    setSubmitting(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/post-and-clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          date: dateIso,
          payee_text: payee.trim() || null,
          details: payee.trim() || null,
          total,
          vat_total: vat,
          vat_rate: type === 'TRF' ? null : (rate || null),
          vat_treatment: vatTreatment,
          analysis_account_id: analysis.id,
          entry_details: entryDetails.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Failed to post');
        return;
      }
      onPosted();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[640px] max-w-full shadow-2xl border border-slate-200 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Post missing entry</h2>
          <span className="text-xs text-slate-500">→ {accountName} · auto-clears into this rec</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800"><X size={11} /></button>
          </div>
        )}

        <div className="p-5 space-y-3">
          {/* Type + date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Type</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['PAY','REC','CHQ','TRF'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => changeType(t)}
                    className={`text-xs px-2 py-1.5 rounded border font-semibold transition-colors ${
                      type === t ? TYPE_TONE[t] : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Date</label>
              <DateInput value={date} onChange={setDate} />
            </div>
          </div>

          {/* Payee */}
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              {type === 'TRF' ? 'Transfer description' : 'Payee / description'}
            </label>
            <PayeeAutocomplete
              bookId={bookId}
              type={type}
              value={payee}
              onChange={setPayee}
              onSelectPayee={p => {
                setPayee(p.payee_display);
                if (p.vat_treatment) setVatTreatment(p.vat_treatment);
                if (p.analysis_account) {
                  setAnalysisLedger(p.analysis_account.ledger ?? analysisLedger);
                  setAnalysis({ ...p.analysis_account, account_type: 'expense' as const });
                }
                if (p.entry_details) setEntryDetails(p.entry_details);
              }}
              placeholder={type === 'TRF' ? 'Transfer description' : 'Payee / description'}
            />
          </div>

          {/* Total + VAT + Net */}
          <div className={`grid ${vatRegistered ? 'grid-cols-3' : 'grid-cols-1'} gap-3`}>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Total</label>
              <input
                type="text"
                inputMode="decimal"
                value={totalText}
                onChange={e => setTotalText(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm rounded-md border border-slate-200 px-2.5 py-1.5 text-right tabular-nums focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            {vatRegistered && (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">VAT treatment</label>
                  {type === 'TRF' ? (
                    <div className="text-xs text-slate-400 italic px-2 py-1.5">n/a (transfer)</div>
                  ) : (
                    <VatTreatmentPicker
                      value={vatTreatment}
                      onChange={setVatTreatment}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Net</label>
                  <div className="text-sm px-2.5 py-1.5 text-right text-slate-600 tabular-nums rounded-md border border-slate-100 bg-slate-50">
                    {total > 0 ? net.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Analysis ledger + account */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {type === 'TRF' ? 'Other bank ledger' : 'Analysis ledger'}
              </label>
              <LedgerPicker
                value={analysisLedger}
                onChange={ledger => {
                  setAnalysisLedger(ledger);
                  if (analysis && analysis.ledger !== ledger) setAnalysis(null);
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {type === 'TRF' ? 'Other bank account' : 'Analysis account'}
              </label>
              <AccountPicker
                bookId={bookId}
                value={analysis?.id ?? null}
                valueDisplay={analysis?.name}
                onChange={a => {
                  setAnalysis(a);
                  if (a?.ledger) setAnalysisLedger(a.ledger);
                }}
                ledgerFilter={analysisLedger || undefined}
                disabled={!analysisLedger}
                placeholder={analysisLedger ? 'Account…' : 'Pick ledger first'}
              />
            </div>
          </div>

          {/* Entry details */}
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Entry details (optional)</label>
            <input
              type="text"
              value={entryDetails}
              onChange={e => setEntryDetails(e.target.value)}
              placeholder="Memo for this entry"
              className="w-full text-sm rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          {/* Suppress unused setAnalysisLedger ref warning where applicable */}
          {/* accountId reserved for downstream wiring (kept on Props for symmetry) */}
          <p className="hidden">{accountId}</p>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button onClick={onClose} disabled={submitting} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            {submitting ? <><Loader2 size={11} className="animate-spin" /> Posting…</> : <><Check size={11} /> Post &amp; clear</>}
          </button>
        </div>
      </div>
    </div>
  );
}
