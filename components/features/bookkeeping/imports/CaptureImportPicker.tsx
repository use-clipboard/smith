'use client';

/**
 * CaptureImportPicker — pick a saved Capture analysis and stage it into this
 * book's import pipeline.
 *
 * Capture (full analysis) can already push an analysis into a book from its own
 * history screen. This is the same thing from the other end: the accountant is
 * sitting in the book, knows an analysis exists, and shouldn't have to go find
 * it in another tool. Both routes hit POST /imports/from-capture, so what lands
 * here is the identical pending import — preview → Post → rollback.
 *
 * Only analyses saved with target_software='smith' can be staged; the route
 * rejects anything else, so we filter to those up front rather than letting the
 * user pick one that's bound to fail.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileSpreadsheet, Sparkles, RefreshCw, ArrowRight } from 'lucide-react';
import { fetchJson } from '@/lib/fetchJson';

interface CaptureOutput {
  id: string;
  client_id: string | null;
  client_name: string | null;
  transaction_count: number | null;
  source_filenames: string[] | null;
  created_at: string;
  user: { full_name: string | null; email: string } | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

export default function CaptureImportPicker({
  bookId, clientId, onStaged,
}: {
  bookId: string;
  /** The book's client — used to default the list to this client's analyses. */
  clientId: string | null;
  /** Fires with the new import id once an analysis has been staged. */
  onStaged: (importId: string | null) => void;
}) {
  const [rows, setRows] = useState<CaptureOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Default to this client's analyses; the toggle widens to the whole firm. */
  const [thisClientOnly, setThisClientOnly] = useState(Boolean(clientId));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ feature: 'full_analysis', software: 'smith' });
      if (thisClientOnly && clientId) qs.set('client_id', clientId);
      const d = await fetchJson<{ outputs?: CaptureOutput[] }>(`/api/outputs?${qs.toString()}`);
      setRows(d.outputs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Capture analyses.');
    } finally {
      setLoading(false);
    }
  }, [clientId, thisClientOnly]);
  useEffect(() => { void load(); }, [load]);

  async function stage(id: string) {
    setBusyId(id); setError('');
    try {
      const res = await fetch(`/api/bookkeeping/books/${bookId}/imports/from-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Could not stage that analysis.');
      onStaged(d.import?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stage that analysis.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3.5 py-2.5 flex items-start gap-2">
        <Sparkles size={13} className="text-violet-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Analyses run in Capture and saved in <strong>SMITH Bookkeeping</strong> format. Picking one stages it here for
          review — nothing posts until you approve the preview, and it can be rolled back afterwards like any import.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex-1">
            Capture analyses{rows.length > 0 ? ` (${rows.length})` : ''}
          </h3>
          {clientId && (
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setThisClientOnly(true)}
                className={`px-2 py-0.5 ${thisClientOnly ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                This client
              </button>
              <button
                type="button"
                onClick={() => setThisClientOnly(false)}
                className={`px-2 py-0.5 border-l border-slate-200 ${!thisClientOnly ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                All clients
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh Capture analyses"
            className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <RefreshCw size={11} />
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 border-b border-rose-200 bg-rose-50 text-xs text-rose-700">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FileSpreadsheet size={22} className="mx-auto text-slate-300 mb-1.5" />
            <p className="text-xs text-slate-500">
              {thisClientOnly ? 'No SMITH-format Capture analyses for this client yet.' : 'No SMITH-format Capture analyses saved yet.'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              In Capture, choose <strong>SMITH Bookkeeping</strong> as the target software and save the result.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50 max-h-[52vh] overflow-y-auto">
            {rows.map(r => (
              <li key={r.id} className="px-3 py-2 flex items-center gap-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800 truncate">
                    {r.client_name ?? 'Unallocated'}
                    <span className="text-slate-400 font-normal"> · {r.transaction_count ?? 0} txns</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {formatDate(r.created_at)}
                    {r.user?.full_name ? ` · ${r.user.full_name}` : ''}
                    {r.source_filenames?.length ? ` · ${r.source_filenames.length} file${r.source_filenames.length === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void stage(r.id)}
                  disabled={busyId !== null}
                  className="text-[11px] px-2 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1 shrink-0"
                >
                  {busyId === r.id ? <Loader2 size={10} className="animate-spin" /> : <ArrowRight size={10} />}
                  {busyId === r.id ? 'Staging…' : 'Stage'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
