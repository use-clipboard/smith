'use client';

/**
 * NewBankImportModal — drag/click a CSV file in, see a preview of what we
 * parsed (which columns we picked, sample rows, how many we skipped), then
 * commit to create the import + lines.
 *
 * The preview is purely client-side via the same parser the API will run —
 * lets the user catch obvious column-mapping issues before they touch the DB.
 */

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2, AlertCircle, FileText, Check } from 'lucide-react';
import { parseBankCsv, type ParseResult } from '@/lib/bookkeeping/bankCsvParser';

interface Props {
  bookId: string;
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onCreated: (importId: string) => void;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function NewBankImportModal({ bookId, accountId, accountLabel, onClose, onCreated }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local UI state — the parser is synchronous so we can do all the preview
  // work in one shot when the user picks a file.
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText,  setCsvText]  = useState<string>('');
  const [parse,    setParse]    = useState<ParseResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [displayLabel, setDisplayLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setError(null);
    setParse(null);
    const text = await file.text();
    setCsvText(text);
    const result = parseBankCsv(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setParse(result);
    // Sensible default label — first month seen in the file.
    if (!displayLabel) {
      const first = result.lines[0]?.date;
      if (first) {
        const d = new Date(first);
        setDisplayLabel(d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' statement');
      }
    }
  }, [displayLabel]);

  async function handleSubmit() {
    if (!parse || !parse.ok || !fileName) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          file_name: fileName,
          display_label: displayLabel || null,
          csv: csvText,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Upload failed');
        setSubmitting(false);
        return;
      }
      const d = await r.json();
      onCreated(d.import.id);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[640px] max-w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <Upload size={16} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Import bank statement</h2>
          <span className="text-xs text-slate-500 ml-2">→ {accountLabel}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* File picker — drag or click */}
          {!parse && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async e => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) await handleFile(file);
              }}
              className={`rounded-xl border-2 border-dashed py-10 px-6 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <Upload size={20} className="mx-auto text-slate-400 mb-2" />
              <p className="text-sm text-slate-700 font-medium">
                Drop a CSV file here, or <span className="text-indigo-700">browse</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Any UK bank's CSV export. We&apos;ll figure out the columns.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,application/vnd.ms-excel"
                className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await handleFile(f);
                }}
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 mt-3">
              <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-800">{error}</div>
            </div>
          )}

          {/* Preview — once a file parsed successfully */}
          {parse && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2">
                <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-xs text-emerald-900">
                  Parsed <strong>{parse.lines.length}</strong> lines from <strong>{fileName}</strong>.
                  {parse.skipped.length > 0 && <> Skipped {parse.skipped.length}.</>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Label this statement</label>
                <input
                  type="text"
                  value={displayLabel}
                  onChange={e => setDisplayLabel(e.target.value)}
                  placeholder="e.g. Apr 2026 statement"
                  className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  maxLength={80}
                />
              </div>

              {/* Column mapping confirmation */}
              <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/40">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Columns picked</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">Date</dt><dd className="text-slate-900 truncate">{parse.columns.date}</dd>
                  {parse.columns.description && (<><dt className="text-slate-500">Description</dt><dd className="text-slate-900 truncate">{parse.columns.description}</dd></>)}
                  {parse.columns.amountSigned && (<><dt className="text-slate-500">Amount</dt><dd className="text-slate-900 truncate">{parse.columns.amountSigned}</dd></>)}
                  {parse.columns.moneyIn  && (<><dt className="text-slate-500">Money in</dt><dd className="text-slate-900 truncate">{parse.columns.moneyIn}</dd></>)}
                  {parse.columns.moneyOut && (<><dt className="text-slate-500">Money out</dt><dd className="text-slate-900 truncate">{parse.columns.moneyOut}</dd></>)}
                  {parse.columns.balance  && (<><dt className="text-slate-500">Balance</dt><dd className="text-slate-900 truncate">{parse.columns.balance}</dd></>)}
                </dl>
              </div>

              {/* Sample rows — first 5 + last 1 if more */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-20">Date</th>
                      <th className="px-2 py-1.5 text-left">Description</th>
                      <th className="px-2 py-1.5 text-right w-24">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parse.lines.slice(0, 5).map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-700 tabular-nums">{formatDateUk(l.date)}</td>
                        <td className="px-2 py-1 text-slate-900 truncate max-w-[280px]">{l.description}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${l.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                          {l.amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    {parse.lines.length > 5 && (
                      <tr className="border-t border-slate-100 text-center text-[11px] text-slate-400 italic">
                        <td colSpan={3} className="py-1">… {parse.lines.length - 5} more</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {parse.skipped.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                    Skipped {parse.skipped.length} row{parse.skipped.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1 pl-3 space-y-0.5 text-slate-500">
                    {parse.skipped.slice(0, 6).map((s, i) => (
                      <li key={i}>Line {s.lineNo}: {s.reason}</li>
                    ))}
                    {parse.skipped.length > 6 && <li className="italic">… {parse.skipped.length - 6} more</li>}
                  </ul>
                </details>
              )}

              <button
                type="button"
                onClick={() => { setParse(null); setFileName(null); setCsvText(''); setError(null); }}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <FileText size={11} /> Pick a different file
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button onClick={onClose} disabled={submitting} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!parse || !parse.ok || submitting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            {submitting ? <><Loader2 size={11} className="animate-spin" /> Importing…</> : <><Upload size={11} /> Import statement</>}
          </button>
        </div>
      </div>
    </div>
  );
}
