'use client';

/**
 * BookImportTab — VT → SMITH bulk-import workspace.
 *
 *   ┌─ Upload card ─────────────────────────────────────────────────┐
 *   │  Drop a VT Transaction Report .xlsx here, or click to choose  │
 *   └────────────────────────────────────────────────────────────────┘
 *
 *   Once uploaded the staging row appears in the "Recent imports" list
 *   below. Click it to open the preview panel — row counts, type
 *   breakdown, COA mapping, errors. From the preview the user can either
 *   click **Post** (commits the import to the live ledger) or just leave
 *   it; the staging row stays in 'pending' status until acted on.
 *
 *   After a successful post the recent-imports list shows the row in
 *   green with a **Rollback** button that hard-deletes every transaction
 *   tagged with that import_id.
 *
 * Admin-only. The rail entry is hidden for non-admins, and every server
 * route in /api/bookkeeping/books/[id]/imports is admin-gated, so even
 * a deep link is harmless.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, RotateCcw, FileSpreadsheet,
  Trash2, ChevronRight, RefreshCw,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

interface ImportRow {
  id: string;
  book_id: string;
  file_name: string;
  status: 'pending' | 'posting' | 'posted' | 'errored' | 'rolled_back';
  summary: ImportSummary | null;
  created_at: string;
  posted_at: string | null;
  rolled_back_at: string | null;
  uploader: { id: string; full_name: string | null; email: string } | null;
}

interface ImportSummary {
  rows: number;
  transactions: number;
  byType: Record<string, number>;
  dateRange: { from: string; to: string };
  unbalanced: number;
  coaAccounts: number;
  coa: { existing: number; to_create: number };
  coa_detail?: Array<{
    display: string; ledger: string; accountName: string;
    inferredAccountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
    existing: boolean;
  }>;
  warnings?: string[];
  error?: string;
}

interface Props {
  bookId: string;
  isAdmin: boolean;
  /** Fires after a successful Post or Rollback so the rest of the book
   *  (Home recent feed, Key Information balances, any open ledger tabs)
   *  can refetch. Mirrors the `onPosted` callback the input sheets use. */
  onChanged?: () => void;
}

const STATUS_STYLE: Record<ImportRow['status'], { label: string; cls: string }> = {
  pending:     { label: 'Pending review',  cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  posting:     { label: 'Posting…',        cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  posted:      { label: 'Posted',          cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  errored:     { label: 'Errored',         cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  rolled_back: { label: 'Rolled back',     cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function BookImportTab({ bookId, isAdmin, onChanged }: Props) {
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/imports`);
      const d = r.ok ? await r.json() : { imports: [] };
      setImports(d.imports ?? []);
    } finally {
      setLoading(false);
    }
  }, [bookId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function handleUpload(file: File) {
    setError(''); setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const r = await fetch(`/api/bookkeeping/books/${bookId}/imports`, { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Upload failed');
      }
      const d = await r.json();
      await refresh();
      setSelectedId(d.import?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function onFileChosen(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    if (f) void handleUpload(f);
    ev.target.value = ''; // reset so picking the same file again triggers change
  }

  function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    const f = ev.dataTransfer.files?.[0];
    if (f) void handleUpload(f);
  }

  const selected = imports.find(i => i.id === selectedId) ?? null;

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 text-center">
        <FileSpreadsheet size={28} className="mx-auto text-slate-300 mb-2" />
        <h3 className="text-sm font-semibold text-slate-700">Bulk import</h3>
        <p className="text-xs text-slate-500 mt-1">Admins only. Ask your firm admin to run the import.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 items-start">
      {/* Left — upload + selected import preview */}
      <div className="space-y-3">
        {/* Upload zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
        >
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFileChosen}
              disabled={uploading}
              className="hidden"
            />
            <Upload size={24} className="mx-auto text-slate-400 mb-2" />
            <div className="text-sm font-medium text-slate-700">
              {uploading ? 'Parsing your spreadsheet…' : 'Drop a VT Transaction Report .xlsx here'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {uploading ? <Loader2 size={12} className="inline animate-spin mr-1.5" /> : null}
              {uploading ? 'this can take a few seconds for large files' : 'or click to choose a file'}
            </div>
          </label>
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        {/* Selected import preview */}
        {selected && (
          <ImportPreviewCard
            bookId={bookId}
            row={selected}
            onChanged={() => { void refresh(); onChanged?.(); }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* Right — recent imports list */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent imports</h3>
          <Tooltip label="Refresh">
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Refresh imports"
              className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700"
            >
              <RefreshCw size={11} />
            </button>
          </Tooltip>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
          </div>
        ) : imports.length === 0 ? (
          <p className="text-xs text-slate-400 italic px-3 py-4 text-center">
            No imports yet. Upload a file above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
            {imports.map(i => {
              const active = i.id === selectedId;
              const style = STATUS_STYLE[i.status];
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(i.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${
                      active ? 'bg-indigo-50/60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={12} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-800 truncate flex-1">{i.file_name}</span>
                      <ChevronRight size={11} className="text-slate-300 shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${style.cls}`}>
                        {style.label}
                      </span>
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        {i.summary?.transactions ?? 0} txns
                      </span>
                      <span className="text-[10px] text-slate-400 ml-auto">
                        {formatDateTime(i.created_at)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Preview / actions card ──────────────────────────────────────────────────

function ImportPreviewCard({
  bookId, row, onChanged, onClose,
}: {
  bookId: string;
  row: ImportRow;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const summary = row.summary;

  async function commit() {
    setActionError(''); setBusy(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/imports/${row.id}`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? d.error ?? 'Post failed');
      }
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!confirm('Roll back this import? Every transaction it inserted will be permanently deleted.')) return;
    setActionError(''); setBusy(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/imports/${row.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Rollback failed');
      }
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Rollback failed');
    } finally {
      setBusy(false);
    }
  }

  const byType = summary?.byType ?? {};
  const typeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet size={14} className="text-slate-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{row.file_name}</h3>
            <p className="text-[11px] text-slate-500">
              Uploaded {formatDateTime(row.created_at)}
              {row.uploader?.full_name ? ` by ${row.uploader.full_name}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100"
        >
          Close
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4 border-b border-slate-100">
        <Stat label="Transactions" value={summary?.transactions ?? 0} />
        <Stat label="Spreadsheet rows" value={summary?.rows ?? 0} />
        <Stat label="Distinct accounts" value={summary?.coaAccounts ?? 0} />
        <Stat
          label="Unbalanced"
          value={summary?.unbalanced ?? 0}
          tone={summary && summary.unbalanced > 0 ? 'warn' : 'normal'}
        />
        {summary?.dateRange?.from && (
          <Stat
            label="Date range"
            value={`${summary.dateRange.from} → ${summary.dateRange.to}`}
            small
          />
        )}
        <Stat label="Accounts to create" value={summary?.coa?.to_create ?? 0} tone={summary && summary.coa?.to_create ? 'info' : 'normal'} />
        <Stat label="Existing accounts" value={summary?.coa?.existing ?? 0} />
      </div>

      {/* Type breakdown */}
      {typeEntries.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Transaction types</div>
          <div className="flex flex-wrap gap-1.5">
            {typeEntries.map(([t, n]) => (
              <span key={t} className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded bg-slate-100 text-slate-700">
                <span className="font-semibold">{t}</span>
                <span className="tabular-nums text-slate-500">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* COA mapping */}
      {summary?.coa_detail && summary.coa_detail.length > 0 && (
        <details className="border-b border-slate-100">
          <summary className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 cursor-pointer hover:bg-slate-50">
            Chart of accounts ({summary.coa.existing} existing, {summary.coa.to_create} to create) — click to expand
          </summary>
          <div className="max-h-56 overflow-y-auto px-4 py-2">
            <ul className="space-y-0.5">
              {summary.coa_detail.map(c => (
                <li key={c.display} className="text-[11px] flex items-center gap-2">
                  <span className={`inline-flex w-4 h-4 items-center justify-center rounded ${
                    c.existing ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {c.existing ? <CheckCircle2 size={10} /> : '+'}
                  </span>
                  <span className="text-slate-700">{c.display}</span>
                  {!c.existing && (
                    <span className="text-slate-400 ml-auto">{c.inferredAccountType}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* Warnings */}
      {summary?.warnings && summary.warnings.length > 0 && (
        <details className="border-b border-slate-100">
          <summary className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 cursor-pointer hover:bg-amber-50">
            <AlertTriangle size={11} className="inline mr-1" />
            {summary.warnings.length} parser warnings — click to expand
          </summary>
          <ul className="max-h-40 overflow-y-auto px-4 py-2 text-[11px] text-amber-700 space-y-0.5">
            {summary.warnings.slice(0, 50).map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </details>
      )}

      {/* Action errors */}
      {actionError && (
        <div className="px-4 py-2 border-b border-rose-200 bg-rose-50 text-xs text-rose-700">
          {actionError}
        </div>
      )}
      {summary?.error && (
        <div className="px-4 py-2 border-b border-rose-200 bg-rose-50 text-xs text-rose-700">
          Previous post error: {summary.error}
        </div>
      )}

      {/* Action bar */}
      <div className="px-4 py-3 flex items-center justify-end gap-2 bg-slate-50/40">
        {row.status === 'pending' && (
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Post all {summary?.transactions ?? 0} transactions
          </button>
        )}
        {(row.status === 'posted' || row.status === 'errored') && (
          <button
            type="button"
            onClick={rollback}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            Roll back
          </button>
        )}
        {row.status === 'posting' && (
          <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Posting in progress…
          </span>
        )}
        {row.status === 'rolled_back' && (
          <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
            <Trash2 size={11} /> Rolled back
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, tone = 'normal', small = false,
}: {
  label: string;
  value: number | string;
  tone?: 'normal' | 'info' | 'warn';
  small?: boolean;
}) {
  const valueCls =
    tone === 'warn' ? 'text-amber-700' :
    tone === 'info' ? 'text-indigo-700' :
    'text-slate-900';
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 ${small ? 'text-xs' : 'text-base'} font-semibold ${valueCls} tabular-nums`}>{value}</div>
    </div>
  );
}
