'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ScrollText, ShieldCheck, X, Search, Loader2, AlertCircle, ChevronRight,
  FilePlus2, Pencil, Trash2, Send, CheckCircle2, RotateCcw, Landmark, Download,
} from 'lucide-react';
import { actionMeta, type AuditEntry, type AuditTone } from '@/lib/audit/types';

const TONE_STYLE: Record<AuditTone, { icon: typeof FilePlus2; cls: string }> = {
  create:   { icon: FilePlus2,    cls: 'bg-indigo-50 text-indigo-600' },
  edit:     { icon: Pencil,       cls: 'bg-amber-50 text-amber-600' },
  delete:   { icon: Trash2,       cls: 'bg-red-50 text-red-600' },
  send:     { icon: Send,         cls: 'bg-sky-50 text-sky-600' },
  approve:  { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600' },
  reject:   { icon: RotateCcw,    cls: 'bg-amber-50 text-amber-600' },
  file:     { icon: Landmark,     cls: 'bg-indigo-50 text-indigo-600' },
  download: { icon: Download,     cls: 'bg-slate-100 text-slate-600' },
  neutral:  { icon: ScrollText,   cls: 'bg-slate-100 text-slate-600' },
};

function ukDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Shared admin audit-history viewer. Fetches /api/audit?tool=… (admin-only) and
 * renders a searchable, action-filterable timeline. Used by every tool's history
 * dashboard via the HistoryActions pill.
 */
export default function AuditHistoryModal({
  tool, title = 'Audit history', onClose,
}: {
  tool: string;
  title?: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audit?tool=${encodeURIComponent(tool)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load the audit history.'))))
      .then(d => { if (!cancelled) setEntries(d.entries ?? []); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the audit history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tool]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
      if (action !== 'all' && e.action !== action) return false;
      if (!needle) return true;
      return (
        (e.entityLabel ?? '').toLowerCase().includes(needle) ||
        e.actorName.toLowerCase().includes(needle) ||
        (e.summary ?? '').toLowerCase().includes(needle)
      );
    });
  }, [entries, q, action]);

  const presentActions = useMemo(() => [...new Set(entries.map(e => e.action))], [entries]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScrollText size={18} /></span>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{title}</h3>
              <p className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><ShieldCheck size={11} /> Admin only · everything done in this tool</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]"><X size={16} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, user or action…" className="input-base h-8 w-full pl-8 text-[12.5px]" />
          </div>
          <select value={action} onChange={e => setAction(e.target.value)} className="input-base h-8 text-[12.5px]">
            <option value="all">All actions</option>
            {presentActions.map(a => <option key={a} value={a}>{actionMeta(a).label}</option>)}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="py-12 text-center"><Loader2 size={20} className="mx-auto mb-2 animate-spin text-[var(--accent)]" /><p className="text-[13px] text-[var(--text-muted)]">Loading history…</p></div>}
          {!loading && error && <div className="py-12 text-center"><AlertCircle size={22} className="mx-auto mb-2 text-red-400" /><p className="text-[13px] text-red-600">{error}</p></div>}
          {!loading && !error && shown.length === 0 && (
            <div className="py-12 text-center"><ScrollText size={24} className="mx-auto mb-2 text-gray-300" /><p className="text-[13px] text-[var(--text-muted)]">{entries.length === 0 ? 'No activity recorded yet.' : 'No entries match your filters.'}</p></div>
          )}
          {!loading && !error && shown.map(e => {
            const meta = actionMeta(e.action);
            const tone = TONE_STYLE[meta.tone];
            const Icon = tone.icon;
            const hasChanges = !!(e.changes && e.changes.length);
            const isOpen = expanded.has(e.id);
            return (
              <div key={e.id} className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-[var(--bg-nav-hover)]">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.cls}`}><Icon size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">{meta.label}</span>
                    {e.entityLabel && <span className="truncate text-[12.5px] text-[var(--text-secondary)]">· {e.entityLabel}</span>}
                  </div>
                  {e.summary && <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{e.summary}</p>}
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{e.actorName} · {ukDateTime(e.createdAt)}</p>
                  {hasChanges && (
                    <>
                      <button
                        onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                      >
                        <ChevronRight size={12} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        {isOpen ? 'Hide' : 'Show'} {e.changes!.length} change{e.changes!.length === 1 ? '' : 's'}
                      </button>
                      {isOpen && (
                        <div className="mt-1.5 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)] p-2.5">
                          {e.changes!.map((c, i) => (
                            <div key={i} className="text-[11.5px]">
                              <span className="font-semibold text-[var(--text-primary)]">{c.label}:</span>{' '}
                              <span className="text-[var(--text-muted)] line-through">{c.from || '—'}</span>{' → '}
                              <span className="text-[var(--text-secondary)]">{c.to || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
