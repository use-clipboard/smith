'use client';

/**
 * ContributeCsvModal — drop a CSV into the ACTIVE reconciliation.
 *
 * Visual twin of NewBankImportModal but submits to
 *   POST /bank-imports/[importId]/contribute-lines
 * so the parsed lines land on the user's open rec rather than spawning a
 * sibling import (which would violate the one-active-rec-per-account
 * partial unique index).
 *
 * Same client-side preview pattern — parse on file pick, show columns +
 * sample rows, commit on confirm.
 */

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2, AlertCircle, FileText, Check } from 'lucide-react';
import { parseBankCsv, type ParseResult, type ColumnOverrides } from '@/lib/bookkeeping/bankCsvParser';
import DuplicateReviewModal, { type DupeSuspect } from './DuplicateReviewModal';

interface SuspectedDuplicateResponse {
  index: number;
  line:  { date: string; description: string; amount: number; statementBalance: number | null };
  match: {
    ref_no: string; date: string; signed_amount: number; details: string | null;
  };
}

interface Props {
  bookId: string;
  importId: string;
  accountLabel: string;
  /** Two flows share this modal:
   *
   *    reference    — original behaviour: parsed lines POST straight to
   *                   /contribute-lines as bookkeeping_bank_lines (no
   *                   ledger transactions). Used by the legacy
   *                   "Import as statement lines" entry point.
   *
   *    transactions — new flow: the modal parses + previews only, then
   *                   calls onParsedRows with the parsed lines. The
   *                   workspace then opens the Manual entry sheet
   *                   pre-populated with those rows, so the user can
   *                   review, allocate accounts, and post as REAL
   *                   PAY/REC transactions.
   *
   *  Defaults to 'reference' to keep existing call sites unchanged. */
  mode?: 'reference' | 'transactions';
  onClose: () => void;
  /** Fires after a successful contribute (reference mode only). */
  onContributed?: () => void;
  /** Fires once the user confirms a parsed CSV in transactions mode.
   *  The parent then opens the Manual sheet seeded with these rows. */
  onParsedRows?: (lines: Array<{
    date: string;        // ISO yyyy-mm-dd
    description: string;
    amount: number;      // signed (positive = money in)
  }>) => void;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function ContributeCsvModal({
  bookId, importId, accountLabel, mode = 'reference', onClose, onContributed, onParsedRows,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText,  setCsvText]  = useState<string>('');
  const [parse,    setParse]    = useState<ParseResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [suspects, setSuspects] = useState<SuspectedDuplicateResponse[] | null>(null);
  /** User-supplied overrides for the column-allocation editor. Each role
   *  maps to a CSV column index (number), explicit "none" (null), or
   *  absent (undefined → use auto-detect for that role). Triggers a
   *  synchronous re-parse on every change so the preview reflects the
   *  new mapping live. */
  const [overrides, setOverrides] = useState<ColumnOverrides>({});
  /** Headers from the most recent parse — kept available even when the
   *  parse fails so the editor can still render. */
  const [headers, setHeaders] = useState<string[]>([]);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setError(null);
    setParse(null);
    setOverrides({});
    const text = await file.text();
    setCsvText(text);
    const result = parseBankCsv(text);
    if (!result.ok) {
      setError(result.error);
      setHeaders(result.headers ?? []);
      return;
    }
    setHeaders(result.headers);
    setParse(result);
  }, []);

  /** Re-run the parser with a new override map and update preview state.
   *  Synchronous and cheap — no debouncing needed. Called whenever the
   *  user picks a different column for a role. */
  const reparseWith = useCallback((next: ColumnOverrides) => {
    setOverrides(next);
    if (!csvText) return;
    const result = parseBankCsv(csvText, { columnOverrides: next });
    if (!result.ok) {
      setError(result.error);
      setHeaders(result.headers ?? headers);
      setParse(null);
      return;
    }
    setError(null);
    setHeaders(result.headers);
    setParse(result);
  }, [csvText, headers]);

  /** Single submit helper used by all three paths: initial submit, "skip
   *  flagged" resubmit, and "add anyway" resubmit.
   *
   *  Branches on `mode`:
   *    • 'transactions' → emit parsed lines via onParsedRows and close
   *      the modal. No server call; the parent opens the Manual sheet
   *      pre-populated with these rows for review + allocate + post.
   *    • 'reference'    → POST direct to /contribute-lines (legacy
   *      behaviour). Server-side dupe detection still kicks in; we
   *      surface 409 → DuplicateReviewModal exactly as before.
   */
  async function submitContribute(opts: {
    skipIndices?: number[];
    confirmDuplicates?: boolean;
  }) {
    if (!parse || !parse.ok) return;

    if (mode === 'transactions') {
      // No server call — hand parsed lines up to the parent so the Manual
      // sheet can open with them as seedRows. Dupe / out-of-period checks
      // happen inside the sheet at post time, same as a manual entry.
      onParsedRows?.(parse.lines.map(l => ({
        date:        l.date,
        description: l.description,
        amount:      l.amount,
      })));
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/contribute-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csvText,
          skip_indices: opts.skipIndices,
          confirm_duplicates: opts.confirmDuplicates,
        }),
      });
      if (r.status === 409) {
        const d = await r.json().catch(() => ({}));
        if (d.error === 'suspected_duplicates' && Array.isArray(d.suspected_duplicates)) {
          setSuspects(d.suspected_duplicates as SuspectedDuplicateResponse[]);
          setSubmitting(false);
          return;
        }
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Upload failed');
        setSubmitting(false);
        return;
      }
      onContributed?.();
      onClose();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }
  function handleSubmit() { void submitContribute({}); }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[640px] max-w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <Upload size={16} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            {mode === 'transactions'
              ? 'Import CSV as transactions'
              : 'Add statement lines from CSV'}
          </h2>
          <span className="text-xs text-slate-500 ml-2">→ {accountLabel}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* File picker — drag or click. Hidden once any file's been
              picked (even if parse failed); the user can re-pick via the
              "Pick a different file" link below. */}
          {!csvText && (
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
                The lines get added to the active reconciliation.
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

          {/* When we have headers but no successful parse (auto-detect
              failed but we know the columns) let the user fix it. */}
          {!parse && headers.length > 0 && csvText && (
            <div className="mt-3 space-y-2">
              <ColumnAllocator
                headers={headers}
                map={null}
                overrides={overrides}
                onChange={reparseWith}
              />
              <button
                type="button"
                onClick={() => {
                  setParse(null); setFileName(null); setCsvText('');
                  setError(null); setHeaders([]); setOverrides({});
                }}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <FileText size={11} /> Pick a different file
              </button>
            </div>
          )}

          {parse && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2">
                <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-xs text-emerald-900">
                  Parsed <strong>{parse.lines.length}</strong> lines from <strong>{fileName}</strong>.
                  {parse.skipped.length > 0 && <> Skipped {parse.skipped.length}.</>}
                </div>
              </div>

              <ColumnAllocator
                headers={headers}
                map={parse.columnMap}
                overrides={overrides}
                onChange={reparseWith}
              />

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
            {submitting
              ? <><Loader2 size={11} className="animate-spin" /> Adding lines…</>
              : mode === 'transactions'
                ? <><Upload size={11} /> Continue to review</>
                : <><Upload size={11} /> Add lines to rec</>}
          </button>
        </div>
      </div>

      {/* Duplicate review — shown after the server flags potential dupes.
          Closing this modal returns the user to the CSV preview so they
          can pick a different file. */}
      {suspects && parse?.ok && (
        <DuplicateReviewModal
          totalCount={parse.lines.length}
          busy={submitting}
          suspects={suspects.map<DupeSuspect>(s => ({
            index: s.index,
            candidateDate:  s.line.date,
            candidateAmount: s.line.amount,
            candidateLabel: s.line.description,
            matchRef:           s.match.ref_no,
            matchDate:          s.match.date,
            matchSignedAmount:  s.match.signed_amount,
            matchDetails:       s.match.details,
          }))}
          onClose={() => setSuspects(null)}
          onSkip={(indices) => {
            setSuspects(null);
            void submitContribute({ skipIndices: indices });
          }}
          onConfirmAll={() => {
            setSuspects(null);
            void submitContribute({ confirmDuplicates: true });
          }}
        />
      )}
    </div>
  );
}

// ── Column allocation editor ──────────────────────────────────────────────
// Lets the user override the auto-detected role → CSV column mapping.
// Each role has a <select> populated with all the CSV column headers plus
// "(none)" for the optional roles. Changes fire onChange synchronously so
// the parent can re-parse + refresh the preview.
function ColumnAllocator({
  headers, map, overrides, onChange,
}: {
  headers: string[];
  /** Current effective mapping (auto + overrides applied). null when the
   *  parse failed entirely — in that case nothing is "selected" yet and
   *  the user picks from scratch. */
  map: import('@/lib/bookkeeping/bankCsvParser').ColumnMap | null;
  overrides: ColumnOverrides;
  onChange: (next: ColumnOverrides) => void;
}) {
  const set = (role: keyof ColumnOverrides, value: number | null) => {
    onChange({ ...overrides, [role]: value });
  };

  // Roles that allow "(none)" (every role except Date).
  type Role = {
    key: keyof ColumnOverrides;
    label: string;
    current: number | null | undefined;
    required: boolean;
    hint?: string;
  };
  const roles: Role[] = [
    { key: 'date',         label: 'Date',         current: map?.date ?? null,         required: true },
    { key: 'description',  label: 'Description',  current: map?.description ?? null,  required: false },
    { key: 'amountSigned', label: 'Amount',       current: map?.amountSigned ?? null, required: false, hint: 'use this OR the Money in + Money out pair' },
    { key: 'moneyIn',      label: 'Money in',     current: map?.moneyIn ?? null,      required: false },
    { key: 'moneyOut',     label: 'Money out',    current: map?.moneyOut ?? null,     required: false },
    { key: 'balance',      label: 'Balance',      current: map?.balance ?? null,      required: false },
  ];

  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/40">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
        Column allocation
        <span className="ml-2 normal-case text-slate-400 font-normal">— check each one matches the CSV; change anything that&apos;s wrong</span>
      </p>
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 items-center text-xs">
        {roles.map(role => (
          <div key={role.key} className="contents">
            <label className="text-slate-600">
              {role.label}
              {role.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
            <select
              value={role.current == null ? '__none' : String(role.current)}
              onChange={e => {
                const v = e.target.value;
                if (v === '__none') {
                  // For required roles "(none)" doesn't make sense; the
                  // parser will reject it but we let the user have the
                  // intermediate state.
                  set(role.key, null);
                } else {
                  set(role.key, parseInt(v, 10));
                }
              }}
              className="text-xs rounded border border-slate-200 bg-white px-2 py-1 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              {!role.required && <option value="__none">(none)</option>}
              {role.required && role.current == null && <option value="__none">— pick a column —</option>}
              {headers.map((h, i) => (
                <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">
        * Date is required. You also need <strong>either</strong> an Amount column <strong>or</strong> both Money in &amp; Money out together.
      </p>
    </div>
  );
}
