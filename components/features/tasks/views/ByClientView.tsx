'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskFilters from '../TaskFilters';
import ExportTasksButton from '../ExportTasksButton';
import DueWindowChips from '../DueWindowChips';
import { type SortDir } from '../SortHeader';
import TaskTable, { type TaskColumn } from '../TaskTable';
import { type DueWindow, classifyTasks, applyDueFilter } from '../dueWindow';
import type { Task, TaskStatus, TaskStep } from '@/types';

interface Props {
  tasks: Task[];
  currentUserId: string;
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all'; onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string; onClientChange: (v: string) => void;
  assigneeFilter: string; onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  onClearFilters: () => void;
  onTaskClick: (task: Task) => void;
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  viewMode: 'grid' | 'list';
  isAdmin?: boolean;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  hold:     'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];
type SortField = 'task' | 'status' | 'due';

// Same column layout as the other list views, minus the client column —
// client identity is encoded in the section header instead.
const BY_CLIENT_COLUMNS: TaskColumn<SortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 380, minWidth: 200, sortField: 'task'   },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

function sortTasks(tasks: Task[], field: SortField, dir: SortDir): Task[] {
  const arr = [...tasks];
  arr.sort((a, b) => {
    let cmp = 0;
    if (field === 'due') {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
      cmp = ad - bd;
    } else if (field === 'task') {
      cmp = a.title.localeCompare(b.title);
    } else if (field === 'status') {
      cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return arr;
}

export default function ByClientView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [showHistoryFor, setShowHistoryFor] = useState<Set<string>>(new Set());
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });

  const filtered = useMemo(() => tasks.filter(t => {
    if (search) {
      const needle = search.toLowerCase();
      const hay = `${t.title} ${t.client?.name ?? ''} ${t.client?.client_ref ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
    return true;
  }), [tasks, search, statusFilter, assigneeFilter]);

  const { classMap: dueClassMap, counts: dueCounts } = useMemo(() => classifyTasks(filtered), [filtered]);
  const dueFiltered = useMemo(() => applyDueFilter(filtered, dueClassMap, dueFilter), [filtered, dueClassMap, dueFilter]);

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, {
      label: string;
      client_ref?: string;
      client_status?: string | null;
      active: Task[];
      history: Task[];
    }>();
    dueFiltered.forEach(t => {
      const key = t.client_id ?? '__internal__';
      const label = t.client?.name ?? 'Internal / No Client';
      if (!map.has(key)) map.set(key, {
        label,
        client_ref:    t.client?.client_ref,
        client_status: t.client?.status,
        active:  [],
        history: [],
      });
      const bucket = map.get(key)!;
      if (t.status === 'complete') bucket.history.push(t);
      else bucket.active.push(t);
    });
    // Apply current sort to each bucket
    map.forEach(bucket => {
      bucket.active = sortTasks(bucket.active, sort.field, sort.dir);
      bucket.history = sortTasks(bucket.history, sort.field, sort.dir);
    });
    return Array.from(map.entries()).sort(([, a], [, b]) => a.label.localeCompare(b.label));
  }, [dueFiltered, sort]);

  function toggle(key: string) {
    setExpandedClients(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  function toggleHistory(key: string) {
    setShowHistoryFor(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  return (
    <div>
      {/* Filters — sticky at top of scroll container */}
      <div className="sticky top-0 z-30 bg-gray-50 pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TaskFilters
            search={search} onSearchChange={onSearchChange}
            statusFilter={statusFilter} onStatusChange={onStatusChange}
            clientFilter={clientFilter} onClientChange={onClientChange}
            assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
            clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
          />
          <ExportTasksButton tasks={dueFiltered} filename="tasks-by-client" />
        </div>
      </div>

      <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} className="mb-4" />

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : viewMode === 'list' ? (
        // All clients share one bounded scroll container with a single sticky
        // column header. Each client gets a colspan header row that toggles
        // expand/collapse and a completed-history disclosure row below.
        <TaskTable<SortField>
          viewKey="byClient"
          columns={BY_CLIENT_COLUMNS}
          sortField={sort.field}
          sortDir={sort.dir}
          onToggleSort={toggleSort}
        >
          {grouped.map(([key, { label, client_ref, client_status, active, history }]) => {
            const isExpanded = expandedClients.has(key) || active.length <= 3;
            const showHistory = showHistoryFor.has(key);
            return (
              <tbody key={key} className="border-b border-gray-100 last:border-0">
                <tr className="bg-gray-50/60">
                  <td colSpan={6} className="px-0 py-0">
                    <button
                      onClick={() => toggle(key)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        {isExpanded
                          ? <ChevronDown  className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                        <span className="font-semibold text-sm text-gray-900">{label}</span>
                        {client_ref && <span className="text-xs font-mono text-gray-400">{client_ref}</span>}
                        {client_status && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                            STATUS_COLOURS[client_status] ?? 'bg-gray-100 text-gray-500'
                          }`}>
                            {client_status === 'hold' ? 'On Hold' : client_status}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {active.length} active{history.length > 0 ? `, ${history.length} complete` : ''}
                        </span>
                      </div>
                    </button>
                  </td>
                </tr>
                {isExpanded && active.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-2 text-xs text-gray-400">No active tasks.</td></tr>
                )}
                {isExpanded && active.map(t => (
                  <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} hideClient onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                ))}
                {isExpanded && history.length > 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-2 border-t border-gray-100">
                      <button
                        onClick={() => toggleHistory(key)}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                      >
                        <History className="h-3.5 w-3.5" />
                        {showHistory ? 'Hide' : 'Show'} {history.length} completed task{history.length !== 1 ? 's' : ''}
                      </button>
                    </td>
                  </tr>
                )}
                {isExpanded && showHistory && history.map(t => (
                  <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} hideClient onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                ))}
              </tbody>
            );
          })}
        </TaskTable>
      ) : (
        /* ── Grid view ── */
        <div className="space-y-3">
          {grouped.map(([key, { label, client_ref, client_status, active, history }]) => {
            const isExpanded = expandedClients.has(key) || active.length <= 3;
            const showHistory = showHistoryFor.has(key);
            return (
              <div key={key} className="bg-white border border-gray-200 rounded-lg">
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg border-b border-gray-100"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{label}</span>
                    {client_ref && <span className="text-xs font-mono text-gray-400">{client_ref}</span>}
                    {client_status && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                        STATUS_COLOURS[client_status] ?? 'bg-gray-100 text-gray-500'
                      }`}>
                        {client_status === 'hold' ? 'On Hold' : client_status}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {active.length} active{history.length > 0 ? `, ${history.length} complete` : ''}
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                </button>
                {isExpanded && (
                  <div>
                    {active.length === 0 ? (
                      <p className="text-xs text-gray-400 px-4 py-3">No active tasks.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                        {active.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                      </div>
                    )}
                    {history.length > 0 && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                        <button
                          onClick={() => toggleHistory(key)}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                        >
                          <History className="h-3.5 w-3.5" />
                          {showHistory ? 'Hide' : 'Show'} {history.length} completed task{history.length !== 1 ? 's' : ''}
                        </button>
                        {showHistory && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                            {history.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                          </div>
                        )}
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
