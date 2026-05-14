'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, Trash2, RefreshCw, ChevronDown, ChevronRight, Clock, User as UserIcon, Calendar, Activity, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Task, TaskStep } from '@/types';
import ChangesView, { type ChangesViewHandle } from './ChangesView';

interface HistoryTask extends Task {
  deleted_at?: string | null;
  deleted_by?: string | null;
  client?: { id: string; name: string; client_ref: string } | null;
  created_by_user?: { id: string; full_name: string | null; email: string } | null;
  deleted_by_user?: { id: string; full_name: string | null; email: string } | null;
  steps?: (TaskStep & { assignee?: { id: string; full_name: string | null; email: string } | null })[];
  time_entries?: { id: string; step_id: string | null; started_at: string; ended_at: string; notes: string | null; user?: { full_name: string | null; email: string } | null }[];
}

type FilterId = 'all' | 'completed' | 'deleted' | 'audit';

const FILTERS: { id: FilterId; label: string; icon: LucideIcon }[] = [
  { id: 'all',       label: 'All',       icon: Layers },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
  { id: 'deleted',   label: 'Deleted',   icon: Trash2 },
  { id: 'audit',     label: 'Audit Log', icon: Activity },
];

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function userDisplay(u: { full_name: string | null; email: string } | null | undefined, fallback = 'System / auto'): string {
  if (!u) return fallback;
  return u.full_name || u.email || fallback;
}

function durationMins(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

export default function HistoryView() {
  const [filter, setFilter] = useState<FilterId>('all');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<HistoryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const auditRef = useRef<ChangesViewHandle>(null);
  const isAudit = filter === 'audit';

  async function load() {
    if (isAudit) {
      auditRef.current?.reload();
      return;
    }
    setLoading(true);
    try {
      // Search is applied client-side (over title, client name, client code) so
      // we always pull the full filter set and let the input refine the view.
      const params = new URLSearchParams({ filter });
      const r = await fetch(`/api/tasks/history?${params}`);
      if (r.ok) {
        const d = await r.json() as { tasks: HistoryTask[] };
        setTasks(d.tasks ?? []);
      } else {
        setTasks([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAudit) return; // audit data is fetched by ChangesView itself
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [filter]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Client-side filter — task title, client name, client code (case-insensitive)
  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t =>
      (t.title ?? '').toLowerCase().includes(q) ||
      (t.client?.name ?? '').toLowerCase().includes(q) ||
      (t.client?.client_ref ?? '').toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const counts = useMemo(() => ({
    completed: visibleTasks.filter(t => t.status === 'complete' && !t.deleted_at).length,
    deleted:   visibleTasks.filter(t => !!t.deleted_at).length,
    total:     visibleTasks.length,
  }), [visibleTasks]);

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-gray-50 pt-5 pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder={isAudit
                ? 'Search audit by task, client, code, or user…'
                : 'Search by task, client name, or code…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-80"
            />
            {FILTERS.map(f => {
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                    filter === f.id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200'
                  }`}
                >
                  <Icon size={11} />
                  {f.label}
                  {!isAudit && f.id === 'completed' && <span className="ml-0.5 opacity-70">{counts.completed}</span>}
                  {!isAudit && f.id === 'deleted'   && <span className="ml-0.5 opacity-70">{counts.deleted}</span>}
                  {!isAudit && f.id === 'all'       && <span className="ml-0.5 opacity-70">{counts.total}</span>}
                </button>
              );
            })}
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {isAudit ? (
        <ChangesView ref={auditRef} externalSearch={search} hideHeader />
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? 'No results match your search.' : 'No history yet.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {visibleTasks.map(t => {
            const isOpen = expanded.has(t.id);
            const isDeleted = !!t.deleted_at;
            const isComplete = t.status === 'complete' && !isDeleted;
            const stepCompletions = (t.steps ?? []).filter(s => s.completed_at).sort((a, b) =>
              (a.completed_at ?? '').localeCompare(b.completed_at ?? '')
            );
            const totalMins = (t.time_entries ?? []).reduce((sum, te) => sum + durationMins(te.started_at, te.ended_at), 0);

            return (
              <div key={t.id}>
                <button
                  onClick={() => toggle(t.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3"
                >
                  <span className="mt-0.5 text-gray-400 flex-shrink-0">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="mt-0.5 flex-shrink-0">
                    {isDeleted
                      ? <Trash2 size={14} className="text-red-500" />
                      : <CheckCircle2 size={14} className="text-emerald-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      {isDeleted && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Deleted</span>
                      )}
                      {isComplete && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Completed</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                      {t.client?.name && (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{t.client.name}</span>
                          {t.client.client_ref && (
                            <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 text-[10px] font-semibold tracking-wide uppercase">
                              {t.client.client_ref}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="flex items-center gap-1"><UserIcon size={11} /> Created by {userDisplay(t.created_by_user)}</span>
                      <span className="flex items-center gap-1"><Calendar size={11} /> {fmtDateTime(t.created_at)}</span>
                      {isComplete && t.completed_at && (
                        <span className="text-emerald-700">✓ Completed {fmtDateTime(t.completed_at)}</span>
                      )}
                      {isDeleted && (
                        <span className="text-red-600">
                          ✕ Deleted {fmtDateTime(t.deleted_at)} by {userDisplay(t.deleted_by_user, 'unknown')}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-gray-50/60 border-t border-gray-100 space-y-4 text-xs">
                    {/* Meta grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
                      <div>
                        <p className="text-gray-400 mb-0.5">Status</p>
                        <p className="text-gray-800 capitalize">{t.status.replace(/_/g, ' ')}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 mb-0.5">Due date</p>
                        <p className="text-gray-800">{fmtDate(t.due_date)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 mb-0.5">Recurrence</p>
                        <p className="text-gray-800 capitalize">
                          {t.recurrence_type
                            ? `${t.recurrence_type.replace(/-/g, ' ')}${t.recurrence_interval_days ? ` · ${t.recurrence_interval_days}d` : ''}`
                            : 'None'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 mb-0.5">Time logged</p>
                        <p className="text-gray-800 flex items-center gap-1">
                          <Clock size={11} /> {totalMins ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : '—'}
                        </p>
                      </div>
                    </div>

                    {t.description && (
                      <div>
                        <p className="text-gray-400 mb-0.5">Description</p>
                        <p className="text-gray-700 whitespace-pre-wrap">{t.description}</p>
                      </div>
                    )}

                    {/* Steps with completion times */}
                    {t.steps && t.steps.length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1.5">Steps ({stepCompletions.length} of {t.steps.length} completed)</p>
                        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {t.steps.map(s => (
                            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                s.status === 'complete' ? 'bg-emerald-500' :
                                s.status === 'in_progress' ? 'bg-indigo-500' :
                                s.status === 'blocked' ? 'bg-amber-500' :
                                s.status === 'skipped' ? 'bg-gray-300' :
                                'bg-gray-200'
                              }`} />
                              <p className="flex-1 text-gray-800 truncate">{s.title}</p>
                              <p className="text-gray-500 truncate w-40 text-right">{userDisplay(s.assignee, 'Unassigned')}</p>
                              <p className="text-gray-500 w-44 text-right">
                                {s.completed_at ? `✓ ${fmtDateTime(s.completed_at)}` : <span className="text-gray-300">—</span>}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Time entries with notes */}
                    {t.time_entries && t.time_entries.length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1.5">Time entries ({t.time_entries.length})</p>
                        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {t.time_entries.map(te => (
                            <div key={te.id} className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2 text-gray-700">
                                <p>{userDisplay(te.user, 'Unknown')} · {fmtDateTime(te.started_at)} → {fmtDateTime(te.ended_at)}</p>
                                <p className="text-gray-500 flex items-center gap-1"><Clock size={11} /> {durationMins(te.started_at, te.ended_at)}m</p>
                              </div>
                              {te.notes && <p className="mt-1 text-gray-600 whitespace-pre-wrap">{te.notes}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
