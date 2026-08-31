'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Unlock, RefreshCw, Search, ChevronDown, ChevronRight, Download } from 'lucide-react';
import TaskListRow from '../TaskListRow';
import TaskTable, { type TaskColumn } from '../TaskTable';
import { type SortDir } from '../SortHeader';
import { useTaskClientStatusPolicy } from '../TaskClientStatusPolicyProvider';
import { isHiddenByClientStatus, isExcludedFromOverdueCounts, countsHiddenByClientStatus } from '../applyClientStatusVisibility';
import Tooltip from '@/components/ui/Tooltip';
import GlassSelect from '@/components/ui/GlassSelect';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import { exportTaskGroupsXlsx } from '@/utils/taskExport';
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

type DeptSortField = 'task' | 'client' | 'status' | 'due';

const DEPARTMENT_COLUMNS: TaskColumn<DeptSortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 360, minWidth: 200, sortField: 'task'   },
  { id: 'client',    label: 'Client',    defaultWidth: 220, minWidth: 120, sortField: 'client' },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

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
  const { policy: clientStatusPolicy, showOnHold, setShowOnHold, showInactive, setShowInactive } = useTaskClientStatusPolicy();

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
      // Apply the firm's client-status policy. The grey-out + cancelled
      // status badge are universal; this filter respects hide-from-default
      // + the user's per-session "Show on-hold / Show inactive" toggles.
      if (isHiddenByClientStatus(t, { policy: clientStatusPolicy, showOnHold, showInactive })) return false;
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
  }, [tasks, templates, category, search, status, assignee, filter.date_from, filter.date_to, clientStatusPolicy, showOnHold, showInactive]);

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
        // Exclude on-hold (when policy says so) and inactive clients from
        // the Overdue / Due-in-7d / Next-due rollups — they're shown for
        // context only, not active workload tracking.
        const skipFromCounts = isExcludedFromOverdueCounts(t, clientStatusPolicy);
        if (t.status !== 'complete' && !skipFromCounts) {
          if (days < 0) overdue++;
          else if (due <= weekEnd) dueThisWeek++;
        }
        if (t.status !== 'complete' && !skipFromCounts && days >= 0 && (!nextDue || due < nextDue)) nextDue = due;
      }
    }
    const avgDaysToGo = withDue ? Math.round(totalDaysToGo / withDue) : null;
    return { total: filteredTasks.length, completed, overdue, dueThisWeek, avgDaysToGo, nextDue };
  }, [filteredTasks, clientStatusPolicy]);

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

  function handleExport() {
    if (tasksMatchingFilters.length === 0) return;
    const perTemplate = new Map<string, Task[]>();
    for (const t of tasksMatchingFilters) {
      if (!t.template_id) continue;
      const arr = perTemplate.get(t.template_id) ?? [];
      arr.push(t);
      perTemplate.set(t.template_id, arr);
    }
    const groups = [...perTemplate.entries()]
      .map(([tid, arr]) => ({ template: templates.find(tpl => tpl.id === tid), tasks: arr }))
      .sort((a, b) => (a.template?.name ?? '').localeCompare(b.template?.name ?? ''))
      .map(g => ({
        name: g.template?.name ?? '(deleted template)',
        tasks: sortTasks(g.tasks),
      }));
    const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    exportTaskGroupsXlsx(groups, `tasks-${safeLabel}`);
  }

  return (
    <div>
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 backdrop-blur-md pb-3 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{label}</h2>
            <p className="text-xs font-medium text-[var(--text-secondary)]">Department overview · {stats.total} task{stats.total !== 1 ? 's' : ''} in view</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" strokeWidth={2.5} />
            <input
              type="text"
              placeholder="Search task, client, or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm font-medium pl-7 pr-3 py-2 rounded-lg w-56 bg-white border border-[var(--border)] shadow-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] placeholder:font-medium outline-none transition focus:border-[var(--accent)] focus:bg-white"
            />
          </div>

          <GlassSelect
            ariaLabel="Filter by status"
            value={status}
            onChange={v => setStatus(v as TaskStatus | 'all' | 'open')}
            options={STATUS_FILTERS.map(o => ({ value: o.id, label: o.label }))}
          />

          <GlassSelect
            ariaLabel="Filter by assignee"
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: '', label: 'All assignees' },
              ...teamMembers.map(m => ({ value: m.id, label: m.full_name || m.email })),
            ]}
          />

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
              <div className={`flex items-center gap-1.5 border rounded-lg px-2 py-1 shadow-md ${dateLocked ? 'bg-amber-400/20 border-amber-200/50' : 'bg-white border-[var(--border)]'}`}>
                <span className="text-[11px] uppercase font-bold tracking-wide text-[var(--text-secondary)]">Due</span>
                <Tooltip label={fromTooltip}>
                  <input
                    type="date"
                    value={filter.date_from ?? ''}
                    onChange={e => saveFilter({ date_from: e.target.value || null })}
                    disabled={dateLocked && !isAdmin}
                    aria-label={fromTooltip}
                    className="text-sm font-medium border-0 bg-transparent text-[var(--text-primary)] [color-scheme:dark] focus:outline-none disabled:text-[var(--text-muted)] disabled:cursor-not-allowed"
                  />
                </Tooltip>
                <span className="text-xs text-[var(--text-muted)]">→</span>
                <Tooltip label={toTooltip}>
                  <input
                    type="date"
                    value={filter.date_to ?? ''}
                    onChange={e => saveFilter({ date_to: e.target.value || null })}
                    disabled={dateLocked && !isAdmin}
                    aria-label={toTooltip}
                    className="text-sm font-medium border-0 bg-transparent text-[var(--text-primary)] [color-scheme:dark] focus:outline-none disabled:text-[var(--text-muted)] disabled:cursor-not-allowed"
                  />
                </Tooltip>
                {savingFilter && <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />}
                <Tooltip label={lockTooltip}>
                  <button
                    onClick={toggleLock}
                    disabled={!isAdmin || savingFilter || !filterLoaded}
                    aria-label={dateLocked ? 'Unlock filter' : 'Lock filter'}
                    className={`p-1.5 rounded transition-colors ${
                      dateLocked
                        ? 'text-amber-600 hover:bg-amber-400/30'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {dateLocked ? <Lock size={15} strokeWidth={2.5} /> : <Unlock size={15} strokeWidth={2.5} />}
                  </button>
                </Tooltip>
              </div>
            );
          })()}

          {(search || status !== 'open' || assignee) && (
            <button
              onClick={() => { setSearch(''); setStatus('open'); setAssignee(''); }}
              className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] drop-shadow-sm flex items-center gap-1"
            >
              <RefreshCw size={11} strokeWidth={2.5} /> Reset
            </button>
          )}

          {/* Show-hidden toggles — surface only when the policy is actively
              hiding tasks AND there are some to show, so the chip doesn't
              clutter the bar otherwise. */}
          {(() => {
            // Counts based on the same template-in-category restriction as
            // the main filter so we don't dangle "Show 12 on-hold" when none
            // of the 12 belong to this department.
            const templateIdsInCategory = new Set(
              templates.filter(tpl => tpl.category === category).map(tpl => tpl.id)
            );
            const inDept = tasks.filter(t => t.template_id && templateIdsInCategory.has(t.template_id));
            const hidden = countsHiddenByClientStatus(inDept, { policy: clientStatusPolicy, showOnHold, showInactive });
            return (
              <>
                {(hidden.onHold > 0 || showOnHold) && (
                  <button
                    onClick={() => setShowOnHold(!showOnHold)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border shadow-md transition-colors flex items-center gap-1 ${
                      showOnHold
                        ? 'bg-amber-300 border-amber-300 text-amber-900'
                        : 'bg-white border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
                    }`}
                  >
                    {showOnHold ? 'Hide' : 'Show'} on-hold
                    {!showOnHold && hidden.onHold > 0 && <span className="font-semibold">({hidden.onHold})</span>}
                  </button>
                )}
                {(hidden.inactive > 0 || showInactive) && (
                  <button
                    onClick={() => setShowInactive(!showInactive)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border shadow-md transition-colors flex items-center gap-1 ${
                      showInactive
                        ? 'bg-white border-[var(--border)] text-[#2e3062]'
                        : 'bg-white border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
                    }`}
                  >
                    {showInactive ? 'Hide' : 'Show'} inactive
                    {!showInactive && hidden.inactive > 0 && <span className="font-semibold">({hidden.inactive})</span>}
                  </button>
                )}
              </>
            );
          })()}

          <div className="ml-auto">
            <Tooltip label={tasksMatchingFilters.length === 0
              ? 'No tasks to export'
              : `Export ${label} to Excel — one sheet per template`}>
              <button
                onClick={handleExport}
                disabled={tasksMatchingFilters.length === 0}
                aria-label="Export department to Excel"
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] bg-white hover:bg-[var(--bg-nav-hover)] border border-[var(--border)] shadow-md px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
                Export
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-[var(--border)]">
          <button
            onClick={() => setActiveTemplateId('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors whitespace-nowrap drop-shadow-sm ${
              activeTemplateId === 'all'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            All templates <span className="ml-1 opacity-70">{tasksMatchingFilters.length}</span>
          </button>
          {templatesInCategory.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => setActiveTemplateId(tpl.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors whitespace-nowrap drop-shadow-sm ${
                activeTemplateId === tpl.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tpl.name} <span className="ml-1 opacity-60">{countsByTemplate.get(tpl.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 text-sm font-semibold text-[var(--text-secondary)]">
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
        <div className="pt-4">
          <TaskTable<typeof sort.field>
            viewKey={`department.${category}`}
            columns={DEPARTMENT_COLUMNS}
            sortField={sort.field}
            sortDir={sort.dir}
            onToggleSort={toggleSort}
          >
            {tasksByTemplateForList.map(group => {
              const groupKey = group.template?.id ?? 'unknown';
              const isCollapsible = activeTemplateId === 'all';
              const isCollapsed = isCollapsible && collapsedTemplates.has(groupKey);
              return (
                <tbody key={groupKey}>
                  {activeTemplateId === 'all' && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={7} className="px-0 py-0">
                        <button
                          onClick={() => toggleTemplate(groupKey)}
                          aria-expanded={!isCollapsed}
                          className="w-full px-4 py-2 border-y border-gray-100 flex items-center justify-between hover:bg-gray-100 transition-colors group"
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
                      </td>
                    </tr>
                  )}
                  {!isCollapsed && group.tasks.map(t => (
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
              );
            })}
          </TaskTable>
        </div>
      )}

      {/* Silence unused-prop warning for clients */}
      <span hidden>{clients.length}</span>
    </div>
  );
}
