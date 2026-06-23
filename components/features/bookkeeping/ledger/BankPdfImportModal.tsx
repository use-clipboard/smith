'use client';

/**
 * BankPdfImportModal — drop a PDF (or image) bank statement into the ACTIVE
 * reconciliation. Visual twin of ContributeCsvModal, but the parsing happens
 * server-side: the file is sent to /extract-statement, where Claude transcribes
 * every transaction line into { date, description, amount } (signed). The
 * preview then hands those lines up via onParsedRows — identical to the CSV
 * "transactions" flow — so the workspace seeds the Manual entry sheet for
 * review, account allocation and posting. Nothing is posted from here.
 *
 * Kept as a separate component from the CSV modal so the proven client-side
 * CSV path stays untouched (no column-allocator, no synchronous re-parse — the
 * model handles structure).
 */

import { useState, useRef, useCallback } from 'react';
import { X, FileScan, Loader2, AlertCircle, FileText, Check } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';

interface ParsedLine {
  date: string;        // ISO yyyy-mm-dd
  description: string;
  amount: number;      // signed — positive = money in
}

interface Props {
  bookId: string;
  accountLabel: string;
  onClose: () => void;
  /** Fires once the user confirms the extracted statement. The parent opens
   *  the Manual sheet seeded with these rows (same contract as the CSV modal's
   *  transactions mode). */
  onParsedRows: (lines: ParsedLine[]) => void;
}

const ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function BankPdfImportModal({ bookId, accountLabel, onClose, onParsedRows }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [lines, setLines] = useState<ParsedLine[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setError(null);
    setLines(null);
    setTruncated(false);

    const isPdf = file.type === 'application/pdf';
    const isImage = IMAGE_TYPES.has(file.type);
    if (!isPdf && !isImage) {
      setError('Unsupported file — upload a PDF or an image (JPG, PNG, WEBP) of the statement.');
      return;
    }

    setExtracting(true);
    try {
      const base64 = await fileToBase64(file);
      const r = await fetch(`/api/bookkeeping/books/${bookId}/extract-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, mimeType: file.type, base64 }] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Could not read that statement.');
        return;
      }
      setLines(d.lines as ParsedLine[]);
      setTruncated(!!d.truncated);
    } catch (e) {
      setError(String(e));
    } finally {
      setExtracting(false);
    }
  }, [bookId]);

  function reset() {
    setLines(null); setFileName(null); setError(null); setTruncated(false);
  }

  function handleConfirm() {
    if (!lines || lines.length === 0) return;
    onParsedRows(lines);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[640px] max-w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <FileScan size={16} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Import statement from PDF</h2>
          <span className="text-xs text-slate-500 ml-2">→ {accountLabel}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* File picker — hidden once a file's been picked. */}
          {!fileName && (
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
              <FileScan size={20} className="mx-auto text-slate-400 mb-2" />
              <p className="text-sm text-slate-700 font-medium">
                Drop a PDF or image here, or <span className="text-indigo-700">browse</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                A scanned or downloaded bank statement. We&apos;ll read the transactions.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await handleFile(f);
                }}
              />
            </div>
          )}

          {/* Extracting spinner */}
          {extracting && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 py-10 px-6 text-center">
              <Loader2 size={22} className="mx-auto text-indigo-500 mb-2 animate-spin" />
              <p className="text-sm text-slate-700 font-medium">Reading {fileName}…</p>
              <p className="text-xs text-slate-500 mt-1">
                Transcribing every transaction — this can take a moment for a long statement.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 mt-3">
              <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-800">{error}</div>
            </div>
          )}

          {(error || (fileName && !extracting && !lines)) && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mt-3"
            >
              <FileText size={11} /> Pick a different file
            </button>
          )}

          {/* Preview — once extraction succeeded. */}
          {lines && !extracting && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2">
                <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-xs text-emerald-900">
                  Read <strong>{lines.length}</strong> transaction{lines.length === 1 ? '' : 's'} from <strong>{fileName}</strong>.
                </div>
              </div>

              {truncated && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                  <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-900">
                    This statement was long and may have been cut off — check the last few rows are all here.
                    If any are missing, import the remaining pages as a separate file afterwards.
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Always check the AI read the dates, amounts and in/out signs correctly before continuing.
              </p>

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
                    {lines.slice(0, 8).map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-700 tabular-nums">{formatDateUk(l.date)}</td>
                        <td className="px-2 py-1 text-slate-900 truncate max-w-[280px]">{l.description}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${l.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                          {l.amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    {lines.length > 8 && (
                      <tr className="border-t border-slate-100 text-center text-[11px] text-slate-400 italic">
                        <td colSpan={3} className="py-1">… {lines.length - 8} more</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={reset}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <FileText size={11} /> Pick a different file
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button onClick={onClose} disabled={extracting} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!lines || lines.length === 0 || extracting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            <FileScan size={11} /> Continue to review
          </button>
        </div>
      </div>
    </div>
  );
}
