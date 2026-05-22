'use client';

/**
 * AuditHistoryDrawer — slides in from the right showing every audit row
 * (create / update / delete) for a single transaction. Powered by
 * /api/bookkeeping/books/[id]/transactions/[txId]/audit.
 *
 * Each entry shows: action badge, timestamp, user, and the captured diff
 * blob (rendered as a compact JSON tree).
 */

import { useEffect, useState } from 'react';
import { Loader2, X, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react';

interface AuditRow {
  id: string;
  action: 'create' | 'update' | 'delete';
  diff: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
}

interface Props {
  bookId: string;
  txId: string | null;
  refNo?: string;
  onClose: () => void;
}

function formatDateTimeUk(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const ACTION_META: Record<AuditRow['action'], { label: string; icon: typeof Plus; tone: string }> = {
  create: { label: 'Created', icon: Plus,    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: 'Edited',  icon: Pencil,  tone: 'bg-indigo-50 text-indigo-700 border-indigo-200'   },
  delete: { label: 'Deleted', icon: Trash2,  tone: 'bg-rose-50 text-rose-700 border-rose-200'         },
};

export default function AuditHistoryDrawer({ bookId, txId, refNo, onClose }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!txId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/bookkeeping/books/${bookId}/transactions/${txId}/audit`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setRows((d.audit ?? []) as AuditRow[]); })
      .catch(async r => {
        if (cancelled) return;
        const detail = await (r as Response).json?.().catch(() => null);
        setError(detail?.error ?? 'Could not load audit history.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, txId]);

  if (!txId) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[1400] bg-slate-900/30" onClick={onClose} />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 z-[1450] h-full w-[min(420px,90vw)] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
        role="dialog"
        aria-label="Audit history"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <ChevronRight size={14} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">Audit history</h2>
          {refNo && <span className="text-xs font-mono text-slate-500">{refNo}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No audit history yet.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map(row => {
                const meta = ACTION_META[row.action] ?? ACTION_META.update;
                const Icon = meta.icon;
                return (
                  <li key={row.id} className="rounded-md border border-slate-200 bg-white">
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.tone}`}>
                        <Icon size={9} /> {meta.label}
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {formatDateTimeUk(row.created_at)}
                      </span>
                      {row.user_name && (
                        <span className="ml-auto text-[11px] text-slate-600 truncate">{row.user_name}</span>
                      )}
                    </div>
                    {row.diff && Object.keys(row.diff).length > 0 && (
                      <pre className="px-3 py-2 text-[11px] text-slate-700 bg-slate-50/40 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(row.diff, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
