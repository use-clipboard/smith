'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Unlock, RefreshCw, Search, CalendarDays, ChevronDown, ChevronRight } from 'lucide-react';
import TaskListRow from '../TaskListRow';
import SortHeader, { type SortDir } from '../SortHeader';
import Tooltip from '@/components/ui/Tooltip';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { Task, TaskStatus, TaskStep, TaskTemplate } from '@/types';

interface TeamMember { id: string; full_name: string | null; email: string }
interface ClientRef  { id: string; name: string }

interface DeptFilter {
  date_from: string | null;
  date_to:   string | null;
  locked:    boolean;
  locked_by: string | null;
  locked_at: string | null;
  locked_by_user?: { id: string; full_name: string | null; email: string } | null;
}

interface Props {
  category: string;
  tasks: Task[];
  templates: TaskTemplate[];
  clients: ClientRef[];
  teamMembers: TeamMember[];
  currentUserId: string;
  isAdmin: boolean;
  onTaskClick: (task: Task) => void;
  onStepUpdate: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onStopRecurrence: (taskId: string) => Promise<void>;
}

const STATUS_FILTERS: { id: TaskStatus | 'all' | 'open'; label: string }[] = [
  { id: 'open',              label: 'Open' },
  { id: 'all',               label: 'All' },
  { id: 'not_started',       label: 'Not started' },
  { id: 'in_progress',       label: 'In progress' },
  { id: 'waiting_on_client', label: 'Waiting on client' },
  { id: 'records_here',      label: 'Records here' },
  { id: 'review',            label: 'Review' },
  { id: 'complete',          label: 'Completed' },
];

function todayUTC(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export default function DepartmentView({
  category, tasks, templates, clients, teamMembers, currentUserId, isAdmin,
  onTaskClick, onStepUpdate, onTaskUpdate, onDelete, onStopRecurrence,
}: Props) {
  const label = TEMPLATE_CATEGORY_LABELS[category] ?? category;

  // ── Filter state (firm-wide, persisted) ─────────────────────────────────────
  const [filter, setFilter] = useState<DeptFilter>({
    date_from: null, date_to: null, locked: false, locked_by: null, locked_at: null,
  });
  const [filterLoaded, setFilterLoaded] = useState(false);
  const [savingFilter, setSavingFilter] = useState(false);

  // ── Local-only state ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | 'all' | 'open'>('open');
  const [assignee, setAssignee] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState<string | 'all'>('all');
  // Collapsed template groups in the "All templates" tab — local to this session
  const [collapsedTemplates, setCollapsedTemplates] = useState<Set<string>>(new Set());
  // Column sort state (shared across template groups)
  const [sort, setSort] = useState<{ field: 'task' | 'client' | 'status' | 'due'; dir: SortDir }>({ field: 'due', dir: 'asc' });
  function toggleSort(field: typeof sort.field) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }
  function toggleTemplate(id: string) {
    setCollapsedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Templates in this category (only those that have at least one task — keeps tabs tidy)
  const templatesInCategory = useMemo(() => {
    const taskTemplateIds = new Set(tasks.map(t => t.template_id).filter(Boolean) as string[]);
    return templates
      .filter(tpl => tpl.category === category && taskTemplateIds.has(tpl.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates, tasks, category]);

  // ── Load saved firm-wide filter on mount / category change ──────────────────
  useEffect(() => {
    let cancelled = false;
    setFilterLoaded(false);
    fetch(`/api/tasks/departments/${category}/filter`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) { setFilter(d.filter); setFilterLoaded(true); } })
      .catch(() => { if (!cancelled) setFilterLoaded(true); });
    return () => { cancelled = true; };
  }, [category]);

  // ── Persist filter changes (date range only — lock has its own handler) ─────
  async function saveFilter(next: Partial<DeptFilter>) {
    const optimistic = { ...filter, ...next };
    setFilter(optimistic);
    setSavingFilter(true);
    try {
      const r = await fetch(`/api/tasks/departments/${category}/filter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data.error ?? 'Failed to update filter');
        // Re-fetch authoritative state on failure
        const fresh = await fetch(`/api/tasks/departments/${category}/filter`);
        if (fresh.ok) setFilter((await fresh.json()).filter);
      }
    } finally {
      setSavingFilter(false);
    }
  }

  async function toggleLock() {
    if (!isAdmin) return;
    const willLock = !filter.locked;
    if (willLock && !filter.date_from && !filter.date_to) {
      if (!confirm('Lock with no date range set? Users will see no date filter applied.')) return;
    }
    if (!willLock) {
      if (!confirm('Unlock this department filter? Other admins will be able to change the dates.')) return;
    }
    await saveFilter({ locked: willLock });
  }

  // ── Tasks that pass every filter EXCEPT the active-tab filter ───────────────
  // Used both to render the active tab's rows (further filtered by tab) and to
  // compute accurate per-tab counts that don't collapse when a tab is selected.
  const tasksMatchingFilters = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const from = filter.date_from ? new Date(filter.date_from) : null;
    const to   = filter.date_to   ? new Date(filter.date_to)   : null;
    if (to) to.setHours(23, 59, 59, 999);

    const templateIdsInCategory = new Set(
      templates.filter(tpl => tpl.category === category).map(tpl => tpl.id)
    );

    return tasks.filter(t => {
      // Restrict to tasks attached to templates in this department
      if (!t.template_id || !templateIdsInCategory.has(t.template_id)) return false;
      if (search) {
        // Match task title OR client name OR client code (case-insensitive)
        const client = (t as unknown as { client?: { name?: string | null; client_ref?: string | null } | null }).client ?? null;
        const haystack = `${t.title} ${client?.name ?? ''} ${client?.client_ref ?? ''}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      if (status === 'open' && t.status === 'complete') return false;
      if (status !== 'all' && status !== 'open' && t.status !== status) return false;
      if (assignee && !t.steps?.some(s => s.assignee_id === assignee)) return false;
      if (from || to) {
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        if (from && due < from) return false;
        if (to   && due > to)   return false;
      }
      return true;
    });
  }, [tasks, templates, category, search, status, assignee, filter.date_from, filter.date_to]);

  // ── Per-template counts for the tabs (NOT affected by active tab) ───────────
  const countsByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasksMatchingFilters) if (t.template_id) m.set(t.template_id, (m.get(t.template_id) ?? 0) + 1);
    return m;
  }, [tasksMatchingFilters]);

  // ── Effective task list (active tab applied on top) ─────────────────────────
  const filteredTasks = useMemo(() => {
    if (activeTemplateId === 'all') return tasksMatchingFilters;
    return tasksMatchingFilters.filter(t => t.template_id === activeTemplateId);
  }, [tasksMatchingFilters, activeTemplateId]);

  // ── Aggregate stats for the summary chips ───────────────────────────────────
  const stats = useMemo(() => {
    const today = todayUTC();
    let overdue = 0, dueThisWeek = 0, completed = 0, withDue = 0, totalDaysToGo = 0;
    let nextDue: Date | null = null;
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    for (const t of filteredTasks) {
      if (t.status === 'complete') completed++;
      if (t.due_date) {
        withDue++;
        const due = new Date(t.due_date);
        const days = daysBetween(today, due);
        totalDaysToGo += days;
        if (t.status !== 'complete') {
          if (days < 0) overdue++;
          else if (due <= weekEnd) dueThisWeek++;
        }
        if (t.status !== 'complete' && days >= 0 && (!nextDue || due < nextDue)) nextDue = due;
      }
    }
    const avgDaysToGo = withDue ? Math.round(totalDaysToGo / withDue) : null;
    return { total: filteredTasks.length, completed, overdue, dueThisWeek, avgDaysToGo, nextDue };
  }, [filteredTasks]);

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  // Apply the active column sort to a task array
  const sortTasks = useMemo(() => (arr: Task[]): Task[] => {
    const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];
    const copy = [...arr];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'due') {
        const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        cmp = ad - bd;
      } else if (sort.field === 'task') {
        cmp = a.title.localeCompare(b.title);
      } else if (sort.field === 'client') {
        const an = a.is_internal ? 'Internal' : (a.client_id ? clientNameById.get(a.client_id) ?? '' : '');
        const bn = b.is_internal ? 'Internal' : (b.client_id ? clientNameById.get(b.client_id) ?? '' : '');
        cmp = an.localeCompare(bn);
      } else if (sort.field === 'status') {
        cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [sort, clientNameById]);

  const tasksByTemplateForList = useMemo(() => {
    // When "All templates" selected, group rows by template for readability
    if (activeTemplateId !== 'all') return [{ template: templates.find(tpl => tpl.id === activeTemplateId), tasks: sortTasks(filteredTasks) }];
    const m = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      if (!t.template_id) continue;
      const arr = m.get(t.template_id) ?? [];
      arr.push(t);
      m.set(t.template_id, arr);
    }
    return [...m.entries()].map(([tid, arr]) => ({
      template: templates.find(tpl => tpl.id === tid),
      tasks: sortTasks(arr),
    })).sort((a, b) => (a.template?.name ?? '').localeCompare(b.template?.name ?? ''));
  }, [filteredTasks, activeTemplateId, templates, sortTasks]);

  const dateLocked = filter.locked;
  const lockedByName = filter.locked_by_user?.full_name || filter.locked_by_user?.email;

  return (
    <div>
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-gray-50 pb-3 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{label}</h2>
            <p className="text-xs text-gray-500">Department overview · {stats.total} task{stats.total !== 1 ? 's' : ''} in view</p>
          </div>
          {/* Summary chips */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-gray-200">
              Total <span className="font-semibold text-gray-900">{stats.total}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
              Done <span className="font-semibold">{stats.completed}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700">
              Overdue <span className="font-semibold">{stats.overdue}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
              Due in 7d <span className="font-semibold">{stats.dueThisWeek}</span>
            </span>
            {stats.nextDue && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700">
                <CalendarDays size={11} />
                Next due in <span className="font-semibold">{daysBetween(todayUTC(), stats.nextDue)}d</span>
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search task, client, or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm pl-7 pr-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
            />
          </div>

          <select
            value={status}
            onChange={e => setStatus(e.target.value as TaskStatus | 'all' | 'open')}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_FILTERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>

          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All assignees</option>
            {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>

          {/* Date range + padlock — firm-wide */}
          {(() => {
            const lockTooltip = !isAdmin
              ? (dateLocked ? `Locked firm-wide by ${lockedByName ?? 'an admin'} — only admins can unlock` : 'Only admins can lock this filter')
              : (dateLocked ? `Unlock — currently locked by ${lockedByName ?? 'an admin'}` : 'Lock this date range firm-wide');
            const fromTooltip = dateLocked && !isAdmin
              ? `Earliest due date — locked firm-wide${lockedByName ? ` by ${lockedByName}` : ''}`
              : 'Earliest due date to include';
            const toTooltip = dateLocked && !isAdmin
              ? `Latest due date — locked firm-wide${lockedByName ? ` by ${lockedByName}` : ''}`
              : 'Latest due date to include';
            return (
              <div className={`flex items-center gap-1.5 border rounded-lg px-2 py-1 ${dateLocked ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <span className="text-[11px] uppercase font-semibold tracking-wide text-gray-500">Due</span>
                <Tooltip label={fromTooltip}>
                  <input
                    type="date"
                    value={filter.date_from ?? ''}
                    onChange={e => saveFilter({ date_from: e.target.value || null })}
                    disabled={dateLocked && !isAdmin}
                    aria-label={fromTooltip}
                    className="text-sm border-0 bg-transparent focus:outline-none disabled:text-gray-500 disabled:cursor-not-allowed"
                  />
                </Tooltip>
                <span className="text-xs text-gray-400">→</span>
                <Tooltip label={toTooltip}>
                  <input
                    type="date"
                    value={filter.date_to ?? ''}
                    onChange={e => saveFilter({ date_to: e.target.value || null })}
                    disabled={dateLocked && !isAdmin}
                    aria-label={toTooltip}
                    className="text-sm border-0 bg-transparent focus:outline-none disabled:text-gray-500 disabled:cursor-not-allowed"
                  />
                </Tooltip>
                {savingFilter && <Loader2 size={12} className="animate-spin text-gray-400" />}
                <Tooltip label={lockTooltip}>
                  <button
                    onClick={toggleLock}
                    disabled={!isAdmin || savingFilter || !filterLoaded}
                    aria-label={dateLocked ? 'Unlock filter' : 'Lock filter'}
                    className={`p-1.5 rounded transition-colors ${
                      dateLocked
                        ? 'text-amber-600 hover:bg-amber-100'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {dateLocked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                </Tooltip>
              </div>
            );
          })()}

          {(search || status !== 'open' || assignee) && (
            <button
              onClick={() => { setSearch(''); setStatus('open'); setAssignee(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <RefreshCw size={11} /> Reset
            </button>
          )}
        </div>

        {dateLocked && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1 inline-flex items-center gap-1">
            <Lock size={11} /> Date range locked firm-wide{lockedByName ? ` by ${lockedByName}` : ''}.
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-gray-200">
          <button
            onClick={() => setActiveTemplateId('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap ${
              activeTemplateId === 'all'
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All templates <span className="ml-1 opacity-60">{tasksMatchingFilters.length}</span>
          </button>
          {templatesInCategory.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => setActiveTemplateId(tpl.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap ${
                activeTemplateId === tpl.id
                  ? 'border-indigo-500 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tpl.name} <span className="ml-1 opacity-60">{countsByTemplate.get(tpl.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {(() => {
            const hasDateFilter = !!(filter.date_from || filter.date_to);
            const tasksInCategory = tasks.filter(t => t.template_id && templates.find(tpl => tpl.id === t.template_id && tpl.category === category)).length;
            if (tasksInCategory === 0) return `No tasks have been raised in ${label} yet.`;
            if (hasDateFilter) {
              return (
                <>
                  <p>None of the {tasksInCategory} {label} task{tasksInCategory !== 1 ? 's' : ''} fall within the date range
                    {filter.date_from ? ` from ${new Date(filter.date_from).toLocaleDateString('en-GB')}` : ''}
                    {filter.date_to   ? ` to ${new Date(filter.date_to).toLocaleDateString('en-GB')}` : ''}.</p>
                  <p className="mt-2 text-xs">
                    {dateLocked
                      ? 'The date range is locked firm-wide — ask an admin to unlock and widen it.'
                      : 'Widen the date range above to see more tasks.'}
                  </p>
                </>
              );
            }
            return 'No tasks match the current filters.';
          })()}
        </div>
      ) : (
        <div className="space-y-4 pt-4">
          {tasksByTemplateForList.map(group => {
            const groupKey = group.template?.id ?? 'unknown';
            const isCollapsible = activeTemplateId === 'all';
            const isCollapsed = isCollapsible && collapsedTemplates.has(groupKey);
            return (
            <div key={groupKey} className="bg-white border border-gray-200 rounded-xl">
              {activeTemplateId === 'all' && (
                <button
                  onClick={() => toggleTemplate(groupKey)}
                  aria-expanded={!isCollapsed}
                  className="w-full px-4 py-2 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed
                      ? <ChevronRight size={13} className="text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                      : <ChevronDown  size={13} className="text-gray-400 group-hover:text-gray-600 flex-shrink-0" />}
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">
                      {group.template?.name ?? '(deleted template)'}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0 ml-2">{group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}</p>
                </button>
              )}
              {!isCollapsed && (
              <table className="w-full text-left table-fixed">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader<typeof sort.field> field="task"   label="Task"   activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="sticky top-[200px] z-10 border-b border-gray-100" />
                    <SortHeader<typeof sort.field> field="client" label="Client" activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="sticky top-[200px] z-10 w-48 border-b border-gray-100" />
                    <SortHeader<typeof sort.field> field="status" label="Status" activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="sticky top-[200px] z-10 w-32 border-b border-gray-100" />
                    <th className="sticky top-[200px] z-10 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 w-28 border-b border-gray-100">Progress</th>
                    <SortHeader<typeof sort.field> field="due"    label="Due"    activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="sticky top-[200px] z-10 w-48 border-b border-gray-100" />
                    <th className="sticky top-[200px] z-10 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 w-32 border-b border-gray-100">Assignees</th>
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map(t => (
                    <TaskListRow
                      key={t.id}
                      task={t}
                      currentUserId={currentUserId}
                      onClick={() => onTaskClick(t)}
                      onStepUpdate={onStepUpdate}
                      onTaskUpdate={onTaskUpdate}
                      isAdmin={isAdmin}
                      teamMembers={teamMembers}
                      onDelete={onDelete}
                      onStopRecurrence={onStopRecurrence}
                    />
                  ))}
                </tbody>
              </table>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Silence unused-prop warning for clients */}
      <span hidden>{clients.length}</span>
    </div>
  );
}
