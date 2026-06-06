'use client';

/**
 * MtdItHistoryModal — firm-wide MTD-IT activity feed: status changes, approval
 * emails + client responses, and HMRC submissions/amendments, newest first.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  X, Loader2, History, Pencil, Mail, CheckCircle2, AlertTriangle, Landmark, RefreshCw, Search, Download, type LucideIcon,
} from 'lucide-react';

interface ActivityEvent {
  at: string;
  kind: string;
  label: string;
  client: string | null;
  clientRef: string | null;
  actor: string | null;
}

const ICON: Record<string, { Icon: LucideIcon; cls: string }> = {
  status_change:            { Icon: Pencil,       cls: 'text-slate-500 bg-slate-100' },
  sent_for_approval:        { Icon: Mail,         cls: 'text-sky-600 bg-sky-50' },
  client_approved:          { Icon: CheckCircle2, cls: 'text-violet-600 bg-violet-50' },
  client_changes_requested: { Icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50' },
  submitted:                { Icon: Landmark,     cls: 'text-emerald-600 bg-emerald-50' },
  amended:                  { Icon: RefreshCw,    cls: 'text-emerald-600 bg-emerald-50' },
  submit_failed:            { Icon: AlertTriangle, cls: 'text-rose-600 bg-rose-50' },
};

type Category = 'all' | 'submission' | 'approval' | 'status';
const CATEGORY_OF: Record<string, Exclude<Category, 'all'>> = {
  submitted: 'submission', amended: 'submission', submit_failed: 'submission',
  sent_for_approval: 'approval', client_approved: 'approval', client_changes_requested: 'approval',
  status_change: 'status',
};
const CATEGORY_CHIPS: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'submission', label: 'Submissions' },
  { id: 'approval', label: 'Approvals' }, { id: 'status', label: 'Status' },
];

function csvCell(v: string): string { return `"${(v ?? '').replace(/"/g, '""')}"`; }

export default function MtdItHistoryModal({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (events ?? []).filter(e => {
      if (category !== 'all' && CATEGORY_OF[e.kind] !== category) return false;
      if (q && !`${e.client ?? ''} ${e.clientRef ?? ''} ${e.label} ${e.actor ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, search, category]);

  function exportCsv() {
    const header = ['Date', 'Client', 'Code', 'Activity', 'By', 'Type'];
    const rows = filtered.map(e => [
      new Date(e.at).toLocaleString('en-GB'), e.client ?? '', e.clientRef ?? '', e.label, e.actor ?? '', e.kind,
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mtd-it-activity-history.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let alive = true;
    fetch('/api/mtd-it/activity')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (alive) setEvents((d.events ?? []) as ActivityEvent[]); })
      .catch(() => { if (alive) setError('Could not load the activity history.'); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><History size={15} className="text-indigo-600" /> MTD IT — activity history</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>

        {/* Search + category filters */}
        {events && events.length > 0 && (
          <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, code, activity or person…" className="text-sm pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {CATEGORY_CHIPS.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${category === c.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {c.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-slate-400">{filtered.length} event{filtered.length === 1 ? '' : 's'}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {events === null && !error ? (
            <p className="text-sm text-gray-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : events && events.length === 0 ? (
            <p className="text-sm text-gray-400">No activity yet — drafts, approvals and submissions will appear here.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400">No activity matches your search/filter.</p>
          ) : (
            <ol className="relative">
              <span aria-hidden className="absolute left-[15px] top-1 bottom-1 w-px bg-slate-200" />
              {filtered.map((e, i) => {
                const m = ICON[e.kind] ?? ICON.status_change;
                const Icon = m.Icon;
                return (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className={`relative z-10 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${m.cls}`}>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm text-slate-800">
                          {e.client && <span className="font-medium">{e.client}</span>}
                          {e.clientRef && <span className="text-slate-400 font-mono text-xs ml-1">{e.clientRef}</span>}
                          {e.client ? ' — ' : ''}{e.label}
                        </p>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">{new Date(e.at).toLocaleString('en-GB')}</span>
                      </div>
                      {e.actor && <p className="text-[11px] text-slate-400 mt-0.5">{e.actor}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
          ><Download size={13} /> Export to spreadsheet</button>
          <button onClick={onClose} className="btn-primary text-sm">Done</button>
        </div>
      </div>
    </div>
  );
}
